import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  PATHS,
  checkArcBoundary,
  completedArcBoundaries,
  estimatedChapterCapacity,
  flattenOutline,
  type VolumeOutline,
} from "../src/index.js";
import { architectTools, editorTools, writerTools } from "../src/workers/tools.js";
import { parseLayeredVolumes, saveLayeredViews } from "../src/store/layered.js";

const sampleVolumes = (): VolumeOutline[] =>
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
        {
          title: "远航",
          goal: "离岸",
          estimated_chapters: 2,
        },
      ],
    },
  ]);

describe("layered outline helpers", () => {
  it("flattens expanded arcs and estimates capacity from skeletons", () => {
    const volumes = sampleVolumes();
    expect(flattenOutline(volumes).map((entry) => entry.title)).toEqual(["交接", "风暴"]);
    expect(estimatedChapterCapacity(volumes)).toBe(4);
  });

  it("detects arc-end expansion vs volume-end complete", () => {
    const volumes = sampleVolumes();
    const mid = checkArcBoundary(volumes, 1);
    expect(mid?.isArcEnd).toBe(false);

    const arcEnd = checkArcBoundary(volumes, 2);
    expect(arcEnd).toMatchObject({
      isArcEnd: true,
      isVolumeEnd: false,
      volume: 1,
      arc: 1,
      startChapter: 1,
      endChapter: 2,
      nextVolume: 1,
      nextArc: 2,
      needsExpansion: true,
      needsNewVolume: false,
    });

    const first = volumes[0];
    const skeleton = first?.arcs[1];
    if (first && skeleton) {
      first.arcs[1] = {
        ...skeleton,
        chapters: [
          { chapter: 1, title: "离岸" },
          { chapter: 2, title: "回灯" },
        ],
        estimatedChapters: 0,
      };
    }
    const volumeEnd = checkArcBoundary(volumes, 4);
    expect(volumeEnd).toMatchObject({
      isArcEnd: true,
      isVolumeEnd: true,
      needsExpansion: false,
      needsNewVolume: true,
    });
    expect(completedArcBoundaries(volumes, 4)).toHaveLength(2);
  });
});

describe("assembleState layered facts", () => {
  it("fills arcBoundary and aggregateRefresh from MemoryStore paths", async () => {
    const store = new MemoryStore();
    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: 4,
      completedChapters: [1, 2],
      pendingRewrites: [],
      layered: true,
    });
    await saveLayeredViews(store, sampleVolumes());

    const missingReview = await store.loadState();
    expect(missingReview.arcBoundary?.isArcEnd).toBe(true);
    expect(missingReview.hasArcReview).toBe(false);
    expect(missingReview.aggregateRefresh?.kind).toBe("arc_review");
    expect(missingReview.aggregateRefresh?.endChapter).toBe(2);

    await store.write("reviews/arc_2.json", JSON.stringify({ chapter: 2, scope: "arc" }));
    const missingSummary = await store.loadState();
    expect(missingSummary.hasArcReview).toBe(true);
    expect(missingSummary.hasArcSummary).toBe(false);
    expect(missingSummary.aggregateRefresh?.kind).toBe("arc_summary");

    await store.write(
      "summaries/arc-v01a01.json",
      JSON.stringify({ volume: 1, arc: 1, title: "初夜", summary: "接灯" }),
    );
    const readyToExpand = await store.loadState();
    expect(readyToExpand.hasArcSummary).toBe(true);
    expect(readyToExpand.aggregateRefresh).toBeUndefined();
    expect(readyToExpand.arcBoundary?.needsExpansion).toBe(true);
  });
});

describe("editor and architect tools", () => {
  async function writingStore(): Promise<MemoryStore> {
    const store = new MemoryStore();
    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: 4,
      completedChapters: [1, 2],
      pendingRewrites: [],
      layered: true,
    });
    await saveLayeredViews(store, sampleVolumes());
    return store;
  }

  function tool(store: MemoryStore, name: string) {
    const all = [...architectTools(store), ...editorTools(store), ...writerTools(store)];
    const found = all.find((item) => item.name === name);
    if (!found) {
      throw new Error(`missing tool ${name}`);
    }
    return found;
  }

  it("save_review writes the arc path LoadState expects", async () => {
    const store = await writingStore();
    const result = await tool(store, "save_review").execute({
      chapter: 2,
      scope: "arc",
      summary: "弧末可接受",
      issues: [],
    });
    expect(result.saved).toBe(true);
    expect(await store.has("reviews/arc_2.json")).toBe(true);
    const state = await store.loadState();
    expect(state.hasArcReview).toBe(true);
  });

  it("save_arc_summary and save_volume_summary write Route paths", async () => {
    const store = await writingStore();
    await tool(store, "save_arc_summary").execute({
      volume: 1,
      arc: 1,
      title: "初夜",
      summary: "接灯与风暴",
      key_events: ["交接", "风暴"],
    });
    expect(await store.has("summaries/arc-v01a01.json")).toBe(true);

    const expanded = sampleVolumes();
    const second = expanded[0]?.arcs[1];
    if (expanded[0] && second) {
      expanded[0].arcs[1] = {
        ...second,
        chapters: [
          { chapter: 1, title: "离岸" },
          { chapter: 2, title: "回灯" },
        ],
      };
    }
    await saveLayeredViews(store, expanded);
    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: 4,
      completedChapters: [1, 2, 3, 4],
      pendingRewrites: [],
      layered: true,
    });
    await tool(store, "save_volume_summary").execute({
      volume: 1,
      title: "守夜",
      summary: "接灯与归来",
      key_events: ["回灯"],
    });
    expect(await store.has("summaries/vol-v01.json")).toBe(true);
    const state = await store.loadState();
    expect(state.hasVolumeSummary).toBe(true);
  });

  it("expand_next_arc fills the skeleton and updates outline.json", async () => {
    const store = await writingStore();
    const result = await tool(store, "expand_next_arc").execute({
      title: "远航",
      goal: "离岸归来",
      chapters: [
        { title: "离岸", core_event: "寻人" },
        { title: "回灯", core_event: "点灯" },
      ],
    });
    expect(result).toMatchObject({ saved: true, volume: 1, arc: 2, chapters: 2 });
    const outline = await store.read(PATHS.outline);
    expect(outline).not.toBeNull();
    const state = await store.loadState();
    expect(state.arcBoundary?.needsExpansion).toBe(false);
    expect(state.progress?.totalChapters).toBe(4);
  });

  it("save_foundation append_volume requires reason and first-arc chapters", async () => {
    const store = await writingStore();
    await expect(
      tool(store, "save_foundation").execute({
        type: "append_volume",
        content: { title: "空卷", theme: "无", arcs: [{ title: "骨架", goal: "待写" }] },
        reason: "续写",
      }),
    ).rejects.toThrow(/首弧必须包含详细章节/);

    const saved = await tool(store, "save_foundation").execute({
      type: "append_volume",
      reason: "还要再写一卷收束",
      content: {
        title: "归航",
        theme: "收线",
        final: true,
        arcs: [
          {
            title: "收官",
            goal: "点灯",
            chapters: [{ title: "终章", core_event: "灯亮" }],
          },
        ],
      },
    });
    expect(saved).toMatchObject({ saved: true, volume: 2, final_volume: true });
  });
});
