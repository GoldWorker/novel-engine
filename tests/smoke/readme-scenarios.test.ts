/**
 * README host-job smoke (Tier 2). High-signal walks of the documented Kit
 * scenarios with MockLlm — not a second copy of unit coverage.
 *
 * Run: `npm run test:smoke` (also included in `npm test`).
 */
import { describe, expect, it } from "vitest";
import layeredBook from "../../fixtures/layered-book.json" with { type: "json" };
import shortBook from "../../fixtures/short-book.json" with { type: "json" };
import {
  AbortedError,
  MockLlm,
  type LlmCompletionResult,
  type VolumeOutline,
} from "../../src/index.js";
import {
  NovelKit,
  type FoundationPatch,
} from "../../src/kit/index.js";
import { layeredBookLlmHandler, type LayeredBookFixture } from "../helpers/layered-book-llm.js";
import { shortBookLlmHandler, type ShortBookFixture } from "../helpers/short-book-llm.js";

const short = shortBook as unknown as ShortBookFixture;
const layered = layeredBook as unknown as LayeredBookFixture;

const rewritePatch: FoundationPatch = {
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
  premise: "林深从未离开灯塔。",
};

function unusedLlm(): MockLlm {
  return new MockLlm([{ text: "engine should not be called" }]);
}

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
        { id: `commit-${chapter}-${content.length}`, name: "commit_chapter", arguments: { chapter } },
      ],
    },
    { text: "done" },
  ];
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 5);
    });
  }
}

async function createMainKit(llm: MockLlm, bookId: string): Promise<NovelKit> {
  return NovelKit.create({
    runtime: "main",
    store: "memory",
    llm,
    bookId,
    workspace: false,
  });
}

async function fillShortFoundation(kit: NovelKit): Promise<void> {
  await kit.fillFoundation({
    book: short.book,
    premise: short.premise,
    outline: short.outline,
    characters: short.characters,
    worldRules: short.world_rules,
  });
}

async function fillLayeredFoundation(kit: NovelKit): Promise<void> {
  await kit.fillFoundation({
    book: layered.book,
    premise: layered.premise,
    layeredOutline: layered.layered_outline as VolumeOutline[],
    characters: layered.characters,
    worldRules: layered.world_rules,
  });
}

async function startBookThroughAudit(kit: NovelKit, prompt: string, maxSteps: number) {
  let outcome = await kit.startBook({ prompt, generateMissing: true, maxSteps });
  if (outcome.status === "needs_foundation" && outcome.auditOnly) {
    outcome = await kit.startBook({ prompt, confirmAuditGap: true, maxSteps });
  }
  return outcome;
}

