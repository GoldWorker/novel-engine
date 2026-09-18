/**
 * Scenario 0 — NovelKit out-of-the-box host (main thread).
 * 场景 0：NovelKit 开箱宿主（主线程）。Worker 脚本由包装箱提供，宿主不必自备。
 *
 * Defaults: store "opfs", runtime "worker", workspace true, bookId "default",
 * llmEndpoint "/api/llm". Node/tests opt out with runtime "main" + store "memory".
 */

import { NovelKit } from "novel-engine/kit";
import { MockLlm } from "novel-engine";

/** Browser workbench: shipped worker + BFF. No API keys in the worker. */
export async function demoKitBrowser(): Promise<void> {
  const kit = await NovelKit.create({
    llmEndpoint: "/api/llm",
    // workerUrl: new URL("/novel-kit.worker.js", import.meta.url), // public/ copy fallback
  });
  const inspected = await kit.inspect({ prompt: "写一本三章短篇" });
  console.log(kit.runtime, kit.storeKind, kit.bookId, inspected.readyToWrite);
  kit.dispose();
}

/** Node / unit tests: same-thread MemoryStore + MockLlm. */
export async function demoKitNode(): Promise<void> {
  const kit = await NovelKit.create({
    runtime: "main",
    store: "memory",
    llm: new MockLlm([{ text: JSON.stringify({ premise: "……" }) }]),
    bookId: "letter",
  });
  await kit.fillFoundation({ book: { title: "无主的信", synopsis: "灯塔与潮" } });
  let outcome = await kit.startBook({
    prompt: "写一本三章短篇：……",
    generateMissing: true,
  });
  if (outcome.status === "needs_foundation" && outcome.auditOnly) {
    outcome = await kit.startBook({
      prompt: "写一本三章短篇：……",
      confirmAuditGap: true,
    });
  }
  console.log(outcome.status);
  kit.subscribe((event) => {
    if (event.type === "paused" || event.type === "resumed" || event.type === "steered") {
      console.log(event.type);
    }
  });
  await kit.pauseBook(); // { status: "idle" } when startBook is not running
  console.log(await kit.getRunState()); // "idle"
  await kit.cancelBook(); // no-op when idle
  kit.dispose();
}
