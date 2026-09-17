import type { Flow } from "./flow.js";
import type { Phase } from "./phase.js";
import type { PlanningTier } from "./planning-tier.js";

/**
 * Progress facts consumed by `route`. Field names match ainovel-cli `domain.Progress`
 * JSON tags, expressed in TypeScript camelCase.
 */
export interface Progress {
  phase: Phase;
  flow: Flow;
  /** Current chapter cursor; 0 / omitted means not writing yet. */
  currentChapter?: number;
  /**
   * Non-layered: detailed outline chapter count.
   * Layered: internal capacity estimate, not a fixed book length.
   */
  totalChapters: number;
  completedChapters: readonly number[];
  pendingRewrites: readonly number[];
  layered: boolean;
  /**
   * Optional planning scale. Session / `foundationMissing` prefer
   * `meta/run_meta.json` when this is omitted.
   */
  planningTier?: PlanningTier | "";
}

/** Largest completed chapter number; 0 when none are complete. */
export function latestCompleted(progress: Progress): number {
  let max = 0;
  for (const chapter of progress.completedChapters) {
    if (chapter > max) {
      max = chapter;
    }
  }
  return max;
}

/** Next chapter to write: latest completed + 1. */
export function nextChapter(progress: Progress): number {
  return latestCompleted(progress) + 1;
}

export function isResumable(progress: Progress): boolean {
  return progress.phase === "writing" && (progress.currentChapter ?? 0) > 0;
}
