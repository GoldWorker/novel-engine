import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  MemoryStore,
  PATHS,
  writeJson,
  writeText,
  type Progress,
} from "../src/index.js";
import { ChapterRunnerError, createNovelSession } from "../src/session/index.js";
import type { ShortBookFixture } from "./helpers/short-book-llm.js";

const short = shortBook as unknown as ShortBookFixture;

const writing = (completed: number[]): Progress => {
  const progress: Progress = {
    phase: "writing",
    flow: "writing",
    totalChapters: 3,
    completedChapters: completed,
    pendingRewrites: [],
    layered: false,
  };
  const last = completed[completed.length - 1];
  if (last !== undefined) {
    progress.currentChapter = last;
  }
  return progress;
};

describe("NovelSession chapter.delete", () => {
  it("removes plan/draft/final/summary and drops completedChapters", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "del" });
    await writeJson(store, "drafts/01.plan.json", {
      chapter: 1,
      title: "风暴之后",
      goal: "goal",
      conflict: "c",
      hook: "h",
    });
    await writeText(store, "drafts/01.draft.md", "草稿");
    await writeText(store, "chapters/01.md", "# 终稿");
    await writeJson(store, "summaries/01.json", {
      chapter: 1,
      title: "风暴之后",
      summary: "捡到信",
    });
    await store.saveProgress(writing([1]));

    const result = await session.chapter.delete(1);
    expect(result.chapter).toBe(1);
    expect(result.removed.sort()).toEqual([
      "chapters/01.md",
      "drafts/01.draft.md",
      "drafts/01.plan.json",
      "summaries/01.json",
    ]);
    expect(result.outlineSynced).toBe(false);
    expect(await session.chapter.get(1)).toBeNull();
    expect(result.progress?.completedChapters).toEqual([]);
    expect(result.progress?.totalChapters).toBe(3);
    expect(result.progress?.currentChapter).toBe(0);
    expect(result.progress?.phase).toBe("writing");
  });

  it("syncOutline rewrites flat outline via upsert (no assess gate)", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "toc" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await writeText(store, "chapters/02.md", "第二章");
    await store.saveProgress(writing([2]));

    const result = await session.chapter.delete(2, { syncOutline: true });
    expect(result.outlineSynced).toBe(true);
    expect(result.removed).toContain("chapters/02.md");
    const meta = await session.getFoundation();
    expect(meta.outline?.map((row) => row.chapter)).toEqual([1, 3]);
    expect(await store.has(PATHS.foundationAudit)).toBe(false);
  });

  it("does not invent an empty outline when deleting the last TOC row", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "last-row" });
    await session.upsertFoundation({
      outline: [{ chapter: 1, title: "唯一", summary: "一章" }],
    });
    const before = await session.getFoundation();
    const result = await session.chapter.delete(1, { syncOutline: true });
    expect(result.outlineSynced).toBe(false);
    expect((await session.getFoundation()).outline).toEqual(before.outline);
  });

  it("syncOutline drops a chapter row from layeredOutline without renumbering", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "layered-toc" });
    await session.upsertFoundation({
      layeredOutline: [
        {
          index: 1,
          title: "守夜",
          theme: "灯",
          arcs: [
            {
              index: 1,
              title: "初夜",
              goal: "接灯",
              chapters: [
                { chapter: 1, title: "交接", summary: "钥匙" },
                { chapter: 2, title: "风暴", summary: "整夜" },
              ],
            },
          ],
        },
      ],
    });
    const result = await session.chapter.delete(1, { syncOutline: true });
    expect(result.outlineSynced).toBe(true);
    const layered = (await session.getFoundation()).layeredOutline;
    expect(layered?.[0]?.arcs[0]?.chapters.map((row) => row.chapter)).toEqual([2]);
  });

  it("rejects a non-positive chapter number", async () => {
    const session = await createNovelSession({ store: new MemoryStore(), bookId: "bad" });
    await expect(session.chapter.delete(0)).rejects.toBeInstanceOf(ChapterRunnerError);
  });
});
