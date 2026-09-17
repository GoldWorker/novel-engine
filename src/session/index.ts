/**
 * Optional same-thread host session (`novel-engine/session`).
 *
 * Not part of the default `novel-engine` / `novel-engine/worker` /
 * `novel-engine/llm` bundles. S0–S2: inspect, upsert/generate foundation,
 * and same-thread auto-write. S3 ChapterRunner and S4 Worker session
 * bridge are not implemented yet.
 */
export type {
  AutoWriteEngineOutcome,
  AutoWriteNeedsFoundation,
  AutoWriteResult,
  BookIndexEntry,
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
export { FOUNDATION_KEYS, WORKSPACE_INDEX_PATH } from "./types.js";

export {
  BookNotFoundError,
  FoundationGenerateError,
  FoundationIncompleteError,
  SessionClosedError,
  SessionLlmRequiredError,
  WorkspaceClosedError,
} from "./errors.js";

export { createNovelSession } from "./novel-session.js";
export { createNovelWorkspace } from "./workspace.js";
