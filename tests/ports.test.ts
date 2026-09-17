import { describe, expect, it } from "vitest";
import type {
  LlmPort,
  Progress,
  State,
  StorePort,
} from "../src/index.js";

describe("ports (compile-time contracts)", () => {
  it("StorePort and LlmPort can be satisfied by mock adapters", async () => {
    const progress: Progress = {
      phase: "init",
      flow: "writing",
      totalChapters: 0,
      completedChapters: [],
      pendingRewrites: [],
      layered: false,
    };

    const files = new Map<string, Uint8Array>();
    const store: StorePort = {
      async loadState(): Promise<State> {
        return { progress };
      },
      async loadProgress() {
        return progress;
      },
      async saveProgress() {},
      async read(path) {
        return files.get(path)?.slice() ?? null;
      },
      async write(path, data) {
        files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data.slice());
      },
      async has(path) {
        return files.has(path);
      },
    };

    const llm: LlmPort = {
      async complete() {
        return { text: "mock" };
      },
    };

    const state = await store.loadState();
    expect(state.progress?.phase).toBe("init");
    expect((await llm.complete({ messages: [{ role: "user", content: "hi" }] })).text).toBe(
      "mock",
    );
  });
});
