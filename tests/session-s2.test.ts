import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  MemoryStore,
  MockLlm,
  PATHS,
  writeJson,
  type Progress,
} from "../src/index.js";
import {
  FOUNDATION_KEYS,
  SessionLlmRequiredError,
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

describe("NovelSession S2 upsertFoundation", () => {
  it("writes PATHS and clears foundation_audit when fingerprint files change", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "letter" });
    await writeJson(store, PATHS.foundationAudit, {
      fingerprint: "deadbeef",
      ready: true,
      summary: "stale",
      issues: [],
    });
    expect(await store.has(PATHS.foundationAudit)).toBe(true);

    const meta = await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });

    expect(meta.book).toEqual(short.book);
    expect(meta.premise).toBe(short.premise);
    expect(meta.outline).toEqual(short.outline);
    expect(meta.characters).toEqual(short.characters);
    expect(meta.worldRules).toEqual(short.world_rules);
    expect(meta.audit).toBeNull();
    expect(await store.has(PATHS.foundationAudit)).toBe(false);
    expect(await store.has("drafts/01.draft.md")).toBe(false);
    expect(await store.has("chapters/01.md")).toBe(false);
  });
});

describe("NovelSession S2 generateFoundation", () => {
  it("throws when llm is missing", async () => {
    const session = await createNovelSession({ store: new MemoryStore(), bookId: "no-llm" });
    await expect(
      session.generateFoundation({ prompt: short.prompt, keys: ["premise"] }),
    ).rejects.toBeInstanceOf(SessionLlmRequiredError);
  });

  it("fill_missing only writes gap keys; JSON comes from MockLlm text", async () => {
    const store = new MemoryStore();
    const llm = new MockLlm([
      {
        text: JSON.stringify({
          book: { title: "SHOULD NOT APPLY", synopsis: "overwrite blocked" },
          premise: "SHOULD NOT APPLY",
          outline: short.outline,
          characters: short.characters,
          world_rules: short.world_rules,
        }),
      },
    ]);
    const session = await createNovelSession({ store, llm, bookId: "fill" });
    await session.upsertFoundation({ book: short.book, premise: short.premise });

    const meta = await session.generateFoundation({
      prompt: short.prompt,
      keys: FOUNDATION_KEYS,
      mode: "fill_missing",
    });

    expect(llm.callCount).toBe(1);
    expect(llm.calls[0]?.messages.some((row) => row.role === "user")).toBe(true);
    expect(meta.book).toEqual(short.book);
    expect(meta.premise).toBe(short.premise);
    expect(meta.outline).toEqual(short.outline);
    expect(meta.characters).toEqual(short.characters);
    expect(meta.worldRules).toEqual(short.world_rules);
    expect(await store.has("drafts/01.plan.json")).toBe(false);
    expect(await store.has("chapters/01.md")).toBe(false);
  });
});

describe("NovelSession S2 startAutoWrite", () => {
  it("requireConfirmGaps returns needs_foundation without Engine.run", async () => {
    const llm = new MockLlm([
      {
        text: "engine should not be called",
      },
    ]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "confirm",
    });
    const events: SessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    const result = await session.startAutoWrite({
      prompt: short.prompt,
      requireConfirmGaps: true,
    });

    expect(result.status).toBe("needs_foundation");
    if (result.status !== "needs_foundation") {
      throw new Error("expected needs_foundation");
    }
    expect(result.gaps.map((gap) => gap.key)).toContain("book");
    expect(llm.callCount).toBe(0);
    expect(events.some((event) => event.type === "stopped")).toBe(true);
  });

  it("generateMissing fill then still needs_foundation while audit/phase remain", async () => {
    const llm = new MockLlm([
      {
        text: JSON.stringify({
          book: short.book,
          premise: short.premise,
          outline: short.outline,
          characters: short.characters,
          world_rules: short.world_rules,
        }),
      },
    ]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "gen-missing",
    });

    const result = await session.startAutoWrite({
      prompt: short.prompt,
      generateMissing: true,
    });

    expect(result.status).toBe("needs_foundation");
    if (result.status !== "needs_foundation") {
      throw new Error("expected needs_foundation");
    }
    expect(result.gaps.map((gap) => gap.key)).toEqual(["foundation_audit"]);
    expect(result.gaps[0]?.kind).toBe("audit");
    expect(result.auditOnly).toBe(true);
    expect(result.meta.book).toEqual(short.book);
    expect(llm.callCount).toBe(1);
  });

  it("confirmAuditGap proceeds when leftover is only foundation_audit", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({
      store,
      llm: MockLlm.fromHandler(shortBookLlmHandler(short)),
      bookId: "audit-confirm",
    });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    const blocked = await session.startAutoWrite({ prompt: short.prompt, maxSteps: 4 });
    expect(blocked.status).toBe("needs_foundation");
    if (blocked.status !== "needs_foundation") {
      throw new Error("expected needs_foundation");
    }
    expect(blocked.auditOnly).toBe(true);

    const result = await session.startAutoWrite({
      prompt: short.prompt,
      confirmAuditGap: true,
      maxSteps: 24,
    });
    expect(result.status).not.toBe("needs_foundation");
  });

  it("confirmAuditGap does not skip non-audit gaps", async () => {
    const llm = new MockLlm([{ text: "engine should not be called" }]);
    const session = await createNovelSession({
      store: new MemoryStore(),
      llm,
      bookId: "not-only-audit",
    });
    const result = await session.startAutoWrite({
      prompt: short.prompt,
      confirmAuditGap: true,
    });
    expect(result.status).toBe("needs_foundation");
    if (result.status !== "needs_foundation") {
      throw new Error("expected needs_foundation");
    }
    expect(result.auditOnly).toBe(false);
    expect(result.gaps.some((gap) => gap.key === "book")).toBe(true);
    expect(llm.callCount).toBe(0);
  });

  it("runs Engine when foundation is complete (short-book mock)", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({
      store,
      llm: MockLlm.fromHandler(shortBookLlmHandler(short)),
      bookId: "auto",
    });
    await session.upsertFoundation({
      book: short.book,
      premise: short.premise,
      outline: short.outline,
      characters: short.characters,
      worldRules: short.world_rules,
    });
    await store.saveProgress(writing());

    const steps: number[] = [];
    session.subscribe((event) => {
      if (event.type === "auto_write_step") {
        steps.push(event.step);
      }
    });

    const result = await session.startAutoWrite({
      prompt: short.prompt,
      maxSteps: 20,
    });

    expect(result.status).toBe("completed");
    if (result.status === "needs_foundation") {
      throw new Error("expected engine outcome");
    }
    expect(result.result.stoppedReason).toBe("complete");
    expect(result.result.phase).toBe("complete");
    expect(steps.length).toBeGreaterThan(0);
    expect(await store.has("chapters/01.md")).toBe(true);
  });
});
