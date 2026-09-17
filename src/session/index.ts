/**
 * Optional same-thread host session (`novel-engine/session`).
 *
 * Not part of the default `novel-engine` / `novel-engine/worker` /
 * `novel-engine/llm` bundles. S0–S3: inspect, upsert/generate foundation,
 * same-thread auto-write, and Session ChapterRunner (`chapter.get` /
 * `saveFinal` / `write`). S4 Worker session bridge is not implemented yet.
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
