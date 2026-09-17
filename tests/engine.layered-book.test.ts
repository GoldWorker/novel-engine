import { describe, expect, it } from "vitest";
import layeredBook from "../fixtures/layered-book.json" with { type: "json" };
import {
  createEngine,
  MemoryStore,
  MockLlm,
  PATHS,
  readJson,
  readJsonl,
  readText,
  type ArcSummary,
  type Checkpoint,
  type DecisionRecord,
  type VolumeSummary,
} from "../src/index.js";
import { layeredBookLlmHandler, type LayeredBookFixture } from "./helpers/layered-book-llm.js";

const book = layeredBook as unknown as LayeredBookFixture;

describe("Engine layered-book integration", () => {
  it("runs a 1-volume / 2-arc mock book through arc-end Route to complete", async () => {
    const store = new MemoryStore();
    const llm = MockLlm.fromHandler(layeredBookLlmHandler(book));
    const engine = createEngine({ store, llm, maxSteps: 40 });

    const result = await engine.run({ prompt: book.prompt });

    expect(result.stoppedReason).toBe("complete");
    expect(result.phase).toBe("complete");

    const progress = await store.loadProgress();
    expect(progress?.phase).toBe("complete");
    expect(progress?.layered).toBe(true);
    expect(progress?.completedChapters).toEqual([1, 2, 3, 4]);

    expect(await readText(store, "chapters/01.md")).toContain("铜钥匙");
    expect(await readText(store, "chapters/02.md")).toContain("风暴停在黎明");
    expect(await readText(store, "chapters/03.md")).toContain("潮汐时刻表");
    expect(await readText(store, "chapters/04.md")).toContain("灯盏");

    const arc1 = await readJson<ArcSummary>(store, "summaries/arc-v01a01.json");
    const arc2 = await readJson<ArcSummary>(store, "summaries/arc-v01a02.json");
    const volume = await readJson<VolumeSummary>(store, "summaries/vol-v01.json");
    expect(arc1?.title).toBe("初夜");
    expect(arc2?.title).toBe("远航");
    expect(volume?.title).toBe("守夜");

    expect(await store.has("reviews/arc_2.json")).toBe(true);
    expect(await store.has("reviews/arc_4.json")).toBe(true);
    expect(await store.has("summaries/01.json")).toBe(true);

    const checkpoints = await readJsonl<Checkpoint>(store, PATHS.checkpoints);
    expect(checkpoints.some((row) => row.step === "layered_outline")).toBe(true);
    expect(checkpoints.some((row) => row.step === "expand_next_arc")).toBe(true);
    expect(checkpoints.some((row) => row.step === "save_review")).toBe(true);
    expect(checkpoints.some((row) => row.step === "arc_summary")).toBe(true);
    expect(checkpoints.some((row) => row.step === "volume_summary")).toBe(true);
    expect(checkpoints.some((row) => row.step === "complete_book")).toBe(true);

    const decisions = await readJsonl<DecisionRecord>(store, PATHS.decisions);
    expect(decisions.some((row) => row.kind === "plan_start" && row.decider === "stub")).toBe(
      true,
    );
    expect(decisions.some((row) => row.kind === "volume_end")).toBe(true);

    const state = await store.loadState();
    expect(state.planningTier).toBe("mid");
    expect(state.foundationMissing).toEqual([]);
    expect(state.progress?.layered).toBe(true);

    const agents = llm.calls.map((call) => call.agent);
    expect(agents).toContain("architect_long");
    expect(agents).toContain("editor");
    expect(agents).toContain("writer");
  });
});
