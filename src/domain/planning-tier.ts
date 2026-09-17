import type { AgentId } from "./agents.js";

export const PLANNING_TIERS = ["short", "mid", "long"] as const;

export type PlanningTier = (typeof PLANNING_TIERS)[number];

/**
 * Planner identity from a persisted planning scale.
 * Matches ainovel-cli `plannerForTier`: short → architect_short, mid/long → architect_long.
 * Empty tier is treated as unknown (Route must not guess during foundation fill).
 */
export function plannerForTier(tier: PlanningTier | "" | undefined): AgentId {
  if (tier === "short") {
    return "architect_short";
  }
  return "architect_long";
}
