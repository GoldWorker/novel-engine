/**
 * Scenario 8 — Session over a dedicated Worker (main thread).
 * 场景 8：Worker 上的 Session（主线程）。与 `session.worker.ts` 配对。
 *
 * Workbench should keep auto-write / chapter.write off the UI thread:
 *   new Worker(session.worker.ts) → createSessionClient(worker)
 *
 * Protocol (`SESSION_PROTOCOL === 1`, `ns: "session"`):
 *   main → worker:  inspectFoundation | getFoundation | upsertFoundation |
 *                   generateFoundation | assessFoundationImpact |
 *                   applyFoundationChange | startAutoWrite | pause | resume |
 *                   steer | cancel | getRunState | chapterGet |
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

/** 8.1 — two-step applyFoundationChange confirm gate over createSessionClient. */
export async function demoAssessApplyOnWorker(): Promise<void> {
  const { session } = connectSession(new URL("./session.worker.ts", import.meta.url));
  const patch = { characters: [{ name: "林深", role: "主角" }] }; // whole-file replace
  const assessment = await session.assessFoundationImpact(patch);
  // assessment.severity / suggestedChapters / suggestedMode / reasons — UI thread, no write

  let outcome = await session.applyFoundationChange({ patch });
  if (outcome.status === "needs_confirm") {
    // show outcome.assessment.reasons — store unchanged
    outcome = await session.applyFoundationChange({
      patch,
      confirmRewrite: true,
      rewriteChapters: false, // host opt-in on the worker too; never auto-rewrite
    });
  }
  console.log(assessment.severity, outcome.status, SESSION_PROTOCOL);
  session.close();
}

void demoSessionHost();
