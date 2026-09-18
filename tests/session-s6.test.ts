import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  MemoryStore,
  MockLlm,
  type LlmCompletionResult,
  type Progress,
} from "../src/index.js";
import {
  SessionBusyError,
  SessionLlmRequiredError,
  attachSessionWorker,
  createNovelSession,
  createSessionClient,
  isSessionCommand,
  SESSION_NS,
  SESSION_PROTOCOL,
} from "../src/session/index.js";
import { createLinkedMessagePorts } from "./helpers/fake-ports.js";
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

async function seedWrittenBook(store: MemoryStore, chapters: number[] = [1]) {
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
  return session;
}

const rewritePatch = {
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
  premise: "林深从未离开灯塔。",
};

describe("NovelSession S6 applyFoundationChange", () => {
  it("confirm gate: rewrite_needed does not upsert or rewrite without confirmRewrite", async () => {
    const store = new MemoryStore();
    const session = await seedWrittenBook(store, [1]);
    const before = await session.getFoundation();
    const beforeFinal = (await session.chapter.get(1))?.final;

    const result = await session.applyFoundationChange({
      patch: rewritePatch,
    });

    expect(result.status).toBe("needs_confirm");
    if (result.status !== "needs_confirm") {
      return;
    }
    expect(result.assessment.severity).toBe("rewrite_needed");
    expect(result.assessment.suggestedChapters).toEqual([1]);
    expect(await session.getFoundation()).toEqual(before);
    expect((await session.chapter.get(1))?.final).toBe(beforeFinal);
    expect(await store.has("chapters/01.md")).toBe(true);
  });

  it("meta_only applies without confirm and does not rewrite chapters", async () => {
    const store = new MemoryStore();
    const session = await seedWrittenBook(store, [1]);
    const beforeFinal = (await session.chapter.get(1))?.final;

    const result = await session.applyFoundationChange({
      patch: { book: { title: "无主的信（修订）", synopsis: short.book.synopsis } },
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.assessment.severity).toBe("meta_only");
    expect(result.meta.book?.title).toBe("无主的信（修订）");
    expect(result.writes).toEqual([]);
    expect((await session.chapter.get(1))?.final).toBe(beforeFinal);
  });

  it("confirmRewrite upserts but still does not auto-rewrite chapters", async () => {
    const store = new MemoryStore();
    const session = await seedWrittenBook(store, [1]);
    const beforeFinal = (await session.chapter.get(1))?.final;

    const result = await session.applyFoundationChange({
      patch: rewritePatch,
      confirmRewrite: true,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.meta.premise).toBe(rewritePatch.premise);
    expect(result.meta.characters?.[0]?.name).toBe("林深");
    expect(result.writes).toEqual([]);
    expect((await session.chapter.get(1))?.final).toBe(beforeFinal);
    expect(beforeFinal).toContain("林守");
  });

  it("batch write: confirm + rewriteChapters sequentially chapter.write suggestedChapters", async () => {
    const store = new MemoryStore();
    const llm = new MockLlm([
      ...writerTurns(1, "重写第一章：林深守着灯塔。"),
      ...writerTurns(2, "重写第二章：林深没有下山。"),
    ]);
    const session = await createNovelSession({ store, llm, bookId: "batch" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await store.saveProgress(writing([1, 2]));
    await session.chapter.saveFinal(1, short.chapters["1"]!.content);
    await session.chapter.saveFinal(2, short.chapters["2"]!.content);

    const result = await session.applyFoundationChange({
      patch: rewritePatch,
      confirmRewrite: true,
      rewriteChapters: true,
      instruction: "改成林深视角",
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.assessment.suggestedChapters).toEqual([1, 2]);
    expect(result.writes.map((row) => row.chapter)).toEqual([1, 2]);
    expect(result.writes.every((row) => row.mode === "rewrite")).toBe(true);
    expect((await session.chapter.get(1))?.final).toContain("林深守着灯塔");
    expect((await session.chapter.get(2))?.final).toContain("林深没有下山");
    expect((await session.getProgress())?.pendingRewrites).toEqual([]);
    expect(llm.calls.filter((call) => call.agent === "writer").length).toBeGreaterThan(0);
  });

  it("rewriteChapters without llm throws before mutating when chapters would be written", async () => {
    const store = new MemoryStore();
    const session = await seedWrittenBook(store, [1]);
    const before = await session.getFoundation();

    await expect(
      session.applyFoundationChange({
        patch: rewritePatch,
        confirmRewrite: true,
        rewriteChapters: true,
      }),
    ).rejects.toBeInstanceOf(SessionLlmRequiredError);

    expect(await session.getFoundation()).toEqual(before);
  });

  it("applyFoundationChange holds the busy flag against chapter.write", async () => {
    const store = new MemoryStore();
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = new MockLlm([() => gate, { text: "done" }]);
    const session = await createNovelSession({ store, llm, bookId: "busy" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await session.chapter.saveFinal(1, short.chapters["1"]!.content);

    const pending = session.applyFoundationChange({
      patch: rewritePatch,
      confirmRewrite: true,
      rewriteChapters: true,
    });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (llm.callCount > 0) {
          resolve();
          return;
        }
        setTimeout(check, 5);
      };
      check();
    });
    await expect(session.chapter.write({ chapter: 1, mode: "rewrite" })).rejects.toBeInstanceOf(
      SessionBusyError,
    );
    release(writerTurns(1, "重写：林深。")[0]!);
    const result = await pending;
    expect(result.status).toBe("applied");
  });
});

describe("S5/S6 worker protocol", () => {
  it("accepts additive assess/apply commands on SESSION_PROTOCOL 1", () => {
    expect(
      isSessionCommand({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "assessFoundationImpact",
        id: "s-a",
        patch: { book: short.book },
      }),
    ).toBe(true);
    expect(
      isSessionCommand({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "applyFoundationChange",
        id: "s-b",
        options: { patch: { book: short.book }, confirmRewrite: true },
      }),
    ).toBe(true);
  });

  it("assess and apply round-trip on a fake port without mutating on needs_confirm", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    const inner = await seedWrittenBook(store, [1]);
    inner.close();
    const attached = attachSessionWorker(worker, {
      createSession: () => createNovelSession({ store, bookId: "letter" }),
    });
    const session = createSessionClient(host, { bookId: "letter" });

    const assessed = await session.assessFoundationImpact(rewritePatch);
    expect(assessed.severity).toBe("rewrite_needed");
    expect((await session.getFoundation()).premise).toBe(short.premise);

    const gated = await session.applyFoundationChange({ patch: rewritePatch });
    expect(gated.status).toBe("needs_confirm");
    expect((await session.getFoundation()).premise).toBe(short.premise);

    const applied = await session.applyFoundationChange({
      patch: rewritePatch,
      confirmRewrite: true,
    });
    expect(applied.status).toBe("applied");
    if (applied.status === "applied") {
      expect(applied.meta.premise).toBe(rewritePatch.premise);
      expect(applied.writes).toEqual([]);
    }

    session.close();
    attached.detach();
  });
});
