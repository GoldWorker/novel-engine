/**
 * Dedicated Worker entry (`novel-engine/worker`).
 *
 * Tree-shakeable separate bundle so hosts can `new Worker(new URL(..., import.meta.url))`
 * without pulling the main-thread client into the worker (and vice versa).
 */
export { attachEngineWorker } from "./host/server.js";
export type { EngineWorkerOptions, EngineWorkerPorts } from "./host/server.js";
export type { MessagePortLike, MessageListener } from "./host/client.js";

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

export { createEngine, Engine, EngineError } from "./engine/index.js";
export type {
  EngineDeps,
  EngineResult,
  EngineStopReason,
  EngineLoopEvent,
} from "./engine/index.js";

export {
  MemoryStore,
  OpfsStore,
  createOpfsStore,
  isOpfsAvailable,
  OpfsUnavailableError,
  exportBookSnapshot,
  importBookSnapshot,
  SnapshotError,
  BOOK_SNAPSHOT_FORMAT,
  BOOK_SNAPSHOT_VERSION,
  BOOK_SNAPSHOT_MANIFEST_PATH,
} from "./store/index.js";
export type {
  OpfsStoreOptions,
  CreateOpfsStoreOptions,
  BookSnapshotManifest,
} from "./store/index.js";

export { MockLlm, ReplayLlm } from "./llm/index.js";
export type { StorePort, LlmPort } from "./ports/index.js";
