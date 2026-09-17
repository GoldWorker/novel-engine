import type { AggregateRefresh } from "../flow/instruction.js";
import type { State } from "../flow/state.js";
import { latestCompleted } from "../domain/progress.js";
import { REVIEW_INTERVAL, shouldReview } from "../domain/review.js";
import type { StorePort } from "../ports/store.js";
import type { RunMeta } from "./artifacts.js";
import { foundationMissing } from "./foundation.js";
import { readJson } from "./io.js";
import { globalReviewPath, PATHS } from "./paths.js";

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
