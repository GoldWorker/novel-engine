import type { AgentId, PlanningTier, Progress } from "../domain/index.js";
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

/** Present foundation artifacts; each field is `null` when the file is absent. */
export interface FoundationMeta {
  book: BookMetadata | null;
  premise: string | null;
  outline: OutlineEntry[] | null;
  layeredOutline: VolumeOutline[] | null;
  characters: Character[] | null;
  worldRules: WorldRule[] | null;
  audit: FoundationAudit | null;
  progress: Progress | null;
}

/** One missing foundation artifact, aligned with `foundationMissing` keys. */
export interface FoundationGap {
  key: string;
  path: string;
  requiredFor: string;
  hint: string;
}

/** Planning scale used to build the gap table (`inferPlanningStub` / store). */
export interface PlanningInfo {
  tier: PlanningTier;
  planner: AgentId;
  label: string;
  source: PlanningSource;
}

export type PlanningSource = "prompt" | "run_meta" | "progress" | "layered_outline" | "default";

export interface InspectResult {
  meta: FoundationMeta;
  gaps: FoundationGap[];
  readyToWrite: boolean;
  planning: PlanningInfo;
}

export interface CreateNovelSessionOptions {
  store: StorePort;
  /** Accepted for S2+ forward compatibility; unused in S1. */
  llm?: LlmPort;
  bookId: string;
}

export interface NovelSession {
  readonly bookId: string;
  getFoundation(): Promise<FoundationMeta>;
  getProgress(): Promise<Progress | null>;
  inspectFoundation(options?: { prompt?: string }): Promise<InspectResult>;
  assertReadyToWrite(options?: { prompt?: string }): Promise<void>;
  listArtifacts(prefix?: string): Promise<string[]>;
  exportSnapshot(): Promise<Uint8Array>;
  importSnapshot(bytes: Uint8Array): Promise<void>;
  close(): void;
}

export interface CreateNovelWorkspaceOptions {
  /**
   * Host factory: one `StorePort` instance per `bookId`.
   * Memory tests should return a cached `MemoryStore` (or let the workspace cache it).
   */
  createStore: (bookId: string) => StorePort | Promise<StorePort>;
  /** Forward-compat; unused in S1. */
  llm?: LlmPort;
  /** Optional dedicated store for the lightweight `_index.json` book list. */
  indexStore?: StorePort;
}

export interface BookIndexEntry {
  bookId: string;
  createdAt: string;
  title?: string;
}

export interface CreateBookResult {
  bookId: string;
  session: NovelSession;
}

export interface NovelWorkspace {
  createBook(options?: { bookId?: string; title?: string }): Promise<CreateBookResult>;
  open(bookId: string): Promise<NovelSession>;
  switchTo(bookId: string): Promise<NovelSession>;
  listBooks(): Promise<BookIndexEntry[]>;
  close(): Promise<void>;
  readonly currentBookId: string | null;
}

export interface WorkspaceIndex {
  version: 1;
  books: BookIndexEntry[];
  currentBookId?: string;
}

/** Logical path of the workspace book index (index store only). */
export const WORKSPACE_INDEX_PATH = "_index.json";
