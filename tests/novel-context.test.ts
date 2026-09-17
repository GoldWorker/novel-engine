import { describe, expect, it } from "vitest";
import { MemoryStore, assembleNovelContext, SLIDING_SUMMARY_WINDOW } from "../src/index.js";
import { saveLayeredViews, parseLayeredVolumes } from "../src/store/layered.js";
import { writerTools } from "../src/workers/tools.js";

describe("novel_context sliding summaries", () => {
  it("returns recent chapter summaries plus arc/volume summaries when present", async () => {
    const store = new MemoryStore();
    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: 4,
      completedChapters: [1, 2],
      pendingRewrites: [],
      layered: true,
    });
    await store.write(PATHS_BOOK, JSON.stringify({ title: "两弧灯塔", synopsis: "接灯" }));
    await store.write("premise.md", "premise");
    await store.write("characters.json", JSON.stringify([{ name: "林守" }]));
    await store.write("world_rules.json", JSON.stringify([{ name: "潮", description: "信" }]));
    await saveLayeredViews(
      store,
      parseLayeredVolumes([
        {
          title: "守夜",
          theme: "灯塔",
          arcs: [
            {
              title: "初夜",
              goal: "接灯",
              chapters: [
                { title: "交接", core_event: "点灯" },
                { title: "风暴", core_event: "守夜" },
              ],
            },
          ],
        },
      ]),
    );
    await store.write(
      "summaries/01.json",
      JSON.stringify({ chapter: 1, title: "交接", summary: "点灯" }),
    );
    await store.write(
      "summaries/02.json",
      JSON.stringify({ chapter: 2, title: "风暴", summary: "守夜" }),
    );
    await store.write(
      "summaries/arc-v01a01.json",
      JSON.stringify({ volume: 1, arc: 1, title: "初夜", summary: "接灯完毕" }),
    );
    await store.write(
      "summaries/vol-v01.json",
      JSON.stringify({ volume: 1, title: "守夜", summary: "一卷" }),
    );

    const context = await assembleNovelContext(store, { chapter: 2 });
    expect(SLIDING_SUMMARY_WINDOW).toBe(8);
    expect(context.chapter_summaries).toEqual([
      { chapter: 1, title: "交接", summary: "点灯" },
    ]);
    expect(context.arc_summaries).toEqual([
      { volume: 1, arc: 1, title: "初夜", summary: "接灯完毕" },
    ]);
    expect(context.volume_summaries).toEqual([{ volume: 1, title: "守夜", summary: "一卷" }]);
    expect(context.layered_outline).toEqual([
      expect.objectContaining({
        title: "守夜",
        arcs: [expect.objectContaining({ title: "初夜", expanded: true, chapter_count: 2 })],
      }),
    ]);
    expect(context.chapter).toMatchObject({ number: 2 });
  });

  it("commit_chapter writes a lightweight chapter summary for later context", async () => {
    const store = new MemoryStore();
    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: 1,
      completedChapters: [],
      pendingRewrites: [],
      layered: false,
    });
    const tools = writerTools(store);
    const plan = tools.find((tool) => tool.name === "plan_chapter");
    const draft = tools.find((tool) => tool.name === "draft_chapter");
    const commit = tools.find((tool) => tool.name === "commit_chapter");
    if (!plan || !draft || !commit) {
      throw new Error("writer tools missing");
    }
    await plan.execute({
      chapter: 1,
      title: "交接",
      goal: "点灯",
      conflict: "害怕",
      hook: "信",
    });
    await draft.execute({ chapter: 1, content: "林守点燃灯盏。", mode: "write" });
    await commit.execute({ chapter: 1 });
    const context = await assembleNovelContext(store, { chapter: 2 });
    expect(context.chapter_summaries).toEqual([
      expect.objectContaining({ chapter: 1, title: "交接", summary: "点灯" }),
    ]);
  });
});

const PATHS_BOOK = "meta/book.json";
