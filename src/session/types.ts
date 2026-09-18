import type { AgentId, PlanningTier, Progress } from "../domain/index.js";
import type { EngineResult } from "../engine/index.js";
import type { Instruction } from "../flow/instruction.js";
import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import type {
  BookMetadata,
  ChapterPlan,
  ChapterSummary,
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
  /** Required for S2 generate / auto-write, S3 `chapter.write`, and S6 rewriteChapters. Optional for inspect / S5 heuristics. */
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

export const FOUNDATION_IMPACT_SEVERITIES = ["meta_only", "forward_only", "rewrite_needed"] as const;
export type FoundationImpactSeverity = (typeof FOUNDATION_IMPACT_SEVERITIES)[number];

export const FOUNDATION_IMPACT_MODES = ["none", "polish", "rewrite"] as const;
export type FoundationImpactMode = (typeof FOUNDATION_IMPACT_MODES)[number];

export interface ChapterRange {
  start: number;
  end: number;
}

export interface AssessFoundationImpactOptions {
  /**
   * When true and an `LlmPort` is present, refine the heuristics with a
   * structured one-shot JSON completion. Default false (rules-first).
   */
  refineWithLlm?: boolean;
}

/** Pure assessment of a proposed foundation patch. Never mutates the store. */
export interface FoundationImpactAssessment {
  severity: FoundationImpactSeverity;
  /** Written chapters that may need rewrite/polish (sorted, unique). */
  suggestedChapters: number[];
  /** Compact ranges derived from `suggestedChapters` (inclusive). */
  suggestedRanges: ChapterRange[];
  suggestedMode: FoundationImpactMode;
  /** Host UI reasons (Chinese + short English). */
  reasons: string[];
  notes: string[];
  /** Foundation keys whose content actually differs from the store. */
  changedKeys: FoundationKey[];
  source: "heuristics" | "llm";
}

export interface ApplyFoundationChangeOptions {
  patch: FoundationPatch;
  refineWithLlm?: boolean;
  /**
   * When true (default) and severity is `rewrite_needed`, return
   * `{ status: "needs_confirm" }` without upsert or chapter writes.
   */
  requireConfirmRewrite?: boolean;
  /** Host acknowledgement required to apply a `rewrite_needed` patch. */
  confirmRewrite?: boolean;
  /**
   * Host opt-in: after upsert, sequentially `chapter.write` suggested chapters.
   * Default false — chapters never auto-rewrite.
   */
  rewriteChapters?: boolean;
  /** Override `assessment.suggestedChapters` (still filtered to written finals). */
  chapters?: readonly number[];
  /** Override `assessment.suggestedMode` when rewriting (`rewrite` | `polish`). */
  mode?: Exclude<FoundationImpactMode, "none">;
  instruction?: string;
}

export interface ApplyFoundationNeedsConfirm {
  status: "needs_confirm";
  assessment: FoundationImpactAssessment;
}

export interface ApplyFoundationApplied {
  status: "applied";
  assessment: FoundationImpactAssessment;
  meta: FoundationMeta;
  writes: ChapterWriteResult[];
}

export type ApplyFoundationChangeResult = ApplyFoundationNeedsConfirm | ApplyFoundationApplied;

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

export const CHAPTER_WRITE_MODES = ["create", "continue", "rewrite", "polish"] as const;
export type ChapterWriteMode = (typeof CHAPTER_WRITE_MODES)[number];

export interface ChapterView {
  chapter: number;
  plan: ChapterPlan | null;
  draft: string | null;
  final: string | null;
  summary: ChapterSummary | null;
}

export interface ChapterWriteInput {
  chapter: number;
  mode: ChapterWriteMode;
  instruction?: string;
  title?: string;
  /** When `mode` is `create` and a final already exists, overwrite instead of `ChapterConflictError`. */
  force?: boolean;
}

export interface ChapterWriteResult {
  chapter: number;
  mode: ChapterWriteMode;
  view: ChapterView;
  turns: number;
}

export interface ChapterRunner {
  get(chapter: number): Promise<ChapterView | null>;
  saveFinal(chapter: number, markdown: string): Promise<void>;
  write(input: ChapterWriteInput): Promise<ChapterWriteResult>;
}

export type SessionEvent =
  | { type: "foundation_updated"; meta: FoundationMeta }
  | { type: "auto_write_step"; step: number; instruction: Instruction }
  | { type: "stopped"; result: AutoWriteResult }
  | { type: "chapter_step"; chapter: number; mode: ChapterWriteMode; step: number; tool?: string };

export type SessionUnsubscribe = () => void;

export interface NovelSession {
  readonly bookId: string;
  readonly chapter: ChapterRunner;
  getFoundation(): Promise<FoundationMeta>;
  getProgress(): Promise<Progress | null>;
  inspectFoundation(options?: { prompt?: string }): Promise<InspectResult>;
  assertReadyToWrite(options?: { prompt?: string }): Promise<void>;
  listArtifacts(prefix?: string): Promise<string[]>;
  exportSnapshot(): Promise<Uint8Array>;
  importSnapshot(bytes: Uint8Array): Promise<void>;
  upsertFoundation(patch: FoundationPatch): Promise<FoundationMeta>;
  generateFoundation(options: GenerateFoundationOptions): Promise<FoundationMeta>;
  /**
   * Rules-first impact assessment of a proposed foundation patch.
   * Optional LLM refinement when `refineWithLlm` and `llm` are set.
   * Must not mutate the store or rewrite chapters.
   */
  assessFoundationImpact(
    patch: FoundationPatch,
    options?: AssessFoundationImpactOptions,
  ): Promise<FoundationImpactAssessment>;
  /**
   * Assess → confirm gate for `rewrite_needed` → `upsertFoundation` →
   * optional sequential `chapter.write` for suggested chapters.
   */
  applyFoundationChange(options: ApplyFoundationChangeOptions): Promise<ApplyFoundationChangeResult>;
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
  /** Forwarded to each book session (required for S2 generate / auto-write and S3 `chapter.write`). */
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
