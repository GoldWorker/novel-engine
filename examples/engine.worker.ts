/**
 * Scenario 4 — embed in a Web Worker (worker thread). Pair with `worker-host.ts`.
 * 场景 4：嵌入 Web Worker（Worker 线程）。与 `worker-host.ts` 配对。
 *
 * Dedicated Worker entry — import from `novel-engine/worker` so the main-thread
 * client is tree-shaken out of this bundle.
 *
 * 专用 Worker 入口。宿主在此注入 `LlmPort`（本库不附带真实模型客户端）。
 *
 * Host-owned file. Point `new Worker(new URL("./engine.worker.ts", import.meta.url))`
 * at this module (see `worker-host.ts`).
 */

/// <reference lib="webworker" />

import {
  attachEngineWorker,
  createOpfsStore,
  type LlmPort,
  type MessagePortLike,
} from "novel-engine/worker";

const llm: LlmPort = {
  async complete() {
    // Replace with a gateway / WebLLM adapter. MockLlm.fromHandler also works
    // (see examples/short-book.ts) — this package never ships a provider client.
    return { text: "", toolCalls: [] };
  },
};

attachEngineWorker(self as MessagePortLike, {
  async createPorts() {
    const store = await createOpfsStore();
    return { store, llm, maxSteps: 40 };
  },
});
