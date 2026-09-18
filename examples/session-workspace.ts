/**
 * Scenario 7 — same-thread host session (`novel-engine/session`).
 * 场景 7：同线程宿主 Session（`novel-engine/session`）。
 *
 * S0–S6 same-thread. Worker bridge is scenario 8 (`session-host.ts`).
 * S0–S6 同线程。Worker 桥见场景 8（`session-host.ts`）。
 */

import { MemoryStore, MockLlm } from "novel-engine";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";

export async function inspectExistingStore() {
  const store = new MemoryStore();
  const session = await createNovelSession({ store, bookId: "letter" });
  await session.upsertFoundation({
    book: { title: "无主的信", synopsis: "灯塔与潮" },
    premise: "林守捡到一封没有寄信人的信。",
  });
  return session.inspectFoundation({ prompt: "写一本三章短篇" });
}

/** MockLlm: generateFoundation reads JSON from `text`, not toolCalls. */
export async function generateWithMockJson() {
  const llm = new MockLlm([
    {
      text: JSON.stringify({
        outline: [{ chapter: 1, title: "风暴之后", summary: "捡到信" }],
        characters: [{ name: "林守", role: "主角" }],
        world_rules: [{ name: "信与潮", description: "涨潮来信" }],
      }),
    },
  ]);
  const session = await createNovelSession({
    store: new MemoryStore(),
    llm,
    bookId: "letter",
  });
  await session.upsertFoundation({
    book: { title: "无主的信", synopsis: "灯塔与潮" },
    premise: "林守捡到一封没有寄信人的信。",
  });
  await session.generateFoundation({
    prompt: "写一本三章短篇",
    keys: ["outline", "characters", "world_rules"],
    mode: "fill_missing",
  });
  return session.startAutoWrite({
    prompt: "写一本三章短篇",
    requireConfirmGaps: true,
  });
}

/** MockLlm: chapter.write uses writer toolCalls, not Engine.run. */
export async function writeChapterWithMockTools() {
  const llm = new MockLlm([
    {
      text: "write",
      toolCalls: [
        {
          id: "plan-1",
          name: "plan_chapter",
          arguments: {
            chapter: 1,
            title: "风暴之后",
            goal: "捡到信",
            conflict: "潮",
            hook: "灯",
          },
        },
        {
          id: "draft-1",
          name: "draft_chapter",
          arguments: { chapter: 1, content: "林守捡到一封信。", mode: "write" },
        },
        { id: "commit-1", name: "commit_chapter", arguments: { chapter: 1 } },
      ],
    },
    { text: "done" },
  ]);
  const session = await createNovelSession({
    store: new MemoryStore(),
    llm,
    bookId: "letter",
  });
  return session.chapter.write({ chapter: 1, mode: "create", title: "风暴之后" });
}

const SHORT_FOUNDATION = {
  book: { title: "无主的信", synopsis: "灯塔与潮" },
  premise: "林守捡到一封没有寄信人的信。",
  outline: [
    { chapter: 1, title: "风暴之后", summary: "林守在礁石缝里捡到那封信。" },
    { chapter: 2, title: "岸边的地址", summary: "按地址找到一座空屋。" },
    { chapter: 3, title: "回信", summary: "把守夜写进回信，放回海里。" },
  ],
  characters: [{ name: "林守", role: "主角", bio: "孤僻的灯塔看守人。" }],
  worldRules: [{ name: "信与潮", description: "涨潮来信" }],
};

async function seedMidStorySession(store = new MemoryStore()) {
  const session = await createNovelSession({ store, bookId: "letter" });
  await session.upsertFoundation({ ...SHORT_FOUNDATION });
  await session.chapter.saveFinal(1, "林守在风暴后捡到信。");
  await session.chapter.saveFinal(2, "林守按地址走进空屋。");
  return { store, session };
}

/** 7.2a — assess a proposed patch; do not upsert or rewrite. */
export async function assessFoundationImpactOnly() {
  const { session } = await seedMidStorySession();
  const patch = {
    // whole-file replace: 林守 is deleted, not renamed in place
    characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
  };
  const assessment = await session.assessFoundationImpact(patch);
  // assessment.severity / suggestedChapters / suggestedMode / reasons
  return { session, patch, assessment };
}

