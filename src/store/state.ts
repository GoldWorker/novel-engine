import type { AggregateRefresh } from "../flow/instruction.js";
import type { State } from "../flow/state.js";
import { latestCompleted } from "../domain/progress.js";
import { REVIEW_INTERVAL, shouldReview } from "../domain/review.js";
import type { StorePort } from "../ports/store.js";
import type { RunMeta } from "./artifacts.js";
import { foundationMissing } from "./foundation.js";
import { readJson } from "./io.js";
import {
  completedArcBoundaries,
  checkArcBoundary,
  loadLayeredOutline,
} from "./layered.js";
import { arcReviewPath, arcSummaryPath, globalReviewPath, PATHS, volumeSummaryPath } from "./paths.js";

/**
 * Assemble the pure `route` snapshot from a path-keyed store.
 * IO lives here; `route` never reads the adapter.
 */
export async function assembleState(store: StorePort): Promise<State> {
  const missing = await foundationMissing(store);
  const meta = await readJson<RunMeta>(store, PATHS.runMeta);
  const progress = await store.loadProgress();

  const state: State = {
    foundationMissing: missing,
    planningTier: meta?.planningTier ?? "",
  };

  if (progress == null) {
    return state;
  }

  const lastCompleted = latestCompleted(progress);
  const next: State = {
    ...state,
    progress,
    lastCompleted,
  };

  if (progress.layered && lastCompleted > 0) {
    const volumes = await loadLayeredOutline(store);
    if (volumes) {
      const completed = completedArcBoundaries(volumes, lastCompleted);
      for (const boundary of completed) {
        if (!(await store.has(arcReviewPath(boundary.endChapter)))) {
          next.aggregateRefresh = refreshFrom("arc_review", boundary);
          break;
        }
        if (!(await store.has(arcSummaryPath(boundary.volume, boundary.arc)))) {
          next.aggregateRefresh = refreshFrom("arc_summary", boundary);
          break;
        }
        if (boundary.isVolumeEnd && !(await store.has(volumeSummaryPath(boundary.volume)))) {
          next.aggregateRefresh = refreshFrom("volume_summary", boundary);
          break;
        }
      }

      const boundary = checkArcBoundary(volumes, lastCompleted);
      if (boundary) {
        next.arcBoundary = boundary;
        if (boundary.isArcEnd) {
          next.hasArcReview = await store.has(arcReviewPath(lastCompleted));
          next.hasArcSummary = await store.has(arcSummaryPath(boundary.volume, boundary.arc));
          if (boundary.isVolumeEnd) {
            next.hasVolumeSummary = await store.has(volumeSummaryPath(boundary.volume));
          }
        }
      }
    }
  }

  if (!progress.layered && lastCompleted > 0) {
    let aggregateRefresh: AggregateRefresh | null = null;
    for (
      let count = REVIEW_INTERVAL;
      count <= progress.completedChapters.length;
      count += REVIEW_INTERVAL
    ) {
      const chapter = progress.completedChapters[count - 1];
      if (chapter === undefined) {
        continue;
      }
      if (!(await store.has(globalReviewPath(chapter)))) {
        aggregateRefresh = {
          kind: "global_review",
          volume: 0,
          arc: 0,
          startChapter: 0,
          endChapter: chapter,
        };
        break;
      }
    }
    if (aggregateRefresh) {
      next.aggregateRefresh = aggregateRefresh;
    }
    if (shouldReview(progress.completedChapters.length).due) {
      next.hasGlobalReview = await store.has(globalReviewPath(lastCompleted));
    }
  }

  return next;
}

function refreshFrom(
  kind: AggregateRefresh["kind"],
  boundary: {
    volume: number;
    arc: number;
    startChapter: number;
    endChapter: number;
  },
): AggregateRefresh {
  return {
    kind,
    volume: boundary.volume,
    arc: boundary.arc,
    startChapter: boundary.startChapter,
    endChapter: boundary.endChapter,
  };
}
