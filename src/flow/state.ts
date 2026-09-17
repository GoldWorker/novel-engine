import type { ArcBoundary } from "../domain/arc-boundary.js";
import type { PlanningTier } from "../domain/planning-tier.js";
import type { Progress } from "../domain/progress.js";
import type { AggregateRefresh } from "./instruction.js";

/**
 * Pure input to `route`. Every fact must be declared here — Route never reads a store.
 * Hosts assemble this snapshot via a `StorePort` adapter (IO lives in the adapter).
 */
export interface State {
  progress?: Progress | null;
  /** Max completed chapter; 0 means writing has not started. */
  lastCompleted?: number;
  /**
   * Arc boundary of the last completed chapter.
   * Ignored unless `progress.layered` and `isArcEnd`.
   */
  arcBoundary?: ArcBoundary | null;
  hasArcReview?: boolean;
  hasArcSummary?: boolean;
  hasVolumeSummary?: boolean;
  /** Missing foundation artifacts during planning (stable order). */
  foundationMissing?: readonly string[];
  /**
   * Persisted planning scale. Empty means first planning has not written scale yet,
   * so planner identity cannot be derived (Engine bootstrap fallback, not Route).
   */
  planningTier?: PlanningTier | "";
  /** Non-layered: whether the last completed chapter already has scope=global review. */
  hasGlobalReview?: boolean;
  /**
   * External revisions that must be absorbed by Architect before continuing.
   * Ordinary writer feedback is not counted here.
   */
  immediateFeedbackCount?: number;
  /** Earliest aggregate artifact that must be rebuilt after an external revision. */
  aggregateRefresh?: AggregateRefresh | null;
}