/** 7.2b — title/synopsis-style meta; apply without rewriting chapters. */
export async function applyMetaOnlyFoundationChange() {
  const { session } = await seedMidStorySession();
  const patch = {
    book: { title: "无主的信（修订）", synopsis: "灯塔与潮的简介改写，不改情节。" },
  };
  const assessment = await session.assessFoundationImpact(patch);
  const outcome = await session.applyFoundationChange({
    patch,
    rewriteChapters: false, // suggestedMode is "none"; rewriteChapters: true is a no-op unless mode is passed
  });
  return { assessment, outcome };
}

/** 7.2c — future outline / new character; written finals stay. */
export async function applyForwardOnlyFoundationChange() {
  const { session } = await seedMidStorySession();
  const patch = {
    // whole-file replace: keep written-chapter rows, then append the future chapter
    outline: [
      ...SHORT_FOUNDATION.outline,
      { chapter: 4, title: "灯塔之外", summary: "尚未写下的后续。" },
    ],
    // whole-file replace: keep 林守 when adding 潮
    characters: [
      ...SHORT_FOUNDATION.characters,
      { name: "潮", role: "未出场", bio: "只在后续出现。" },
    ],
  };
  const assessment = await session.assessFoundationImpact(patch);
  const outcome = await session.applyFoundationChange({
    patch,
    rewriteChapters: false, // suggestedMode is "none"; rewriteChapters: true is a no-op unless mode is passed
  });
  return { assessment, outcome };
}

/** 7.2d — rewrite_needed returns needs_confirm, then retry with confirmRewrite. */
export async function applyFoundationChangeConfirmGate() {
  const { session } = await seedMidStorySession();
  const patch = {
    premise: "林深从未离开灯塔。",
    // whole-file replace: 林守 is removed from characters.json
    characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
  };
  let outcome = await session.applyFoundationChange({ patch });
  if (outcome.status === "needs_confirm") {
    // show outcome.assessment.reasons in UI — store unchanged
    outcome = await session.applyFoundationChange({
      patch,
      confirmRewrite: true,
      rewriteChapters: false,
    });
  }
  return outcome;
}

/** 7.2e — after confirm, host opts in to sequential chapter.write. */
export async function applyFoundationChangeBatchRewrite() {
  const store = new MemoryStore();
  const llm = new MockLlm([
    {
      text: "write",
      toolCalls: [
        {
          id: "plan-1",
          name: "plan_chapter",
          arguments: {
            chapter: 1,
            title: "风暴之后",
            goal: "goal",
            conflict: "conflict",
            hook: "hook",
          },
        },
        {
          id: "draft-1",
          name: "draft_chapter",
          arguments: { chapter: 1, content: "重写：林深守着灯塔。", mode: "write" },
        },
        { id: "commit-1", name: "commit_chapter", arguments: { chapter: 1 } },
      ],
    },
    { text: "done" },
    {
      text: "write",
      toolCalls: [
        {
          id: "plan-2",
          name: "plan_chapter",
          arguments: {
            chapter: 2,
            title: "岸边的地址",
            goal: "goal",
            conflict: "conflict",
            hook: "hook",
          },
        },
        {
          id: "draft-2",
          name: "draft_chapter",
          arguments: { chapter: 2, content: "重写：林深没有下山。", mode: "write" },
        },
        { id: "commit-2", name: "commit_chapter", arguments: { chapter: 2 } },
      ],
    },
    { text: "done" },
  ]);
  const seeded = await seedMidStorySession(store);
  seeded.session.close();
  const session = await createNovelSession({ store, llm, bookId: "letter" });
  const patch = { characters: [{ name: "林深", role: "主角" }] }; // whole-file replace
  let outcome = await session.applyFoundationChange({ patch });
  if (outcome.status === "needs_confirm") {
    outcome = await session.applyFoundationChange({
      patch,
      confirmRewrite: true,
      rewriteChapters: true, // host opt-in — never the default; only on the confirmed retry
      instruction: "按新设定对齐本章",
    });
  }
  return outcome;
}

export async function twoBookWorkspace() {
  const stores = new Map<string, MemoryStore>();
  const ws = createNovelWorkspace({
    createStore(bookId) {
      const existing = stores.get(bookId);
      if (existing) {
        return existing;
      }
      const store = new MemoryStore();
      stores.set(bookId, store);
      return store;
    },
  });

  const a = await ws.createBook({ bookId: "book-a", title: "无主的信" });
  const b = await ws.createBook({ bookId: "book-b", title: "两弧灯塔" });
  const again = await ws.switchTo("book-a");
  return { ws, a, b, again, stores };
}
