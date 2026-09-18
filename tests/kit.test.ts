import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import { MemoryStore, MockLlm } from "../src/index.js";
import {
  FoundationIncompleteError,
} from "../src/session/index.js";
import {
  KitClosedError,
  KitLlmRequiredError,
  KitWorkerError,
  KitWorkspaceDisabledError,
  NovelKit,
  type FoundationPatch,
} from "../src/kit/index.js";
import type { ShortBookFixture } from "./helpers/short-book-llm.js";

const short = shortBook as unknown as ShortBookFixture;

const rewritePatch: FoundationPatch = {
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
  premise: "林深从未离开灯塔。",
};

function unusedLlm(): MockLlm {
  return new MockLlm([{ text: "engine should not be called" }]);
}

describe("NovelKit.create (runtime: main, store: memory)", () => {
  it("requires llm on main, defaults bookId, and rejects new without create", async () => {
    await expect(NovelKit.create({ runtime: "main", store: "memory" })).rejects.toBeInstanceOf(
      KitLlmRequiredError,
    );
    const kit = await NovelKit.create({
      runtime: "main",
      store: "memory",
      llm: unusedLlm(),
    });
    expect(kit.bookId).toBe("default");
    expect(kit.runtime).toBe("main");
    expect(kit.storeKind).toBe("memory");
    kit.dispose();
  });

  it("inspect / fillFoundation / assertReady wrap Session", async () => {
    const kit = await NovelKit.create({
      runtime: "main",
      store: "memory",
      llm: unusedLlm(),
      bookId: "letter",
      workspace: false,
    });

    const empty = await kit.inspect({ prompt: "写一本三章短篇" });
    expect(empty.readyToWrite).toBe(false);
    expect(empty.gaps.map((gap) => gap.key)).toContain("book");
    await expect(kit.assertReady({ prompt: "写一本三章短篇" })).rejects.toBeInstanceOf(
      FoundationIncompleteError,
    );

    await kit.fillFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    const meta = await kit.getMeta();
    expect(meta.book).toEqual(short.book);
    expect(meta.characters).toEqual(short.characters);
    expect((await kit.listArtifacts()).length).toBeGreaterThan(0);

    kit.dispose();
    await expect(kit.inspect()).rejects.toBeInstanceOf(KitClosedError);
  });

  it("assessFoundation + applyFoundation confirm gate (proposed patch, rewriteChapters default false)", async () => {
    const kit = await NovelKit.create({
      runtime: "main",
      store: "memory",
      llm: unusedLlm(),
      bookId: "letter",
      workspace: false,
    });
    await kit.fillFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    const chapter1 = short.chapters["1"];
    if (!chapter1) {
      throw new Error("missing fixture chapter 1");
    }
    await kit.saveChapter(1, chapter1.content);
    expect((await kit.getChapter(1))?.final).toBe(chapter1.content);
    expect((await kit.getProgress())?.completedChapters).toContain(1);

    const before = await kit.getMeta();
    const assessment = await kit.assessFoundation(rewritePatch);
    expect(assessment.severity).toBe("rewrite_needed");
    expect(await kit.getMeta()).toEqual(before);

    const gated = await kit.applyFoundation({ patch: rewritePatch });
    expect(gated.status).toBe("needs_confirm");
    expect(await kit.getMeta()).toEqual(before);
    expect((await kit.getChapter(1))?.final).toBe(chapter1.content);

    const applied = await kit.applyFoundation({
      patch: rewritePatch,
      confirmRewrite: true,
    });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") {
      return;
    }
    expect(applied.writes).toEqual([]);
    expect(applied.meta.characters).toEqual(rewritePatch.characters);
    expect((await kit.getChapter(1))?.final).toBe(chapter1.content);

    kit.dispose();
  });

  it("startBook returns needs_foundation without Engine.run", async () => {
    const llm = unusedLlm();
    const kit = await NovelKit.create({
      runtime: "main",
      store: "memory",
      llm,
      bookId: "confirm",
      workspace: false,
    });
    const result = await kit.startBook({ prompt: short.prompt });
    expect(result.status).toBe("needs_foundation");
    if (result.status !== "needs_foundation") {
      throw new Error("expected needs_foundation");
    }
    expect(result.gaps.map((gap) => gap.key)).toContain("book");
    expect(result.auditOnly).toBe(false);
    expect(llm.callCount).toBe(0);
    expect(await kit.pauseBook()).toEqual({ status: "idle" });
    kit.dispose();
  });

  it("startBook confirmAuditGap when leftover is audit-only; deleteChapter + updateOutline", async () => {
    const kit = await NovelKit.create({
      runtime: "main",
      store: "memory",
      llm: unusedLlm(),
      bookId: "letter",
      workspace: false,
    });
    await kit.fillFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    const inspected = await kit.inspect({ prompt: short.prompt });
    expect(inspected.auditOnly).toBe(true);
    const blocked = await kit.startBook({ prompt: short.prompt });
    expect(blocked.status).toBe("needs_foundation");
    if (blocked.status !== "needs_foundation") {
      throw new Error("expected needs_foundation");
    }
    expect(blocked.auditOnly).toBe(true);

    const chapter1 = short.chapters["1"];
    if (!chapter1) {
      throw new Error("missing fixture chapter 1");
    }
    await kit.saveChapter(1, chapter1.content);
    const deleted = await kit.deleteChapter(1, { syncOutline: true });
    expect(deleted.removed).toContain("chapters/01.md");
    expect(deleted.outlineSynced).toBe(true);
    expect((await kit.getChapter(1))?.final).toBeUndefined();
    expect((await kit.getMeta()).outline?.map((row) => row.chapter)).toEqual([2, 3]);

    const meta = await kit.updateOutline({
      outline: [
        { chapter: 1, title: "风暴之后", summary: "捡到信。" },
        { chapter: 2, title: "岸边的地址", summary: "空屋。" },
      ],
    });
    expect(meta.outline?.map((row) => row.chapter)).toEqual([1, 2]);
    await expect(kit.updateOutline({})).rejects.toThrow(/outline/);
    kit.dispose();
  });

  it("workspace createBook / switchBook / listBooks; workspace: false throws", async () => {
    const kit = await NovelKit.create({
      runtime: "main",
      store: "memory",
      llm: unusedLlm(),
      bookId: "a",
    });
    expect((await kit.listBooks()).map((row) => row.bookId)).toEqual(["a"]);
    await kit.fillFoundation({ book: short.book, premise: short.premise });

    const created = await kit.createBook({ bookId: "b", title: "第二本" });
    expect(created.bookId).toBe("b");
    expect(kit.bookId).toBe("b");
    expect((await kit.getMeta()).book).toBeNull();

    await kit.switchBook("a");
    expect(kit.bookId).toBe("a");
    expect((await kit.getMeta()).book).toEqual(short.book);

    kit.dispose();

    const single = await NovelKit.create({
      runtime: "main",
      store: "memory",
      llm: unusedLlm(),
      workspace: false,
    });
    await expect(single.listBooks()).rejects.toBeInstanceOf(KitWorkspaceDisabledError);
    await expect(single.createBook()).rejects.toBeInstanceOf(KitWorkspaceDisabledError);
    await expect(single.switchBook("x")).rejects.toBeInstanceOf(KitWorkspaceDisabledError);
    single.dispose();
  });

  it("custom StorePort reports storeKind custom and blocks multi-book", async () => {
    const store = new MemoryStore();
    const kit = await NovelKit.create({
      runtime: "main",
      store,
      llm: unusedLlm(),
      bookId: "custom-book",
    });
    expect(kit.storeKind).toBe("custom");
    await expect(kit.listBooks()).rejects.toMatchObject({ name: "KitWorkspaceDisabledError" });
    kit.dispose();
  });
});

describe("NovelKit.create worker runtime in Node", () => {
  it("throws a clear error when Worker is missing (CI / Node)", async () => {
    const prev = (globalThis as { Worker?: unknown }).Worker;
    delete (globalThis as { Worker?: unknown }).Worker;
    try {
      await expect(
        NovelKit.create({ runtime: "worker", store: "memory", llmEndpoint: "/api/llm" }),
      ).rejects.toBeInstanceOf(KitWorkerError);
    } finally {
      if (prev !== undefined) {
        (globalThis as unknown as { Worker: unknown }).Worker = prev;
      }
    }
  });
});
