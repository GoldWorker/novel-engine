import type { AgentId, PlanningTier, Progress } from "../domain/index.js";
import type { EngineResult } from "../engine/index.js";
import type { Instruction } from "../flow/instruction.js";
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
  /** Required for S2 `generateFoundation` / `startAutoWrite`. Optional for inspect-only. */
  llm?: LlmPort;
  bookId: string;
}

export const FOUNDATION_KEYS = [
  "book",
  "premise",
  "outline",
  "layered_outline",
  "characters",
  "world_rules",
] as const;

export type FoundationKey = (typeof FOUNDATION_KEYS)[number];

export type FoundationGenerateMode = "fill_missing" | "overwrite";

/** Partial foundation write. Omitted fields are left unchanged. */
export interface FoundationPatch {
  book?: BookMetadata;
  premise?: string;
  outline?: OutlineEntry[];
  layeredOutline?: VolumeOutline[];
  characters?: Character[];
  worldRules?: WorldRule[];
}

export interface GenerateFoundationOptions {
  prompt: string;
  keys: readonly FoundationKey[];
  mode?: FoundationGenerateMode;
}

export interface StartAutoWriteOptions {
  prompt: string;
  foundation?: FoundationPatch;
  generateMissing?: boolean;
  /**
   * When true (default) and gaps remain after optional generate, return
   * `{ status: "needs_foundation" }` without `Engine.run`.
   */
  requireConfirmGaps?: boolean;
  maxSteps?: number;
}

export interface AutoWriteNeedsFoundation {
  status: "needs_foundation";
  gaps: FoundationGap[];
  meta: FoundationMeta;
}

export interface AutoWriteEngineOutcome {
  status: "completed" | "stopped";
  result: EngineResult;
  meta: FoundationMeta;
}

export type AutoWriteResult = AutoWriteNeedsFoundation | AutoWriteEngineOutcome;

export type SessionEvent =
  | { type: "foundation_updated"; meta: FoundationMeta }
  | { type: "auto_write_step"; step: number; instruction: Instruction }
  | { type: "stopped"; result: AutoWriteResult };

export type SessionUnsubscribe = () => void;

export interface NovelSession {
  readonly bookId: string;
  getFoundation(): Promise<FoundationMeta>;
  getProgress(): Promise<Progress | null>;
  inspectFoundation(options?: { prompt?: string }): Promise<InspectResult>;
  assertReadyToWrite(options?: { prompt?: string }): Promise<void>;
  listArtifacts(prefix?: string): Promise<string[]>;
  exportSnapshot(): Promise<Uint8Array>;
  importSnapshot(bytes: Uint8Array): Promise<void>;
  upsertFoundation(patch: FoundationPatch): Promise<FoundationMeta>;
  generateFoundation(options: GenerateFoundationOptions): Promise<FoundationMeta>;
  startAutoWrite(options: StartAutoWriteOptions): Promise<AutoWriteResult>;
  subscribe(listener: (event: SessionEvent) => void): SessionUnsubscribe;
  close(): void;
}

export interface CreateNovelWorkspaceOptions {
  /**
   * Host factory: one `StorePort` instance per `bookId`.
   * Memory tests should return a cached `MemoryStore` (or let the workspace cache it).
   */
  createStore: (bookId: string) => StorePort | Promise<StorePort>;
  /** Forwarded to each book session (required for S2 generate / auto-write). */
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
