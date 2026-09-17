import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  createEngine,
  MemoryStore,
  MockLlm,
  PATHS,
  readJsonl,
  readText,
  type Checkpoint,
  type DecisionRecord,
} from "../src/index.js";
import { shortBookLlmHandler, type ShortBookFixture } from "./helpers/short-book-llm.js";

const book = shortBook as ShortBookFixture;

describe("Engine short-book integration", () => {
  it("runs prompt → MockLlm → Phase.complete for a 3-chapter book", async () => {
    const store = new MemoryStore();
    const llm = MockLlm.fromHandler(shortBookLlmHandler(book));
    const engine = createEngine({ store, llm, maxSteps: 20 });

    const result = await engine.run({ prompt: book.prompt });

    expect(result.stoppedReason).toBe("complete");
    expect(result.phase).toBe("complete");
    expect(result.steps).toBeGreaterThanOrEqual(5);

    const progress = await store.loadProgress();
    expect(progress?.phase).toBe("complete");
    expect(progress?.totalChapters).toBe(3);
    expect(progress?.completedChapters).toEqual([1, 2, 3]);
    expect(progress?.layered).toBe(false);

    expect(await readText(store, "chapters/01.md")).toContain("蜡封的瓶子");
    expect(await readText(store, "chapters/02.md")).toContain("潮汐时刻表");
    expect(await readText(store, "chapters/03.md")).toContain("灯盏");

    const checkpoints = await readJsonl<Checkpoint>(store, PATHS.checkpoints);
    expect(checkpoints.some((row) => row.step === "book")).toBe(true);
    expect(checkpoints.some((row) => row.step === "commit_chapter")).toBe(true);
    expect(checkpoints.some((row) => row.step === "complete_book")).toBe(true);

    const decisions = await readJsonl<DecisionRecord>(store, PATHS.decisions);
    expect(decisions.some((row) => row.kind === "plan_start" && row.decider === "stub")).toBe(
      true,
    );

    const state = await store.loadState();
    expect(state.planningTier).toBe("short");
    expect(state.foundationMissing).toEqual([]);
  });

  it("pauses on deadlock when the worker never advances facts", async () => {
    const store = new MemoryStore();
    const llm = MockLlm.fromHandler(() => ({ text: "noop" }));
    const engine = createEngine({ store, llm, maxSteps: 20 });
    const result = await engine.run({ prompt: book.prompt });
    expect(result.stoppedReason).toBe("paused");
    expect(result.error).toMatch(/deadlock/);
    expect((await store.loadProgress())?.phase).toBe("init");
  });
});
