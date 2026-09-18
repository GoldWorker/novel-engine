import type { Progress } from "../domain/progress.js";
import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import { MemoryStore } from "../store/memory.js";
import {
  BookNotFoundError,
  type ApplyFoundationChangeOptions,
  type ApplyFoundationChangeResult,
  type AssessFoundationImpactOptions,
  type AutoWriteResult,
  type BookIndexEntry,
  type ChapterView,
  type ChapterWriteInput,
  type ChapterWriteResult,
  type FoundationImpactAssessment,
  type FoundationMeta,
  type FoundationPatch,
  type GenerateFoundationOptions,
  type InspectResult,
  type NovelSession,
  type NovelWorkspace,
  type SessionEvent,
  type SessionUnsubscribe,
  type StartAutoWriteOptions,
} from "../session/index.js";
import { createNovelSession } from "../session/novel-session.js";
import { createNovelWorkspace } from "../session/workspace.js";
import { generateBookId, KitBookIndex } from "./book-index.js";
import { connectKitWorker, terminateKitWorker, type KitWorkerPort } from "./connect-worker.js";
import {
  KitClosedError,
  KitLlmRequiredError,
  KitWorkerError,
  KitWorkspaceDisabledError,
} from "./errors.js";
import type { KitStoreName } from "./protocol.js";
import {
  bookOpfsDirectory,
  isNamedStore,
  isStorePort,
  openIndexStore,
  openNamedStore,
  resolveOpfsDirectory,
  storeKindOf,
} from "./store.js";
import type { KitRuntime, KitStoreKind, KitStoreOption, NovelKitOptions } from "./types.js";

const DEFAULT_LLM_ENDPOINT = "/api/llm";
const DEFAULT_BOOK_ID = "default";

function requireBookId(value: string | undefined): string {
  const bookId = (value ?? DEFAULT_BOOK_ID).trim();
  if (bookId === "") {
    throw new Error("bookId must be a non-empty string");
  }
  return bookId;
}

interface WorkerReconnect {
  llmEndpoint: string;
  store: KitStoreName;
  fallbackToMemory: boolean;
  baseDir: string;
  workerUrl?: string | URL;
}

/**
 * Host façade over Session. Only `NovelKit.create` — no `new` + `init`.
 *
 * Defaults: `store: "opfs"`, `runtime: "worker"`, `workspace: true`,
 * `fallbackToMemory: true`, `bookId: "default"`, `llmEndpoint: "/api/llm"`.
 * Scenario methods wrap the existing Session (no second copy of the rules).
 */
export class NovelKit {
  readonly runtime: KitRuntime;
  private _bookId: string;
  private _storeKind: KitStoreKind;
  private session: NovelSession;
  private readonly workspaceEnabled: boolean;
  private readonly multiBook: boolean;
  private readonly mainWorkspace: NovelWorkspace | null;
  private readonly bookIndex: KitBookIndex | null;
  private worker: KitWorkerPort | null;
  private readonly workerReconnect: WorkerReconnect | null;
  private closed = false;

  private constructor(args: {
    runtime: KitRuntime;
    bookId: string;
    storeKind: KitStoreKind;
    session: NovelSession;
    workspaceEnabled: boolean;
    multiBook: boolean;
    mainWorkspace: NovelWorkspace | null;
    bookIndex: KitBookIndex | null;
    worker: KitWorkerPort | null;
    workerReconnect: WorkerReconnect | null;
  }) {
    this.runtime = args.runtime;
    this._bookId = args.bookId;
    this._storeKind = args.storeKind;
    this.session = args.session;
    this.workspaceEnabled = args.workspaceEnabled;
    this.multiBook = args.multiBook;
    this.mainWorkspace = args.mainWorkspace;
    this.bookIndex = args.bookIndex;
    this.worker = args.worker;
    this.workerReconnect = args.workerReconnect;
  }

  get bookId(): string {
    return this._bookId;
  }

  get storeKind(): KitStoreKind {
    return this._storeKind;
  }

