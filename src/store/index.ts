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
export { PATHS, padChapter, chapterPlanPath, chapterDraftPath, chapterFinalPath, globalReviewPath, arcReviewPath, chapterSummaryPath, arcSummaryPath, volumeSummaryPath } from "./paths.js";
export { readJson, writeJson, readText, writeText, readJsonl } from "./io.js";
export { assembleState } from "./state.js";
export {
  exportBookSnapshot,
  importBookSnapshot,
  SnapshotError,
  BOOK_SNAPSHOT_FORMAT,
  BOOK_SNAPSHOT_VERSION,
  BOOK_SNAPSHOT_MANIFEST_PATH,
} from "./snapshot.js";
export type { BookSnapshotManifest } from "./snapshot.js";
export { assembleNovelContext, SLIDING_SUMMARY_WINDOW } from "./context.js";
export {
  flattenOutline,
  estimatedChapterCapacity,
  checkArcBoundary,
  completedArcBoundaries,
  loadLayeredOutline,
  parseLayeredVolumes,
} from "./layered.js";
export {
  foundationMissing,
  foundationFingerprint,
  hasValidLayeredOutline,
  resolveFoundationTier,
} from "./foundation.js";
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
  ReviewIssue,
  FoundationAudit,
  Checkpoint,
  DecisionRecord,
  RunMeta,
  PlanStartRecord,
  PendingSteer,
} from "./artifacts.js";
