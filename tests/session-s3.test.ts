import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  MemoryStore,
  MockLlm,
  writeJson,
  writeText,
  type LlmCompletionResult,
  type Progress,
} from "../src/index.js";
import {
  ChapterConflictError,
  SessionBusyError,
  SessionLlmRequiredError,
  createNovelSession,
  type SessionEvent,
} from "../src/session/index.js";
import type { ShortBookFixture } from "./helpers/short-book-llm.js";

const short = shortBook as unknown as ShortBookFixture;

const writing = (): Progress => ({
  phase: "writing",
  flow: "writing",
  totalChapters: 3,
  completedChapters: [],
  pendingRewrites: [],
  layered: false,
});

function writerTurns(chapter: number, content: string, title = "风暴之后"): LlmCompletionResult[] {
  return [
    {
      text: "write",
      toolCalls: [
        {
          id: `plan-${chapter}-${content.length}`,
          name: "plan_chapter",
          arguments: {
            chapter,
            title,
            goal: "goal",
            conflict: "conflict",
            hook: "hook",
          },
        },
        {
          id: `draft-${chapter}-${content.length}`,
          name: "draft_chapter",
          arguments: { chapter, content, mode: "write" },
        },
        {
          id: `commit-${chapter}-${content.length}`,
          name: "commit_chapter",
          arguments: { chapter },
        },
      ],
    },
    { text: "done" },
  ];
}

describe("NovelSession S3 chapter.get / saveFinal", () => {
  it("get returns plan/draft/final/summary after manual writes", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "letter" });

    expect(await session.chapter.get(1)).toBeNull();

    await writeJson(store, "drafts/01.plan.json", {
      chapter: 1,
      title: "风暴之后",
      goal: "捡到信",
      conflict: "潮水",
      hook: "灯塔",
    });
    await writeText(store, "drafts/01.draft.md", "草稿：林守捡到信。");
    await writeText(store, "chapters/01.md", "终稿：林守捡到信。");
    await writeJson(store, "summaries/01.json", {
      chapter: 1,
      title: "风暴之后",
      summary: "捡到一封没有寄信人的信。",
    });

    const view = await session.chapter.get(1);
    expect(view).toEqual({
      chapter: 1,
      plan: {
        chapter: 1,
        title: "风暴之后",
        goal: "捡到信",
        conflict: "潮水",
        hook: "灯塔",
      },
      draft: "草稿：林守捡到信。",
      final: "终稿：林守捡到信。",
      summary: {
        chapter: 1,
        title: "风暴之后",
        summary: "捡到一封没有寄信人的信。",
      },
    });
    expect(await session.chapter.get(2)).toBeNull();
  });

  it("saveFinal writes chapters/NN.md and updates progress", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "save" });
    await store.saveProgress(writing());

    await session.chapter.saveFinal(2, "第二章终稿：灯塔亮了。");

    expect(await store.has("chapters/02.md")).toBe(true);
    const view = await session.chapter.get(2);
    expect(view?.final).toBe("第二章终稿：灯塔亮了。");
    expect(view?.summary).toEqual(
      expect.objectContaining({ chapter: 2, title: "第 2 章" }),
    );
    const progress = await session.getProgress();
    expect(progress?.completedChapters).toEqual([2]);
    expect(progress?.phase).toBe("writing");
    expect(progress?.currentChapter).toBe(2);
    expect(progress?.totalChapters).toBe(3);
  });
});

