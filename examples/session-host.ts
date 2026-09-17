/**
 * Scenario 8 — Session over a dedicated Worker (main thread).
 * 场景 8：Worker 上的 Session（主线程）。与 `session.worker.ts` 配对。
 *
 * Workbench should keep auto-write / chapter.write off the UI thread:
 *   new Worker(session.worker.ts) → createSessionClient(worker)
 *
 * Protocol (`SESSION_PROTOCOL === 1`, `ns: "session"`):
 *   main → worker:  inspectFoundation | getFoundation | upsertFoundation |
 *                   generateFoundation | startAutoWrite | chapterGet |
 *                   chapterSaveFinal | chapterWrite | …
 *   worker → main:  result | event | error
 *
 * Busy (`SessionBusyError`) is enforced on the worker-side NovelSession.
 */

/// <reference lib="dom" />

import { createSessionClient, SESSION_PROTOCOL } from "novel-engine/session";

export function connectSession(workerUrl: URL, bookId = "letter") {
  const worker = new Worker(workerUrl, { type: "module" });
  const session = createSessionClient(worker, { bookId });
  session.subscribe((event) => {
    console.log(event.type, event);
  });
  return { worker, session };
}

export async function demoSessionHost(): Promise<void> {
  const { session } = connectSession(new URL("./session.worker.ts", import.meta.url));
  const inspected = await session.inspectFoundation({ prompt: "写一本三章短篇" });
  await session.upsertFoundation({ book: { title: "无主的信", synopsis: "灯塔与潮" } });
  const outcome = await session.startAutoWrite({
    prompt: "写一本三章短篇：……",
    generateMissing: true,
    requireConfirmGaps: true,
  });
  console.log(inspected.readyToWrite, outcome.status, SESSION_PROTOCOL);
  session.close();
}

void demoSessionHost();