  static async create(options: NovelKitOptions = {}): Promise<NovelKit> {
    const runtime: KitRuntime = options.runtime ?? "worker";
    const workspaceEnabled = options.workspace !== false;
    const bookId = requireBookId(options.bookId);
    const fallbackToMemory = options.fallbackToMemory !== false;
    const storeOption: KitStoreOption = options.store ?? "opfs";
    const baseDir = resolveOpfsDirectory(options.opfs);

    if (runtime === "main") {
      return NovelKit.createMain({
        options,
        bookId,
        workspaceEnabled,
        fallbackToMemory,
        storeOption,
        baseDir,
      });
    }
    return NovelKit.createWorker({
      options,
      bookId,
      workspaceEnabled,
      fallbackToMemory,
      storeOption,
      baseDir,
    });
  }

  async inspect(options: { prompt?: string } = {}): Promise<InspectResult> {
    this.assertOpen();
    return this.session.inspectFoundation(options);
  }

  async assertReady(options: { prompt?: string } = {}): Promise<void> {
    this.assertOpen();
    return this.session.assertReadyToWrite(options);
  }

  async fillFoundation(patch: FoundationPatch): Promise<FoundationMeta> {
    this.assertOpen();
    return this.session.upsertFoundation(patch);
  }

  async generateFoundation(options: GenerateFoundationOptions): Promise<FoundationMeta> {
    this.assertOpen();
    return this.session.generateFoundation(options);
  }

  async startBook(options: StartAutoWriteOptions): Promise<AutoWriteResult> {
    this.assertOpen();
    return this.session.startAutoWrite(options);
  }

  async assessFoundation(
    patch: FoundationPatch,
    options: AssessFoundationImpactOptions = {},
  ): Promise<FoundationImpactAssessment> {
    this.assertOpen();
    return this.session.assessFoundationImpact(patch, options);
  }

  /**
   * Assess the **proposed** patch, then confirm-gate / upsert / optional chapter
   * writes. Same contract as `session.applyFoundationChange` (`confirmRewrite`,
   * `rewriteChapters` default false, whole-file replace for array keys).
   */
  async applyFoundation(
    options: ApplyFoundationChangeOptions,
  ): Promise<ApplyFoundationChangeResult> {
    this.assertOpen();
    return this.session.applyFoundationChange(options);
  }

  async getChapter(chapter: number): Promise<ChapterView | null> {
    this.assertOpen();
    return this.session.chapter.get(chapter);
  }

  async writeChapter(input: ChapterWriteInput): Promise<ChapterWriteResult> {
    this.assertOpen();
    return this.session.chapter.write(input);
  }

  async saveChapter(chapter: number, markdown: string): Promise<void> {
    this.assertOpen();
    return this.session.chapter.saveFinal(chapter, markdown);
  }

  async getMeta(): Promise<FoundationMeta> {
    this.assertOpen();
    return this.session.getFoundation();
  }

  async getProgress(): Promise<Progress | null> {
    this.assertOpen();
    return this.session.getProgress();
  }

  async listArtifacts(prefix?: string): Promise<string[]> {
    this.assertOpen();
    return prefix !== undefined
      ? this.session.listArtifacts(prefix)
      : this.session.listArtifacts();
  }

  async createBook(options: { bookId?: string; title?: string } = {}): Promise<{ bookId: string }> {
    this.assertOpen();
    this.assertMultiBook();
    if (this.mainWorkspace) {
      const created = await this.mainWorkspace.createBook(options);
      this.session = created.session;
      this._bookId = created.bookId;
      return { bookId: created.bookId };
    }
    const bookId = requireBookId(options.bookId ?? generateBookId());
    if (this.bookIndex && (await this.bookIndex.has(bookId))) {
      throw new Error(`book already exists: ${bookId}`);
    }
    const entry: BookIndexEntry = {
      bookId,
      createdAt: new Date().toISOString(),
    };
    if (options.title !== undefined && options.title.trim() !== "") {
      entry.title = options.title.trim();
    }
    await this.switchWorkerBook(bookId);
    if (this.bookIndex) {
      await this.bookIndex.add(entry, bookId);
    }
    return { bookId };
  }

