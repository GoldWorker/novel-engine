import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  ENGINE_PROTOCOL,
  MemoryStore,
  MockLlm,
  writeText,
  type LlmCompletionResult,
} from "../src/index.js";
import {
  ChapterConflictError,
  FoundationIncompleteError,
  SESSION_NS,
  SESSION_PROTOCOL,
  SessionBusyError,
  attachSessionWorker,
  createNovelSession,
  createSessionClient,
  isSessionCommand,
  isSessionNotice,
  type SessionEvent,
} from "../src/session/index.js";
import { createLinkedMessagePorts } from "./helpers/fake-ports.js";
import type { ShortBookFixture } from "./helpers/short-book-llm.js";

const short = shortBook as unknown as ShortBookFixture;

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

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
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

describe("session worker protocol", () => {
  it("accepts session command / notice discriminators and rejects engine messages", () => {
    expect(
      isSessionCommand({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "getFoundation",
        id: "s-1",
      }),
    ).toBe(true);
    expect(
      isSessionCommand({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "startAutoWrite",
        id: "s-2",
        options: { prompt: "写一本三章短篇" },
      }),
    ).toBe(true);
    expect(
      isSessionCommand({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "chapterWrite",
        id: "s-3",
        input: { chapter: 1, mode: "create" },
      }),
    ).toBe(true);
    expect(isSessionCommand({ v: ENGINE_PROTOCOL, type: "start", id: "c-1" })).toBe(false);
    expect(isSessionCommand({ type: "getFoundation", id: "s-1" })).toBe(false);

    expect(
      isSessionNotice({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "result",
        id: "s-1",
        result: null,
      }),
    ).toBe(true);
    expect(
      isSessionNotice({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "event",
        event: { type: "stopped", result: { status: "needs_foundation", gaps: [], meta: {} } },
      }),
    ).toBe(true);
    expect(
      isSessionNotice({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "error",
        id: "s-1",
        name: "SessionBusyError",
        message: "session is busy",
      }),
    ).toBe(true);
    expect(isSessionNotice({ v: ENGINE_PROTOCOL, type: "error", message: "nope" })).toBe(false);
  });

  it("inspectFoundation / getFoundation / upsert round-trip on a fake port", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    const attached = attachSessionWorker(worker, {
      createSession: () => createNovelSession({ store, bookId: "letter" }),
    });
    const session = createSessionClient(host, { bookId: "letter" });

    const empty = await session.inspectFoundation({ prompt: "写一本三章短篇" });
    expect(empty.readyToWrite).toBe(false);
    expect(empty.gaps.map((gap) => gap.key)).toContain("book");

    const events: SessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
    });
    const meta = await session.getFoundation();
    expect(meta.book).toEqual(short.book);
    expect(meta.premise).toBe(short.premise);
    expect(events.some((event) => event.type === "foundation_updated")).toBe(true);

    session.close();
    attached.detach();
  });

  it("chapter.get / saveFinal / write go through the worker session", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    const llm = new MockLlm(writerTurns(1, "第一章：林守捡到信。"));
    const attached = attachSessionWorker(worker, {
      createSession: () => createNovelSession({ store, llm, bookId: "letter" }),
    });
    const session = createSessionClient(host, { bookId: "letter" });

    expect(await session.chapter.get(1)).toBeNull();
    await session.chapter.saveFinal(2, "第二章终稿");
    expect((await session.chapter.get(2))?.final).toBe("第二章终稿");
    expect((await session.getProgress())?.completedChapters).toContain(2);

    const steps: string[] = [];
    session.subscribe((event) => {
      if (event.type === "chapter_step" && event.tool !== undefined) {
        steps.push(event.tool);
      }
    });
    const written = await session.chapter.write({ chapter: 1, mode: "create", title: "风暴之后" });
    expect(written.view.final).toContain("林守捡到信");
    expect(await store.has("chapters/01.md")).toBe(true);
    expect(steps).toEqual(["plan_chapter", "draft_chapter", "commit_chapter"]);

    await writeText(store, "chapters/03.md", "已有终稿");
    await expect(session.chapter.write({ chapter: 3, mode: "create" })).rejects.toBeInstanceOf(
      ChapterConflictError,
    );

    session.close();
    attached.detach();
  });

  it("generateFoundation runs in the worker (JSON in text) because the store lives there", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    const llm = new MockLlm([
      {
        text: JSON.stringify({
          outline: short.outline,
          characters: short.characters,
          world_rules: short.world_rules,
        }),
      },
    ]);
    const attached = attachSessionWorker(worker, {
      createSession: () => createNovelSession({ store, llm, bookId: "letter" }),
    });
    const session = createSessionClient(host, { bookId: "letter" });
    await session.upsertFoundation({ book: short.book, premise: short.premise });
    const meta = await session.generateFoundation({
      prompt: short.prompt,
      keys: ["outline", "characters", "world_rules"],
      mode: "fill_missing",
    });
    expect(meta.outline).toEqual(short.outline);
    expect(llm.callCount).toBe(1);

    await expect(session.assertReadyToWrite()).rejects.toBeInstanceOf(FoundationIncompleteError);

    session.close();
    attached.detach();
  });

  it("startAutoWrite in flight blocks chapter.write across the bridge", async () => {
    const { host, worker } = createLinkedMessagePorts();
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = new MockLlm([() => gate]);
    const attached = attachSessionWorker(worker, {
      createSession: () =>
        createNovelSession({ store: new MemoryStore(), llm, bookId: "busy" }),
    });
    const session = createSessionClient(host, { bookId: "busy" });

    const pending = session.startAutoWrite({
      prompt: short.prompt,
      generateMissing: true,
    });
    await waitFor(() => llm.callCount > 0);
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

    session.close();
    attached.detach();
  });

  it("pause / resume / steer reach the Engine across the bridge", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    let release!: (value: LlmCompletionResult) => void;
    const gate = new Promise<LlmCompletionResult>((resolve) => {
      release = resolve;
    });
    const llm = MockLlm.fromHandler(() => gate);
    const attached = attachSessionWorker(worker, {
      createSession: () => createNovelSession({ store, llm, bookId: "ctrl" }),
    });
    const session = createSessionClient(host, { bookId: "ctrl" });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: 3,
      completedChapters: [],
      pendingRewrites: [],
      layered: false,
    });

    const events: SessionEvent["type"][] = [];
    session.subscribe((event) => {
      events.push(event.type);
    });

    const pending = session.startAutoWrite({ prompt: short.prompt, maxSteps: 8 });
    await waitFor(() => llm.callCount > 0);
    expect(await session.pause()).toEqual({ status: "ok" });
    expect(await session.steer("往和解写")).toEqual({ status: "ok" });
    release({ text: "noop" });
    await waitFor(() => events.includes("paused"));
    expect(events).toContain("steered");
    expect(await session.resume()).toEqual({ status: "ok" });
    await pending;

    expect(await session.pause()).toEqual({ status: "idle" });
    session.close();
    attached.detach();
  });

  it("chapterDelete over the bridge removes artifacts", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    const attached = attachSessionWorker(worker, {
      createSession: () => createNovelSession({ store, bookId: "del" }),
    });
    const session = createSessionClient(host, { bookId: "del" });
    await writeText(store, "chapters/01.md", "终稿");
    const result = await session.chapter.delete(1);
    expect(result.removed).toContain("chapters/01.md");
    expect(await session.chapter.get(1)).toBeNull();
    session.close();
    attached.detach();
  });

  it("accepts pause / steer / chapterDelete commands", () => {
    expect(
      isSessionCommand({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "pause",
        id: "s-p",
      }),
    ).toBe(true);
    expect(
      isSessionCommand({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "steer",
        id: "s-s",
        note: "往左",
      }),
    ).toBe(true);
    expect(
      isSessionCommand({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "chapterDelete",
        id: "s-d",
        chapter: 1,
        options: { syncOutline: true },
      }),
    ).toBe(true);
  });

  it("posts error for an invalid command", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const notices: unknown[] = [];
    host.addEventListener("message", (event) => {
      notices.push(event.data);
    });
    const attached = attachSessionWorker(worker, {
      createSession: () => createNovelSession({ store: new MemoryStore(), bookId: "x" }),
    });
    host.postMessage({ type: "nope" });
    await waitFor(() => notices.length > 0);
    expect(isSessionNotice(notices[0])).toBe(true);
    expect(notices[0]).toMatchObject({
      type: "error",
      name: "Error",
      message: "invalid session command",
    });
    attached.detach();
  });
});
