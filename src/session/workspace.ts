import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import { readJson, writeJson } from "../store/io.js";
import { BookNotFoundError, WorkspaceClosedError } from "./errors.js";
import { createNovelSession, NovelSessionImpl } from "./novel-session.js";
import type {
  BookIndexEntry,
  CreateBookResult,
  CreateNovelWorkspaceOptions,
  NovelSession,
  NovelWorkspace,
  WorkspaceIndex,
} from "./types.js";
import { WORKSPACE_INDEX_PATH } from "./types.js";

function generateBookId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `book-${Date.now().toString(36)}-${rand}`;
}

export class NovelWorkspaceImpl implements NovelWorkspace {
  private readonly createStoreFn: CreateNovelWorkspaceOptions["createStore"];
  private readonly llm: LlmPort | undefined;
  private readonly indexStore: StorePort | undefined;
  private readonly stores = new Map<string, StorePort>();
  private readonly books = new Map<string, BookIndexEntry>();
  private current: NovelSessionImpl | null = null;
  private currentId: string | null = null;
  private indexLoaded = false;
  private closed = false;

  constructor(options: CreateNovelWorkspaceOptions) {
    this.createStoreFn = options.createStore;
    this.llm = options.llm;
    this.indexStore = options.indexStore;
  }

  get currentBookId(): string | null {
    return this.currentId;
  }

  async createBook(options: { bookId?: string; title?: string } = {}): Promise<CreateBookResult> {
    this.assertOpen();
    await this.ensureIndex();
    const bookId = (options.bookId ?? generateBookId()).trim();
    if (bookId === "") {
      throw new Error("bookId must be a non-empty string");
    }
    if (this.books.has(bookId)) {
      throw new Error(`book already exists: ${bookId}`);
    }
    const entry: BookIndexEntry = {
      bookId,
      createdAt: new Date().toISOString(),
    };
    if (options.title !== undefined && options.title.trim() !== "") {
      entry.title = options.title.trim();
    }
    this.books.set(bookId, entry);
    await this.persistIndex();
    const session = await this.openSession(bookId);
    return { bookId, session };
  }

  async open(bookId: string): Promise<NovelSession> {
    this.assertOpen();
    await this.ensureIndex();
    const id = bookId.trim();
    if (!this.books.has(id)) {
      throw new BookNotFoundError(id);
    }
    return this.openSession(id);
  }

  async switchTo(bookId: string): Promise<NovelSession> {
    return this.open(bookId);
  }

  async listBooks(): Promise<BookIndexEntry[]> {
    this.assertOpen();
    await this.ensureIndex();
    return [...this.books.values()].map((entry) => ({ ...entry }));
  }

  async close(): Promise<void> {
    if (this.current) {
      this.current.close();
    }
    this.current = null;
    this.currentId = null;
    this.closed = true;
  }

  private async openSession(bookId: string): Promise<NovelSession> {
    if (this.current && this.current.bookId === bookId && !this.current.isClosed) {
      return this.current;
    }
    if (this.current) {
      this.current.close();
      this.current = null;
    }
    const store = await this.storeFor(bookId);
    const created = await createNovelSession(this.sessionOptions(bookId, store));
    const session = created as NovelSessionImpl;
    this.current = session;
    this.currentId = bookId;
    await this.persistIndex();
    return session;
  }

  private sessionOptions(
    bookId: string,
    store: StorePort,
  ): { store: StorePort; bookId: string; llm?: LlmPort } {
    const options: { store: StorePort; bookId: string; llm?: LlmPort } = { store, bookId };
    if (this.llm !== undefined) {
      options.llm = this.llm;
    }
    return options;
  }

  private async storeFor(bookId: string): Promise<StorePort> {
    const cached = this.stores.get(bookId);
    if (cached) {
      return cached;
    }
    const store = await this.createStoreFn(bookId);
    this.stores.set(bookId, store);
    return store;
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexLoaded) {
      return;
    }
    this.indexLoaded = true;
    if (this.indexStore === undefined) {
      return;
    }
    const data = await readJson<WorkspaceIndex>(this.indexStore, WORKSPACE_INDEX_PATH);
    if (data == null || !Array.isArray(data.books)) {
      return;
    }
    for (const entry of data.books) {
      if (typeof entry?.bookId === "string" && entry.bookId.trim() !== "") {
        this.books.set(entry.bookId, { ...entry });
      }
    }
    if (typeof data.currentBookId === "string" && this.books.has(data.currentBookId)) {
      this.currentId = data.currentBookId;
    }
  }

  private async persistIndex(): Promise<void> {
    if (this.indexStore === undefined) {
      return;
    }
    const payload: WorkspaceIndex = {
      version: 1,
      books: [...this.books.values()].map((entry) => ({ ...entry })),
    };
    if (this.currentId !== null) {
      payload.currentBookId = this.currentId;
    }
    await writeJson(this.indexStore, WORKSPACE_INDEX_PATH, payload);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new WorkspaceClosedError();
    }
  }
}

export function createNovelWorkspace(options: CreateNovelWorkspaceOptions): NovelWorkspace {
  if (typeof options.createStore !== "function") {
    throw new Error("createStore factory is required");
  }
  return new NovelWorkspaceImpl(options);
}
