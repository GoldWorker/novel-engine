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

/** S5/S6: assess a proposed patch, then apply with a confirm gate. */
export async function assessThenApplyFoundationChange() {
  const store = new MemoryStore();
  const session = await createNovelSession({ store, bookId: "letter" });
  await session.upsertFoundation({
    book: { title: "无主的信", synopsis: "灯塔与潮" },
    premise: "林守捡到一封没有寄信人的信。",
    outline: [{ chapter: 1, title: "风暴之后", summary: "捡到信" }],
    characters: [{ name: "林守", role: "主角" }],
    worldRules: [{ name: "信与潮", description: "涨潮来信" }],
  });
  await session.chapter.saveFinal(1, "林守在风暴后捡到信。");

  const assessment = await session.assessFoundationImpact({
    characters: [{ name: "林深", role: "主角" }],
  });
  const outcome = await session.applyFoundationChange({
    patch: { characters: [{ name: "林深", role: "主角" }] },
    confirmRewrite: assessment.severity === "rewrite_needed",
    rewriteChapters: false,
  });
  return { assessment, outcome };
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
