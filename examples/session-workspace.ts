/**
 * Scenario 7 — same-thread host session (`novel-engine/session`).
 * 场景 7：同线程宿主 Session（`novel-engine/session`）。
 *
 * S0+S1: inspect foundation + multi-book workspace. No generateFoundation,
 * ChapterRunner, or Worker session bridge (S2–S4).
 * S0+S1：检查基础设定 + 多书工作区。不含 generateFoundation / ChapterRunner / Worker 桥（S2–S4）。
 */

import { MemoryStore, PATHS, writeJson, writeText } from "novel-engine";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";

export async function inspectExistingStore() {
  const store = new MemoryStore();
  const session = await createNovelSession({ store, bookId: "letter" });
  await writeJson(store, PATHS.book, { title: "无主的信", synopsis: "灯塔与潮" });
  await writeText(store, PATHS.premise, "林守捡到一封没有寄信人的信。");
  return session.inspectFoundation({ prompt: "写一本三章短篇" });
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
