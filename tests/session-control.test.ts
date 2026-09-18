import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  EngineError,
  MemoryStore,
  MockLlm,
  type LlmCompletionResult,
  type Progress,
} from "../src/index.js";
import {
  SessionBusyError,
  createNovelSession,
  type SessionEvent,
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

describe("NovelSession pause / resume / steer", () => {
  it("returns idle when no auto-write Engine is running", async () => {
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm: new MockLlm([{ text: "unused" }]),
      bookId: "idle",
    });
    expect(await session.pause()).toEqual({ status: "idle" });
    expect(await session.resume()).toEqual({ status: "idle" });
    expect(await session.steer("往左写")).toEqual({ status: "idle" });
  });

  it("rejects an empty steer note even when idle", async () => {
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm: new MockLlm([{ text: "unused" }]),
      bookId: "empty-steer",
    });
    await expect(session.steer("  ")).rejects.toBeInstanceOf(EngineError);
  });

  it("forwards pause / resume / steer to the Engine held during startAutoWrite", async () => {
    const store = new MemoryStore();
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const handler = shortBookLlmHandler(short);
    const llm = new MockLlm([() => gate], handler);
    const session = await createNovelSession({ store, llm, bookId: "ctrl" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await store.saveProgress(writing());

    const events: SessionEvent["type"][] = [];
    session.subscribe((event) => {
      events.push(event.type);
    });

    const pending = session.startAutoWrite({ prompt: short.prompt, maxSteps: 24 });
    await waitFor(() => llm.callCount > 0);

    expect(await session.pause()).toEqual({ status: "ok" });
    await expect(session.chapter.write({ chapter: 1, mode: "create" })).rejects.toBeInstanceOf(
      SessionBusyError,
    );

    const steered = await session.steer("把结局改成和解");
    expect(steered).toEqual({ status: "ok" });

    release(handler(llm.calls[0]!));
    await waitFor(() => events.includes("paused"));
    expect(events).toContain("steered");

    expect(await session.resume()).toEqual({ status: "ok" });
    await waitFor(() => events.includes("resumed"));

    const result = await pending;
    expect(result.status).not.toBe("needs_foundation");
  });

  it("pause during generateMissing (before Engine.run) is idle", async () => {
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = new MockLlm([() => gate]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "gen-busy",
    });

    const pending = session.startAutoWrite({
      prompt: short.prompt,
      generateMissing: true,
    });
    await waitFor(() => llm.callCount > 0);
    expect(await session.pause()).toEqual({ status: "idle" });

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
    if (outcome.status === "needs_foundation") {
      expect(outcome.auditOnly).toBe(true);
    }
  });
});
