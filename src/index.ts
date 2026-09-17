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

export { MemoryStore, PATHS, readJson, writeJson, readText, writeText, readJsonl } from "./store/index.js";
export type {
  BookMetadata,
  OutlineEntry,
  Character,
  WorldRule,
  ChapterPlan,
  Checkpoint,
  DecisionRecord,
  RunMeta,
} from "./store/index.js";

export { MockLlm, ReplayLlm } from "./llm/index.js";
export type { MockLlmHandler, MockLlmStep } from "./llm/index.js";

export { createEngine, Engine, EngineError } from "./engine/index.js";
export type { EngineDeps, EngineResult, EngineStopReason } from "./engine/index.js";