describe("NovelSession S3 chapter.write", () => {
  it("throws when llm is missing", async () => {
    const session = await createNovelSession({ store: new MemoryStore(), bookId: "no-llm" });
    await expect(session.chapter.write({ chapter: 1, mode: "create" })).rejects.toBeInstanceOf(
      SessionLlmRequiredError,
    );
  });

  it("create on empty store writes chapters/NN.md", async () => {
    const store = new MemoryStore();
    const llm = new MockLlm(writerTurns(1, "第一章：林守在风暴后捡到信。"));
    const session = await createNovelSession({ store, llm, bookId: "create" });
    const events: SessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    const result = await session.chapter.write({
      chapter: 1,
      mode: "create",
      title: "风暴之后",
    });

    expect(result.chapter).toBe(1);
    expect(result.mode).toBe("create");
    expect(result.turns).toBeGreaterThan(0);
    expect(await store.has("chapters/01.md")).toBe(true);
    expect(result.view.final).toContain("林守在风暴后捡到信");
    expect(llm.calls.every((call) => call.agent === "writer")).toBe(true);
    const steps = events.filter(
      (event): event is Extract<SessionEvent, { type: "chapter_step" }> => event.type === "chapter_step",
    );
    expect(steps.map((event) => event.tool)).toEqual(["plan_chapter", "draft_chapter", "commit_chapter"]);
  });

  it("create fails when a final already exists unless force", async () => {
    const store = new MemoryStore();
    const llm = new MockLlm(writerTurns(1, "原文"));
    const session = await createNovelSession({ store, llm, bookId: "conflict" });
    await writeText(store, "chapters/01.md", "已有终稿");

    await expect(session.chapter.write({ chapter: 1, mode: "create" })).rejects.toBeInstanceOf(
      ChapterConflictError,
    );
    expect(await session.chapter.get(1)).toMatchObject({ final: "已有终稿" });
    expect(llm.callCount).toBe(0);
  });

  it("rewrite changes an existing final without pendingRewrites", async () => {
    const store = new MemoryStore();
    const llm = new MockLlm([
      ...writerTurns(1, "原文：林守捡到信。"),
      ...writerTurns(1, "重写：灯塔从潮水里看见那封信。"),
    ]);
    const session = await createNovelSession({ store, llm, bookId: "rewrite" });

    await session.chapter.write({ chapter: 1, mode: "create" });
    const before = await session.chapter.get(1);
    expect(before?.final).toContain("原文");

    const result = await session.chapter.write({
      chapter: 1,
      mode: "rewrite",
      instruction: "改成灯塔视角",
    });

    expect(result.view.final).toContain("重写");
    expect(result.view.final).not.toBe(before?.final);
    const progress = await session.getProgress();
    expect(progress?.completedChapters).toContain(1);
    expect(progress?.pendingRewrites).toEqual([]);
  });

  it("continue appends an existing draft then commits", async () => {
    const store = new MemoryStore();
    const llm = new MockLlm([
      {
        text: "continue",
        toolCalls: [
          {
            id: "draft-append",
            name: "draft_chapter",
            arguments: { chapter: 1, content: "续写：他拆开信封。", mode: "append" },
          },
          { id: "commit-1", name: "commit_chapter", arguments: { chapter: 1 } },
        ],
      },
      { text: "done" },
    ]);
    const session = await createNovelSession({ store, llm, bookId: "continue" });
    await writeText(store, "drafts/01.draft.md", "未完成草稿：林守站在堤上。");

    const result = await session.chapter.write({ chapter: 1, mode: "continue" });
    expect(result.view.final).toContain("未完成草稿");
    expect(result.view.final).toContain("续写");
  });

  it("startAutoWrite in flight blocks chapter.write", async () => {
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = new MockLlm([() => gate]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "busy",
    });

    const pending = session.startAutoWrite({
      prompt: short.prompt,
      generateMissing: true,
    });

    await expect(session.chapter.write({ chapter: 1, mode: "create" })).rejects.toBeInstanceOf(
      SessionBusyError,
    );

    release({
      text: JSON.stringify({
        book: short.book,
        premise: short.premise,
        outline: short.outline,
        characters: short.characters,
        world_rules: short.world_rules,
      }),
    });
    const outcome = await pending;
    expect(outcome.status).toBe("needs_foundation");
  });
});
