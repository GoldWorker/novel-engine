import { describe, expect, it } from "vitest";
import { inferPlanningStub } from "../src/index.js";
import { MemoryStore } from "../src/index.js";
import { planStartFallback } from "../src/engine/plan-start.js";

describe("plan_start stub", () => {
  it("maps 短篇 / 中篇 / 长篇 keywords", () => {
    expect(inferPlanningStub("写一本三章短篇")).toMatchObject({
      tier: "short",
      planner: "architect_short",
    });
    expect(inferPlanningStub("写一本分层中篇")).toMatchObject({
      tier: "mid",
      planner: "architect_long",
    });
    expect(inferPlanningStub("写一本长篇")).toMatchObject({
      tier: "long",
      planner: "architect_long",
    });
  });

  it("persists mid-tier architect_long for a layered prompt", async () => {
    const store = new MemoryStore();
    await store.saveProgress({
      phase: "init",
      flow: "writing",
      totalChapters: 0,
      completedChapters: [],
      pendingRewrites: [],
      layered: false,
    });
    await store.write("meta/run_meta.json", JSON.stringify({ startPrompt: "写一本分层中篇" }));
    const instruction = await planStartFallback(store);
    expect(instruction?.agent).toBe("architect_long");
    const state = await store.loadState();
    expect(state.planningTier).toBe("mid");
  });
});
