/**
 * Optional same-thread host session (`novel-engine/session`).
 *
 * Not part of the default `novel-engine` / `novel-engine/worker` /
 * `novel-engine/llm` bundles. S0–S4: inspect, upsert/generate foundation,
 * same-thread auto-write, Session ChapterRunner, and a Worker bridge
 * (`createSessionClient` / `attachSessionWorker`) that adapts the same
 * `NovelSession` over messages. Default worker entry still does not import session.
 */
export type {
  AutoWriteEngineOutcome,
  AutoWriteNeedsFoundation,
  AutoWriteResult,
  BookIndexEntry,
  ChapterRunner,
  ChapterView,
  ChapterWriteInput,
  ChapterWriteMode,
  ChapterWriteResult,
  CreateBookResult,
  CreateNovelSessionOptions,
  CreateNovelWorkspaceOptions,
  FoundationGap,
  FoundationGenerateMode,
  FoundationKey,
  FoundationMeta,
  FoundationPatch,
  GenerateFoundationOptions,
  InspectResult,
  NovelSession,
  NovelWorkspace,
  PlanningInfo,
  PlanningSource,
  SessionEvent,
  SessionUnsubscribe,
  StartAutoWriteOptions,
  WorkspaceIndex,
} from "./types.js";
export { CHAPTER_WRITE_MODES, FOUNDATION_KEYS, WORKSPACE_INDEX_PATH } from "./types.js";

export {
  BookNotFoundError,
  ChapterConflictError,
  ChapterRunnerError,
  FoundationGenerateError,
  FoundationIncompleteError,
  SessionBusyError,
  SessionClosedError,
  SessionLlmRequiredError,
  WorkspaceClosedError,
} from "./errors.js";

export { createNovelSession } from "./novel-session.js";
export { createNovelWorkspace } from "./workspace.js";

export { createSessionClient } from "./client.js";
export type { CreateSessionClientOptions, SessionClient } from "./client.js";
export { attachSessionWorker } from "./server.js";
export type { SessionWorkerOptions } from "./server.js";
export {
  SESSION_NS,
  SESSION_PROTOCOL,
  isSessionCommand,
  isSessionNotice,
  restoreSessionError,
  serializeSessionError,
} from "./protocol.js";
export type {
  MessagePortLike,
  SessionCommand,
  SessionCommandType,
  SessionErrorNotice,
  SessionEventNotice,
  SessionNotice,
  SessionNoticeType,
  SessionResultNotice,
} from "./protocol.js";
