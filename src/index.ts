export type {
  AgentId,
  Phase,
  Flow,
  PlanningTier,
  Progress,
  ArcBoundary,
} from "./domain/index.js";
export {
  AGENTS,
  PHASES,
  FLOWS,
  PLANNING_TIERS,
  canTransitionPhase,
  validatePhaseTransition,
  PhaseTransitionError,
  canTransitionFlow,
  validateFlowTransition,
  FlowTransitionError,
  plannerForTier,
  latestCompleted,
  nextChapter,
  isResumable,
  REVIEW_INTERVAL,
  shouldReview,
} from "./domain/index.js";

export type {
  Instruction,
  AggregateKind,
  AggregateRefresh,
  State,
} from "./flow/index.js";
export { route } from "./flow/index.js";

export type {
  StorePort,
  LlmPort,
  LlmRole,
  LlmMessage,
  LlmToolSpec,
  LlmToolCall,
  LlmCompletionRequest,
  LlmCompletionResult,
} from "./ports/index.js";

export {
  MemoryStore,
  OpfsStore,
  createOpfsStore,
  isOpfsAvailable,
  OpfsUnavailableError,
  PATHS,
  readJson,
  writeJson,
  readText,
  writeText,
  readJsonl,
  flattenOutline,
  estimatedChapterCapacity,
  checkArcBoundary,
  completedArcBoundaries,
  assembleNovelContext,
  SLIDING_SUMMARY_WINDOW,
  chapterSummaryPath,
  arcSummaryPath,
  volumeSummaryPath,
  arcReviewPath,
  globalReviewPath,
} from "./store/index.js";
export type {
  BookMetadata,
  OutlineEntry,
  VolumeOutline,
  ArcOutline,
  ArcExpansion,
  Character,
  WorldRule,
  ChapterPlan,
  ChapterSummary,
  ArcSummary,
  VolumeSummary,
  ReviewEntry,
  Checkpoint,
  DecisionRecord,
  RunMeta,
  PendingSteer,
  OpfsStoreOptions,
  CreateOpfsStoreOptions,
  OpfsDirectoryHandle,
  OpfsFileHandle,
  OpfsStorageManager,
} from "./store/index.js";

export { MockLlm, ReplayLlm } from "./llm/index.js";
export type { MockLlmHandler, MockLlmStep } from "./llm/index.js";

export { createEngine, Engine, EngineError } from "./engine/index.js";
export { inferPlanningStub } from "./engine/plan-start.js";
export type {
  EngineDeps,
  EngineResult,
  EngineStopReason,
  EngineLoopEvent,
} from "./engine/index.js";

export { createEngineClient } from "./host/client.js";
export type { EngineClient, MessagePortLike, MessageListener } from "./host/client.js";
export {
  ENGINE_PROTOCOL,
  isEngineCommand,
  isEngineNotice,
  loopEventToHost,
} from "./host/protocol.js";
export type {
  EngineCommand,
  EngineCommandType,
  EngineNotice,
  EngineNoticeType,
  EngineHostEvent,
  EngineSnapshot,
  EngineStartCommand,
  EngineSteerCommand,
  EnginePauseCommand,
  EngineResumeCommand,
  EngineSnapshotCommand,
  EngineEventNotice,
  EngineSnapshotNotice,
  EngineErrorNotice,
} from "./host/protocol.js";
