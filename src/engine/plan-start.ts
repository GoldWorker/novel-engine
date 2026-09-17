import type { AgentId } from "../domain/agents.js";
import type { PlanningTier } from "../domain/planning-tier.js";
import type { Instruction } from "../flow/instruction.js";
import type { StorePort } from "../ports/store.js";
import type { RunMeta } from "../store/artifacts.js";
import { appendDecision } from "../store/audit.js";
import { foundationMissing } from "../store/foundation.js";
import { readJson, writeJson } from "../store/io.js";
import { PATHS } from "../store/paths.js";

/**
 * Deterministic plan_start stub (no Arbiter LLM).
 *
 * Prompt keywords pick the planner: 长篇 → long/architect_long, 中篇|分层 →
 * mid/architect_long, otherwise short/architect_short. Persists the decision +
 * planningTier so Route can resume the same planner after a crash.
 */
export function inferPlanningStub(prompt: string): {
  tier: PlanningTier;
  planner: AgentId;
  label: string;
} {
  if (/长篇/u.test(prompt)) {
    return { tier: "long", planner: "architect_long", label: "长篇" };
  }
  if (/中篇|分层/u.test(prompt)) {
    return { tier: "mid", planner: "architect_long", label: "中篇" };
  }
  return { tier: "short", planner: "architect_short", label: "短篇" };
}

export async function planStartFallback(store: StorePort): Promise<Instruction | null> {
  const progress = await store.loadProgress();
  if (progress == null) {
    return null;
  }
  if (progress.phase === "writing" || progress.phase === "complete") {
    return null;
  }

  const meta = (await readJson<RunMeta>(store, PATHS.runMeta)) ?? {};
  if (meta.planningTier) {
    return null;
  }

  const missing = await foundationMissing(store);
  if (missing.length === 0) {
    return null;
  }

  const prompt = meta.startPrompt ?? "";
  const stub = inferPlanningStub(prompt);
  const planner = stub.planner;
  const layeredHint =
    stub.tier === "short"
      ? ""
      : "（分层大纲，save_foundation type=layered_outline / expand_next_arc / append_volume）";
  const task = prompt
    ? `根据需求规划一本${stub.label}${layeredHint}并落盘基础设定与作品信息：${prompt}`
    : `规划一本${stub.label}${layeredHint}并落盘基础设定与作品信息（save_book / save_foundation / audit_foundation）`;
  const reason = `确定性启动裁定：${stub.label}默认 ${planner}`;

  const rec = await appendDecision(store, {
    kind: "plan_start",
    decider: "stub",
    input: prompt,
    reason,
    decision: { planner, task, reason, planningTier: stub.tier },
  });

  const nextMeta: RunMeta = {
    ...meta,
    planningTier: stub.tier,
    planStart: {
      rawPrompt: prompt,
      planner,
      plannerTask: task,
      decisionId: rec.id,
    },
  };
  if (prompt !== "") {
    nextMeta.startPrompt = prompt;
  }
  await writeJson(store, PATHS.runMeta, nextMeta);

  return { agent: planner, task, reason };
}
