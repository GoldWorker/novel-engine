export { MemoryStore } from "./memory.js";
export {
  OpfsStore,
  createOpfsStore,
  isOpfsAvailable,
  OpfsUnavailableError,
} from "./opfs.js";
export type { OpfsStoreOptions, CreateOpfsStoreOptions } from "./opfs.js";
export type {
  OpfsDirectoryHandle,
  OpfsFileHandle,
  OpfsStorageManager,
  OpfsWritableFileStream,
} from "./opfs-handles.js";
export { PATHS, padChapter, chapterPlanPath, chapterDraftPath, chapterFinalPath } from "./paths.js";
export { readJson, writeJson, readText, writeText, readJsonl } from "./io.js";
export { assembleState } from "./state.js";
export { foundationMissing, foundationFingerprint } from "./foundation.js";
export type {
  BookMetadata,
  OutlineEntry,
  Character,
  WorldRule,
  ChapterPlan,
  FoundationAudit,
  Checkpoint,
  DecisionRecord,
  RunMeta,
  PlanStartRecord,
  PendingSteer,
} from "./artifacts.js";
