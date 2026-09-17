/**
 * Optional same-thread host session (`novel-engine/session`).
 *
 * Not part of the default `novel-engine` / `novel-engine/worker` /
 * `novel-engine/llm` bundles. S0+S1: inspect foundation and a multi-book
 * workspace. S2 `generateFoundation`, S3 ChapterRunner, and S4 Worker
 * session bridge are not implemented yet.
 */
export type {
  BookIndexEntry,
  CreateBookResult,
  CreateNovelSessionOptions,
  CreateNovelWorkspaceOptions,
  FoundationGap,
  FoundationMeta,
  InspectResult,
  NovelSession,
  NovelWorkspace,
  PlanningInfo,
  PlanningSource,
  WorkspaceIndex,
} from "./types.js";
export { WORKSPACE_INDEX_PATH } from "./types.js";

export {
  BookNotFoundError,
  FoundationIncompleteError,
  SessionClosedError,
  WorkspaceClosedError,
} from "./errors.js";

export { createNovelSession } from "./novel-session.js";
export { createNovelWorkspace } from "./workspace.js";
