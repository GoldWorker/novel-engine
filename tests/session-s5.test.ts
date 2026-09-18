import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import { MemoryStore, MockLlm, type Progress } from "../src/index.js";
import {
  createNovelSession,
  type FoundationPatch,
  type SessionEvent,
} from "../src/session/index.js";
import type { ShortBookFixture } from "./helpers/short-book-llm.js";

const short = shortBook as unknown as ShortBookFixture;

const writing = (completed: number[] = [1]): Progress => ({
  phase: "writing",
  flow: "writing",
  totalChapters: 3,
  completedChapters: completed,
  pendingRewrites: [],
  layered: false,
});

async function seedWrittenBook(chapters: number[] = [1]) {
  const store = new MemoryStore();
  const session = await createNovelSession({ store, bookId: "letter" });
  await session.upsertFoundation({
    book: short.book,
    premise: short.premise,
    outline: short.outline,
    characters: short.characters,
    worldRules: short.world_rules,
  });
  await store.saveProgress(writing(chapters));
  for (const n of chapters) {
    const row = short.chapters[String(n)];
    if (!row) {
      throw new Error(`missing fixture chapter ${n}`);
    }
    await session.chapter.saveFinal(n, row.content);
  }
  return { store, session };
}

async function snapshotStore(session: Awaited<ReturnType<typeof createNovelSession>>) {
  return {
    artifacts: await session.listArtifacts(),
    foundation: await session.getFoundation(),
    chapter1: await session.chapter.get(1),
  };
}

describe("NovelSession S5 assessFoundationImpact", () => {
  it("meta_only: title/synopsis-style book.json does not suggest chapter rewrites", async () => {
    const { store, session } = await seedWrittenBook([1, 2]);
    const before = await snapshotStore(session);

    const assessment = await session.assessFoundationImpact({
      book: { title: "无主的信（修订）", synopsis: "灯塔与潮的简介改写，不改情节。" },
    });

    expect(assessment.severity).toBe("meta_only");
    expect(assessment.suggestedMode).toBe("none");
    expect(assessment.suggestedChapters).toEqual([]);
    expect(assessment.suggestedRanges).toEqual([]);
    expect(assessment.changedKeys).toEqual(["book"]);
    expect(assessment.source).toBe("heuristics");
    expect(assessment.reasons.length).toBeGreaterThan(0);
    expect(assessment.reasons.join(" ")).toMatch(/meta/i);

    const after = await snapshotStore(session);
    expect(after).toEqual(before);
    expect(await store.has("chapters/01.md")).toBe(true);
  });

  it("forward_only: future outline / new characters with written chapters", async () => {
    const { session } = await seedWrittenBook([1]);
    const before = await snapshotStore(session);

    const futureOutline: FoundationPatch = {
      outline: [
        ...short.outline,
        { chapter: 4, title: "灯塔之外", summary: "尚未写下的后续。" },
      ],
      characters: [...short.characters, { name: "潮", role: "未出场", bio: "只在后续出现。" }],
    };
    const assessment = await session.assessFoundationImpact(futureOutline);

    expect(assessment.severity).toBe("forward_only");
    expect(assessment.suggestedMode).toBe("none");
    expect(assessment.suggestedChapters).toEqual([]);
    expect(assessment.changedKeys).toEqual(expect.arrayContaining(["outline", "characters"]));
    expect(assessment.reasons.join("\n")).toMatch(/后续|forward/i);

    expect(await snapshotStore(session)).toEqual(before);
  });

  it("rewrite_needed: character/world/past plot contradicts written chapters", async () => {
    const { session } = await seedWrittenBook([1, 2]);
    const before = await snapshotStore(session);

    const assessment = await session.assessFoundationImpact({
      characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
      worldRules: [{ name: "信与潮", description: "信会自己烧掉，与已写情节矛盾。" }],
      premise: "林深从未离开灯塔，故事不再下山。",
    });

    expect(assessment.severity).toBe("rewrite_needed");
    expect(assessment.suggestedMode).toBe("rewrite");
    expect(assessment.suggestedChapters).toEqual([1, 2]);
    expect(assessment.suggestedRanges).toEqual([{ start: 1, end: 2 }]);
    expect(assessment.changedKeys).toEqual(
      expect.arrayContaining(["premise", "characters", "world_rules"]),
    );
    expect(assessment.reasons.join("\n")).toMatch(/角色|世界|前提/);

    expect(await snapshotStore(session)).toEqual(before);
    expect(before.chapter1?.final).toContain("林守");
  });

  it("outline title-only change on a written chapter suggests polish", async () => {
    const { session } = await seedWrittenBook([1]);
    const assessment = await session.assessFoundationImpact({
      outline: short.outline.map((entry) =>
        entry.chapter === 1 ? { ...entry, title: "风暴停了" } : entry,
      ),
    });
    expect(assessment.severity).toBe("rewrite_needed");
    expect(assessment.suggestedMode).toBe("polish");
    expect(assessment.suggestedChapters).toEqual([1]);
  });

  it("optional LLM refinement cannot downgrade heuristic severity", async () => {
    const store = new MemoryStore();
    const llm = new MockLlm([
      {
        text: JSON.stringify({
          severity: "meta_only",
          suggestedChapters: [],
          suggestedMode: "none",
          reasons: ["model tried to downgrade"],
        }),
      },
    ]);
    const session = await createNovelSession({ store, llm, bookId: "refine" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await session.chapter.saveFinal(1, short.chapters["1"]!.content);

    const assessment = await session.assessFoundationImpact(
      { premise: "完全不同的前提，已写章节必须重写。" },
      { refineWithLlm: true },
    );

    expect(llm.callCount).toBe(1);
    expect(assessment.severity).toBe("rewrite_needed");
    expect(assessment.source).toBe("llm");
    expect(assessment.suggestedChapters).toEqual([1]);
    expect(assessment.reasons.join("\n")).toMatch(/downgrade|前提/);
  });

  it("LLM refinement can upgrade forward_only and add notes", async () => {
    const store = new MemoryStore();
    const llm = new MockLlm([
      {
        text: JSON.stringify({
          severity: "rewrite_needed",
          suggestedChapters: [1],
          suggestedMode: "polish",
          reasons: ["model spotted a contradiction"],
          notes: ["check chapter 1 hook"],
        }),
      },
    ]);
    const session = await createNovelSession({ store, llm, bookId: "upgrade" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await session.chapter.saveFinal(1, short.chapters["1"]!.content);

    const assessment = await session.assessFoundationImpact(
      {
        outline: [
          ...short.outline,
          { chapter: 4, title: "灯塔之外", summary: "后续。" },
        ],
      },
      { refineWithLlm: true },
    );

    expect(assessment.severity).toBe("rewrite_needed");
    expect(assessment.suggestedMode).toBe("polish");
    expect(assessment.suggestedChapters).toEqual([1]);
    expect(assessment.source).toBe("llm");
    expect(assessment.notes.join("\n")).toMatch(/check chapter 1 hook/);
  });

  it("does not require llm and does not emit write events", async () => {
    const { session } = await seedWrittenBook([1]);
    const events: SessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });
    await session.assessFoundationImpact({
      book: { title: "只改标题", synopsis: short.book.synopsis },
    });
    expect(events).toEqual([]);
  });
});