  async switchBook(bookId: string): Promise<void> {
    this.assertOpen();
    this.assertMultiBook();
    const id = requireBookId(bookId);
    if (this.mainWorkspace) {
      this.session = await this.mainWorkspace.switchTo(id);
      this._bookId = id;
      return;
    }
    if (this.bookIndex && !(await this.bookIndex.has(id))) {
      throw new BookNotFoundError(id);
    }
    await this.switchWorkerBook(id);
    if (this.bookIndex) {
      await this.bookIndex.setCurrent(id);
    }
  }

  async listBooks(): Promise<BookIndexEntry[]> {
    this.assertOpen();
    this.assertMultiBook();
    if (this.mainWorkspace) {
      return this.mainWorkspace.listBooks();
    }
    if (this.bookIndex) {
      return this.bookIndex.list();
    }
    return [];
  }

  async exportBook(): Promise<Uint8Array> {
    this.assertOpen();
    return this.session.exportSnapshot();
  }

  async importBook(bytes: Uint8Array): Promise<void> {
    this.assertOpen();
    return this.session.importSnapshot(bytes);
  }

  subscribe(listener: (event: SessionEvent) => void): SessionUnsubscribe {
    this.assertOpen();
    return this.session.subscribe(listener);
  }

  dispose(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.session.close();
    } catch {
      // Already closed.
    }
    if (this.worker) {
      terminateKitWorker(this.worker);
      this.worker = null;
    }
    if (this.mainWorkspace) {
      void this.mainWorkspace.close();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new KitClosedError();
    }
  }

  private assertMultiBook(): void {
    if (!this.workspaceEnabled) {
      throw new KitWorkspaceDisabledError();
    }
    if (!this.multiBook) {
      throw new KitWorkspaceDisabledError(
        'NovelKit multi-book methods require store: "opfs" or store: "memory" (got a custom StorePort)',
      );
    }
  }

  private async switchWorkerBook(bookId: string): Promise<void> {
    const reconnect = this.workerReconnect;
    if (!reconnect) {
      throw new KitWorkerError("worker reconnect is not configured");
    }
    const next = await openWorkerSession(reconnect, bookId);
    try {
      this.session.close();
    } catch {
      // Previous session may already be closed.
    }
    if (this.worker) {
      terminateKitWorker(this.worker);
    }
    this.session = next.session;
    this.worker = next.worker;
    this._storeKind = next.storeKind;
    this._bookId = bookId;
  }

  private static async createMain(args: {
    options: NovelKitOptions;
    bookId: string;
    workspaceEnabled: boolean;
    fallbackToMemory: boolean;
    storeOption: KitStoreOption;
    baseDir: string;
  }): Promise<NovelKit> {
    const llm = args.options.llm;
    if (llm === undefined) {
      throw new KitLlmRequiredError();
    }
    const custom = isStorePort(args.storeOption) ? args.storeOption : null;
    const named = custom ? null : isNamedStore(args.storeOption) ? args.storeOption : null;
    if (!custom && !named) {
      throw new Error('store must be "opfs", "memory", or a StorePort');
    }
    const multiBook = args.workspaceEnabled && named !== null;

    if (multiBook && named) {
      const memoryCache = named === "memory" ? new Map<string, MemoryStore>() : undefined;
      let storeKind: KitStoreKind = named === "memory" ? "memory" : "opfs";
      const createStore = async (id: string): Promise<StorePort> => {
        const opened = await openNamedStore({
          named,
          bookId: id,
          baseDir: args.baseDir,
          fallbackToMemory: args.fallbackToMemory,
          ...(args.options.opfs !== undefined ? { opfs: args.options.opfs } : {}),
          ...(memoryCache !== undefined ? { memoryCache } : {}),
        });
        storeKind = opened.storeKind;
        return opened.store;
      };
      const indexStore = await openIndexStore({
        named,
        baseDir: args.baseDir,
        fallbackToMemory: args.fallbackToMemory,
        ...(args.options.opfs !== undefined ? { opfs: args.options.opfs } : {}),
      });
      const workspace = createNovelWorkspace({
        createStore,
        llm,
        indexStore,
      });
      const existing = await workspace.listBooks();
      const session = existing.some((entry) => entry.bookId === args.bookId)
        ? await workspace.open(args.bookId)
        : (await workspace.createBook({ bookId: args.bookId })).session;
      return new NovelKit({
        runtime: "main",
        bookId: args.bookId,
        storeKind,
        session,
        workspaceEnabled: true,
        multiBook: true,
        mainWorkspace: workspace,
        bookIndex: null,
        worker: null,
        workerReconnect: null,
      });
    }

    const store = custom
      ? custom
      : (
          await openNamedStore({
            named: named ?? "memory",
            bookId: args.bookId,
            baseDir: args.baseDir,
            fallbackToMemory: args.fallbackToMemory,
            ...(args.options.opfs !== undefined ? { opfs: args.options.opfs } : {}),
          })
        ).store;
    const session = await createNovelSession({
      store,
      bookId: args.bookId,
      llm,
    });
    return new NovelKit({
      runtime: "main",
      bookId: args.bookId,
      storeKind: custom ? "custom" : storeKindOf(store, named ?? "memory"),
      session,
      workspaceEnabled: args.workspaceEnabled,
      multiBook: false,
      mainWorkspace: null,
      bookIndex: null,
      worker: null,
      workerReconnect: null,
    });
  }

  private static async createWorker(args: {
    options: NovelKitOptions;
    bookId: string;
    workspaceEnabled: boolean;
    fallbackToMemory: boolean;
    storeOption: KitStoreOption;
    baseDir: string;
  }): Promise<NovelKit> {
    if (isStorePort(args.storeOption)) {
      throw new KitWorkerError(
        'custom StorePort is not supported with runtime: "worker"; use runtime: "main" or store: "opfs" | "memory"',
      );
    }
    if (!isNamedStore(args.storeOption)) {
      throw new Error('store must be "opfs", "memory", or a StorePort');
    }
    if (args.options.opfs?.root !== undefined || args.options.opfs?.storage !== undefined) {
      throw new KitWorkerError('opfs.root / opfs.storage require runtime: "main"');
    }
    const llmEndpoint = (args.options.llmEndpoint ?? DEFAULT_LLM_ENDPOINT).trim();
    if (llmEndpoint === "") {
      throw new Error("llmEndpoint must be a non-empty string");
    }
    const named: KitStoreName = args.storeOption;
    const workerReconnect: WorkerReconnect = {
      llmEndpoint,
      store: named,
      fallbackToMemory: args.fallbackToMemory,
      baseDir: args.baseDir,
    };
    if (args.options.workerUrl !== undefined) {
      workerReconnect.workerUrl = args.options.workerUrl;
    }

    let bookIndex: KitBookIndex | null = null;
    if (args.workspaceEnabled) {
      const indexStore = await openIndexStore({
        named,
        baseDir: args.baseDir,
        fallbackToMemory: args.fallbackToMemory,
        ...(args.options.opfs !== undefined ? { opfs: args.options.opfs } : {}),
      });
      bookIndex = new KitBookIndex(indexStore);
    }

    const connected = await openWorkerSession(workerReconnect, args.bookId);
    if (bookIndex && !(await bookIndex.has(args.bookId))) {
      await bookIndex.add(
        { bookId: args.bookId, createdAt: new Date().toISOString() },
        args.bookId,
      );
    } else if (bookIndex) {
      await bookIndex.setCurrent(args.bookId);
    }

    return new NovelKit({
      runtime: "worker",
      bookId: args.bookId,
      storeKind: connected.storeKind,
      session: connected.session,
      workspaceEnabled: args.workspaceEnabled,
      multiBook: args.workspaceEnabled,
      mainWorkspace: null,
      bookIndex,
      worker: connected.worker,
      workerReconnect,
    });
  }
}

async function openWorkerSession(reconnect: WorkerReconnect, bookId: string) {
  const connectOpts: Parameters<typeof connectKitWorker>[0] = {
    bookId,
    llmEndpoint: reconnect.llmEndpoint,
    store: reconnect.store,
    fallbackToMemory: reconnect.fallbackToMemory,
    opfsDirectory: bookOpfsDirectory(reconnect.baseDir, bookId),
  };
  if (reconnect.workerUrl !== undefined) {
    connectOpts.workerUrl = reconnect.workerUrl;
  }
  return connectKitWorker(connectOpts);
}
