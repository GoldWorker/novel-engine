import { inferPlanningStub } from "../engine/plan-start.js";
import { isPlanningTier, plannerForTier, type PlanningTier } from "../domain/planning-tier.js";
import type { StorePort } from "../ports/store.js";
import type { RunMeta } from "../store/artifacts.js";
import { hasValidLayeredOutline } from "../store/foundation.js";
import { readJson } from "../store/io.js";
import { PATHS } from "../store/paths.js";
import type { PlanningInfo, PlanningSource } from "./types.js";

const LABELS: Record<PlanningTier, string> = {
  short: "短篇",
  mid: "中篇",
  long: "长篇",
};

function fromTier(tier: PlanningTier, source: PlanningSource): PlanningInfo {
  return {
    tier,
    planner: plannerForTier(tier),
    label: LABELS[tier],
    source,
  };
}

/**
 * Resolve planning scale for Session inspect: prompt stub, then run_meta,
 * progress, layered outline, else short (same order as `resolveFoundationTier`).
 */
export async function resolveSessionPlanning(
  store: StorePort,
  prompt?: string,
): Promise<PlanningInfo> {
  if (prompt !== undefined && prompt.trim() !== "") {
    const stub = inferPlanningStub(prompt);
    return { tier: stub.tier, planner: stub.planner, label: stub.label, source: "prompt" };
  }

  const meta = await readJson<RunMeta>(store, PATHS.runMeta);
  if (isPlanningTier(meta?.planningTier)) {
    return fromTier(meta.planningTier, "run_meta");
  }
  if (typeof meta?.startPrompt === "string" && meta.startPrompt.trim() !== "") {
    const stub = inferPlanningStub(meta.startPrompt);
    return { tier: stub.tier, planner: stub.planner, label: stub.label, source: "run_meta" };
  }

  const progress = await store.loadProgress();
  if (progress != null && isPlanningTier(progress.planningTier)) {
    return fromTier(progress.planningTier, "progress");
  }
  if (progress?.layered === true) {
    return fromTier("mid", "progress");
  }
  if (await hasValidLayeredOutline(store)) {
    return fromTier("mid", "layered_outline");
  }
  return fromTier("short", "default");
}
