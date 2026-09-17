/**
 * Scenario 8 — Session over a dedicated Worker (worker thread).
 * 场景 8：Worker 上的 Session（Worker 线程）。与 `session-host.ts` 配对。
 *
 * Import `attachSessionWorker` from `novel-engine/session` (not
 * `novel-engine/worker`) so the default Engine worker bundle stays session-free.
 * Same-thread `NovelSession` is the source of truth; this file only adapts it.
 *
 * LlmPort must `fetch` a host BFF (or similar). Do not embed vendor API keys
 * in a public worker bundle.
 */

/// <reference lib="webworker" />

import { createOpfsStore, type LlmPort, type MessagePortLike } from "novel-engine/worker";
import { attachSessionWorker, createNovelSession } from "novel-engine/session";

const llm: LlmPort = {
  async complete(request) {
    // Workbench: POST to your Next.js/BFF `/api/llm`. Never put sk- keys here.
    const response = await fetch("/api/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`BFF llm ${response.status}`);
    }
    return (await response.json()) as Awaited<ReturnType<LlmPort["complete"]>>;
  },
};

attachSessionWorker(self as MessagePortLike, {
  async createSession() {
    const store = await createOpfsStore();
    return createNovelSession({ store, llm, bookId: "letter" });
  },
});