describe("README host-job smoke (MockLlm, runtime: main)", () => {
  it("1. short book: inspect → fill → startBook → confirmAuditGap → completed/stopped", async () => {
    const kit = await createMainKit(MockLlm.fromHandler(shortBookLlmHandler(short)), "smoke-short");
    try {
      const inspected = await kit.inspect({ prompt: short.prompt });
      expect(inspected.planning.tier).toBe("short");
      expect(inspected.readyToWrite).toBe(false);
      expect(inspected.gaps.map((gap) => gap.key)).toContain("book");

      await fillShortFoundation(kit);
      const afterFill = await kit.inspect({ prompt: short.prompt });
      expect(afterFill.auditOnly).toBe(true);

      const blocked = await kit.startBook({ prompt: short.prompt, generateMissing: true });
      expect(blocked.status).toBe("needs_foundation");
      if (blocked.status !== "needs_foundation") {
        throw new Error("expected needs_foundation after fill");
      }
      expect(blocked.auditOnly).toBe(true);

      const outcome = await kit.startBook({
        prompt: short.prompt,
        confirmAuditGap: true,
        maxSteps: 24,
      });
      expect(outcome.status).toBe("completed");
      if (outcome.status !== "completed") {
        throw new Error("expected completed");
      }
      expect(outcome.result.phase).toBe("complete");
      expect((await kit.getChapter(1))?.final).toContain("蜡封的瓶子");
    } finally {
      kit.dispose();
    }
  });

  it("2. mid/layered: fill layeredOutline → startBook (+ audit confirm)", async () => {
    const kit = await createMainKit(
      MockLlm.fromHandler(layeredBookLlmHandler(layered)),
      "smoke-layered",
    );
    try {
      const inspected = await kit.inspect({ prompt: layered.prompt });
      expect(inspected.planning.tier).toBe("mid");

      await fillLayeredFoundation(kit);
      const afterFill = await kit.inspect({ prompt: layered.prompt });
      expect(afterFill.gaps.every((gap) => gap.key === "foundation_audit")).toBe(true);

      const outcome = await startBookThroughAudit(kit, layered.prompt, 40);
      expect(outcome.status).toBe("completed");
      expect((await kit.getMeta()).layeredOutline?.length).toBeGreaterThan(0);
      expect((await kit.getProgress())?.layered).toBe(true);
    } finally {
      kit.dispose();
    }
  });

  it("3. mid-story meta: assess → apply two-step for rewrite_needed", async () => {
    const kit = await createMainKit(unusedLlm(), "smoke-meta");
    try {
      await fillShortFoundation(kit);
      const chapter1 = short.chapters["1"];
      if (!chapter1) {
        throw new Error("missing fixture chapter 1");
      }
      await kit.saveChapter(1, chapter1.content);

      const before = await kit.getMeta();
      const assessment = await kit.assessFoundation(rewritePatch);
      expect(assessment.severity).toBe("rewrite_needed");
      expect(await kit.getMeta()).toEqual(before);

      const gated = await kit.applyFoundation({ patch: rewritePatch });
      expect(gated.status).toBe("needs_confirm");
      expect(await kit.getMeta()).toEqual(before);

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
    } finally {
      kit.dispose();
    }
  });

  it("4. chapters: writeChapter create → getChapter → deleteChapter syncOutline", async () => {
    const llm = new MockLlm(writerTurns(1, "第一章：林守在风暴后捡到信。"));
    const kit = await createMainKit(llm, "smoke-chapter");
    try {
      await fillShortFoundation(kit);
      expect(await kit.getChapter(1)).toBeNull();

      const written = await kit.writeChapter({
        chapter: 1,
        mode: "create",
        title: "风暴之后",
      });
      expect(written.chapter).toBe(1);
      expect(written.mode).toBe("create");
      const view = await kit.getChapter(1);
      expect(view?.final).toContain("林守在风暴后捡到信");

      const deleted = await kit.deleteChapter(1, { syncOutline: true });
      expect(deleted.removed).toContain("chapters/01.md");
      expect(deleted.outlineSynced).toBe(true);
      expect(await kit.getChapter(1)).toBeNull();
      expect((await kit.getMeta()).outline?.map((row) => row.chapter)).toEqual([2, 3]);
    } finally {
      kit.dispose();
    }
  });

  it("5. control: startBook in flight → pause / resume / cancel + getRunState", async () => {
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const handler = shortBookLlmHandler(short);
    const llm = new MockLlm([() => gate], handler);
    const kit = await createMainKit(llm, "smoke-control");
    try {
      await fillShortFoundation(kit);
      expect(await kit.getRunState()).toBe("idle");
      expect(await kit.pauseBook()).toEqual({ status: "idle" });

      const pending = kit.startBook({
        prompt: short.prompt,
        confirmAuditGap: true,
        maxSteps: 24,
      });
      await waitFor(() => llm.callCount > 0);
      expect(await kit.getRunState()).toBe("running");

      expect(await kit.pauseBook()).toEqual({ status: "ok" });
      expect(await kit.getRunState()).toBe("paused");

      expect(await kit.resumeBook()).toEqual({ status: "ok" });
      expect(await kit.getRunState()).toBe("running");

      expect(await kit.cancelBook()).toEqual({ status: "ok" });
      await expect(pending).rejects.toBeInstanceOf(AbortedError);
      expect(await kit.getRunState()).toBe("idle");
      release(handler(llm.calls[0]!));
    } finally {
      kit.dispose();
    }
  });

  it("6. export/import roundtrip on MemoryStore", async () => {
    const source = await createMainKit(unusedLlm(), "smoke-export");
    const dest = await createMainKit(unusedLlm(), "smoke-import");
    try {
      await fillShortFoundation(source);
      const chapter1 = short.chapters["1"];
      if (!chapter1) {
        throw new Error("missing fixture chapter 1");
      }
      await source.saveChapter(1, chapter1.content);

      const bytes = await source.exportBook();
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);

      await dest.importBook(bytes);
      expect((await dest.getMeta()).book).toEqual(short.book);
      expect((await dest.getMeta()).premise).toBe(short.premise);
      expect((await dest.getChapter(1))?.final).toBe(chapter1.content);
      expect((await dest.listArtifacts()).length).toBeGreaterThan(0);
    } finally {
      source.dispose();
      dest.dispose();
    }
  });
});
