import type { Progress } from "../domain/progress.js";
import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import type {
  BookMetadata,
  Character,
  FoundationAudit,
  OutlineEntry,
  VolumeOutline,
  WorldRule,
} from "../store/artifacts.js";
import { foundationMissing } from "../store/foundation.js";
import { readJson, readText } from "../store/io.js";
import { loadLayeredOutline } from "../store/layered.js";
import { listStorePaths } from "../store/list-paths.js";
import { PATHS } from "../store/paths.js";
import { exportBookSnapshot, importBookSnapshot } from "../store/snapshot.js";
import { FoundationIncompleteError, SessionClosedError } from "./errors.js";
import { gapsFromMissing } from "./gaps.js";
import { resolveSessionPlanning } from "./planning.js";
import type {
  CreateNovelSessionOptions,
  FoundationMeta,
  InspectResult,
  NovelSession,
} from "./types.js";

function asArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}

export class NovelSessionImpl implements NovelSession {
  readonly bookId: string;
  readonly store: StorePort;
  /** Forward-compat for S2 generateFoundation. */
  readonly llm: LlmPort | undefined;
  private closed = false;

  constructor(options: CreateNovelSessionOptions) {
    this.bookId = options.bookId;
    this.store = options.store;
    this.llm = options.llm;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
  }

  async getFoundation(): Promise<FoundationMeta> {
    this.assertOpen();
    const book = await readJson<BookMetadata>(this.store, PATHS.book);
    const premise = await readText(this.store, PATHS.premise);
    const outline = asArray<OutlineEntry>(await readJson<unknown>(this.store, PATHS.outline));
    const layeredOutline = await loadLayeredOutline(this.store);
    const characters = asArray<Character>(await readJson<unknown>(this.store, PATHS.characters));
    const worldRules = asArray<WorldRule>(await readJson<unknown>(this.store, PATHS.worldRules));
    const audit = await readJson<FoundationAudit>(this.store, PATHS.foundationAudit);
    const progress = await this.store.loadProgress();
    return {
      book,
      premise,
      outline,
      layeredOutline,
      characters,
      worldRules,
      audit,
      progress,
    };
  }

  async getProgress(): Promise<Progress | null> {
    this.assertOpen();
    return this.store.loadProgress();
  }

  async inspectFoundation(options: { prompt?: string } = {}): Promise<InspectResult> {
    this.assertOpen();
    const planning = await resolveSessionPlanning(this.store, options.prompt);
    const missing = await foundationMissing(this.store, planning.tier);
    const gaps = gapsFromMissing(missing, planning);
    return {
      meta: await this.getFoundation(),
      gaps,
      readyToWrite: gaps.length === 0,
      planning,
    };
  }

  async assertReadyToWrite(options: { prompt?: string } = {}): Promise<void> {
    const inspected = await this.inspectFoundation(options);
    if (!inspected.readyToWrite) {
      throw new FoundationIncompleteError(inspected.gaps);
    }
  }

  async listArtifacts(prefix?: string): Promise<string[]> {
    this.assertOpen();
    return listStorePaths(this.store, prefix ?? "");
  }

  async exportSnapshot(): Promise<Uint8Array> {
    this.assertOpen();
    return exportBookSnapshot(this.store);
  }

  async importSnapshot(bytes: Uint8Array): Promise<void> {
    this.assertOpen();
    await importBookSnapshot(this.store, bytes);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SessionClosedError();
    }
  }
}

export async function createNovelSession(
  options: CreateNovelSessionOptions,
): Promise<NovelSession> {
  const bookId = options.bookId.trim();
  if (bookId === "") {
    throw new Error("bookId must be a non-empty string");
  }
  const next: CreateNovelSessionOptions = { store: options.store, bookId };
  if (options.llm !== undefined) {
    next.llm = options.llm;
  }
  return new NovelSessionImpl(next);
}
