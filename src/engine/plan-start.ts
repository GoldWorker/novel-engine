import type { AgentId } from "../domain/agents.js";
import type { Instruction } from "../flow/instruction.js";
import type { StorePort } from "../ports/store.js";
import type { RunMeta } from "../store/artifacts.js";
import { appendDecision } from "../store/audit.js";
import { foundationMissing } from "../store/foundation.js";
import { readJson, writeJson } from "../store/io.js";
import { PATHS } from "../store/paths.js";

/**
 * Deterministic plan_start stub (no Arbiter LLM).
 * Short books always pick `architect_short`. Persists the decision + planningTier
 * so Route can resume the same planner after a crash.
 */
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
  const planner: AgentId = "architect_short";
  const task = prompt
    ? `根据需求规划一本短篇并落盘基础设定与作品信息：${prompt}`
    : "规划一本短篇并落盘基础设定与作品信息（save_book / save_foundation / audit_foundation）";
  const reason = "确定性启动裁定：短篇默认 architect_short";

  const rec = await appendDecision(store, {
    kind: "plan_start",
    decider: "stub",
    input: prompt,
    reason,
    decision: { planner, task, reason },
  });

  const nextMeta: RunMeta = {
    ...meta,
    planningTier: "short",
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
