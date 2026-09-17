/**
 * Scenario 7 — same-thread host session (`novel-engine/session`).
 * 场景 7：同线程宿主 Session（`novel-engine/session`）。
 *
 * S0–S2: inspect foundation, upsert/generate (JSON in LlmPort.complete().text),
 * startAutoWrite, multi-book workspace. No ChapterRunner or Worker bridge (S3–S4).
 * S0–S2：检查基础设定、upsert/generate（JSON 在 complete().text）、
 * startAutoWrite、多书工作区。不含 ChapterRunner / Worker 桥（S3–S4）。
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
