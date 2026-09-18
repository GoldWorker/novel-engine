import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  AbortedError,
  MemoryStore,
  MockLlm,
  writeText,
  type LlmCompletionResult,
  type Progress,
  type StorePort,
  type State,
} from "../src/index.js";
import {
  SESSION_RUN_STATES,
  StoreRemoveUnsupportedError,
  createNovelSession,
} from "../src/session/index.js";
import { shortBookLlmHandler, type ShortBookFixture } from "./helpers/short-book-llm.js";

const short = shortBook as unknown as ShortBookFixture;

const writing = (): Progress => ({
  phase: "writing",
  flow: "writing",
  totalChapters: 3,
  completedChapters: [],
  pendingRewrites: [],
  layered: false,
});

function writerTurns(chapter: number, content: string): LlmCompletionResult[] {
  return [
    {
      text: "write",
      toolCalls: [
        {
          id: `plan-${chapter}`,
          name: "plan_chapter",
          arguments: {
            chapter,
            title: "风暴之后",
            goal: "goal",
            conflict: "conflict",
            hook: "hook",
          },
        },
        {
          id: `draft-${chapter}`,
          name: "draft_chapter",
          arguments: { chapter, content, mode: "write" },
        },
        { id: `commit-${chapter}`, name: "commit_chapter", arguments: { chapter } },
      ],
    },
    { text: "done" },
  ];
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
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

describe("NovelSession cancel / getRunState", () => {
  it("cancel is idle when nothing is running; getRunState is idle", async () => {
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm: new MockLlm([{ text: "unused" }]),
      bookId: "idle",
    });
    expect(SESSION_RUN_STATES).toContain("idle");
    expect(await session.getRunState()).toBe("idle");
    expect(await session.cancel()).toEqual({ status: "idle" });
    expect(await session.pause()).toEqual({ status: "idle" });
    expect(await session.getRunState()).toBe("idle");
  });

  it("startAutoWrite without signal still returns needs_foundation (0.6.0 path)", async () => {
    const llm = new MockLlm([{ text: "engine should not be called" }]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "compat",
    });
    const result = await session.startAutoWrite({ prompt: short.prompt });
    expect(result.status).toBe("needs_foundation");
    expect(llm.callCount).toBe(0);
    expect(await session.getRunState()).toBe("idle");
  });

  it("getRunState is generating_missing during generateMissing; cancel throws AbortedError and clears busy", async () => {
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = new MockLlm([() => gate]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "gen-cancel",
    });

    const pending = session.startAutoWrite({
      prompt: short.prompt,
      generateMissing: true,
    });
    await waitFor(() => llm.callCount > 0);
    expect(await session.getRunState()).toBe("generating_missing");
    expect(await session.pause()).toEqual({ status: "idle" });

    expect(await session.cancel()).toEqual({ status: "ok" });
    await expect(pending).rejects.toBeInstanceOf(AbortedError);
    expect(await session.getRunState()).toBe("idle");
    release({ text: "{}" });
    const again = await session.startAutoWrite({ prompt: short.prompt });
    expect(again.status).toBe("needs_foundation");
  });

  it("cancel during Engine.run rejects AbortedError; getRunState running then idle", async () => {
    const store = new MemoryStore();
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const handler = shortBookLlmHandler(short);
    const llm = new MockLlm([() => gate], handler);
    const session = await createNovelSession({ store, llm, bookId: "eng-cancel" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await store.saveProgress(writing());

    const pending = session.startAutoWrite({ prompt: short.prompt, maxSteps: 24 });
    await waitFor(() => llm.callCount > 0);
    expect(await session.getRunState()).toBe("running");
    expect(await session.pause()).toEqual({ status: "ok" });
    expect(await session.getRunState()).toBe("paused");
    expect(await session.resume()).toEqual({ status: "ok" });

    expect(await session.cancel()).toEqual({ status: "ok" });
    await expect(pending).rejects.toBeInstanceOf(AbortedError);
    expect(await session.getRunState()).toBe("idle");
    release(handler(llm.calls[0]!));
  });

  it("AbortSignal on startAutoWrite aborts the in-flight run", async () => {
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = new MockLlm([() => gate]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "signal",
    });
    const controller = new AbortController();
    const pending = session.startAutoWrite({
      prompt: short.prompt,
      generateMissing: true,
      signal: controller.signal,
    });
    await waitFor(() => llm.callCount > 0);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AbortedError);
    expect(await session.getRunState()).toBe("idle");
    release({ text: "{}" });
  });

  it("already-aborted signal throws before taking busy or calling the LLM", async () => {
    const llm = new MockLlm([{ text: "unused" }]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "pre-aborted",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      session.startAutoWrite({ prompt: short.prompt, generateMissing: true, signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortedError);
    expect(llm.callCount).toBe(0);
    expect(await session.getRunState()).toBe("idle");
  });

  it("cancel during generateFoundation; getRunState generating_missing", async () => {
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = new MockLlm([() => gate]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "gen-f",
    });
    const pending = session.generateFoundation({
      prompt: short.prompt,
      keys: ["premise"],
    });
    await waitFor(() => llm.callCount > 0);
    expect(await session.getRunState()).toBe("generating_missing");
    expect(await session.cancel()).toEqual({ status: "ok" });
    await expect(pending).rejects.toBeInstanceOf(AbortedError);
    expect(await session.getRunState()).toBe("idle");
    release({ text: JSON.stringify({ premise: "灯塔" }) });
  });

  it("cancel during chapter.write; getRunState busy; compatibility write without signal still works", async () => {
    const store = new MemoryStore();
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = new MockLlm([() => gate, ...writerTurns(1, "终稿：林守捡到信。")]);
    const session = await createNovelSession({ store, llm, bookId: "ch-cancel" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });

    const pending = session.chapter.write({ chapter: 1, mode: "create" });
    await waitFor(() => llm.callCount > 0);
    expect(await session.getRunState()).toBe("busy");
    expect(await session.pause()).toEqual({ status: "idle" });
    expect(await session.cancel()).toEqual({ status: "ok" });
    await expect(pending).rejects.toBeInstanceOf(AbortedError);
    expect(await session.getRunState()).toBe("idle");
    release({ text: "ignored" });

    const written = await session.chapter.write({ chapter: 1, mode: "create", force: true });
    expect(written.view.final).toContain("林守");
  });
});

describe("chapter.delete store.remove requirement", () => {
  it("throws StoreRemoveUnsupportedError before mutating progress when remove is absent", async () => {
    const files = new Map<string, Uint8Array>();
    const progress: Progress = {
      phase: "writing",
      flow: "writing",
      totalChapters: 3,
      completedChapters: [1],
      pendingRewrites: [],
      layered: false,
      currentChapter: 1,
    };
    const store: StorePort = {
      async loadState(): Promise<State> {
        return { progress };
      },
      async loadProgress() {
        return progress;
      },
      async saveProgress(next) {
        Object.assign(progress, next);
      },
      async read(path) {
        return files.get(path)?.slice() ?? null;
      },
      async write(path, data) {
        files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data.slice());
      },
      async has(path) {
        return files.has(path);
      },
    };
    await writeText(store, "chapters/01.md", "终稿");
    const session = await createNovelSession({ store, bookId: "no-remove" });
    await expect(session.chapter.delete(1)).rejects.toBeInstanceOf(StoreRemoveUnsupportedError);
    expect(await store.has("chapters/01.md")).toBe(true);
    expect((await session.getProgress())?.completedChapters).toEqual([1]);
  });
});
