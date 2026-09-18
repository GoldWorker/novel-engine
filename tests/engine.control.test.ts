import { describe, expect, it } from "vitest";
import {
  createEngine,
  AbortedError,
  EngineError,
  MemoryStore,
  MockLlm,
  PATHS,
  readJson,
  type RunMeta,
} from "../src/index.js";

const writingProgress = {
  phase: "writing" as const,
  flow: "writing" as const,
  totalChapters: 3,
  completedChapters: [1],
  pendingRewrites: [],
  layered: false,
};

describe("Engine pause / resume / steer", () => {
  it("yields at the next loop boundary then continues", async () => {
    const store = new MemoryStore();
    await store.saveProgress({
      phase: "init",
      flow: "writing",
      totalChapters: 0,
      completedChapters: [],
      pendingRewrites: [],
      layered: false,
    });
    const llm = MockLlm.fromHandler(() => ({ text: "noop" }));
    const events: string[] = [];
    const engine = createEngine({
      store,
      llm,
      maxSteps: 20,
      onEvent: (event) => {
        events.push(event.type);
        if (event.type === "step" && event.step === 1) {
          engine.pause();
        }
      },
    });

    const running = engine.run({ prompt: "短篇" });
    await waitFor(() => events.includes("paused"));
    expect(engine.isPaused).toBe(true);
    expect(engine.isRunning).toBe(true);

    await engine.resume();
    const result = await running;
    expect(events).toContain("resumed");
    expect(result.stoppedReason).toBe("paused");
    expect(result.error).toMatch(/deadlock/);
  });

  it("steer sets flow=steering and resume restores the previous flow", async () => {
    const store = new MemoryStore();
    await store.saveProgress(writingProgress);
    const engine = createEngine({
      store,
      llm: MockLlm.fromHandler(() => ({ text: "noop" })),
    });

    await engine.steer("把结局改成和解");
    expect((await store.loadProgress())?.flow).toBe("steering");
    const meta = await readJson<RunMeta>(store, PATHS.runMeta);
    expect(meta?.pendingSteer?.note).toBe("把结局改成和解");
    expect(meta?.pendingSteer?.previousFlow).toBe("writing");

    await engine.resume();
    expect((await store.loadProgress())?.flow).toBe("writing");
    expect((await readJson<RunMeta>(store, PATHS.runMeta))?.pendingSteer).toBeUndefined();
  });

  it("rejects an empty steer note and a nested run() on the same instance", async () => {
    const store = new MemoryStore();
    await store.saveProgress(writingProgress);
    const engine = createEngine({
      store,
      llm: MockLlm.fromHandler(() => ({ text: "noop" })),
    });
    await expect(engine.steer("  ")).rejects.toBeInstanceOf(EngineError);

    engine.pause();
    const running = engine.run({ prompt: "短篇" });
    await waitFor(() => engine.isRunning);
    await expect(engine.run()).rejects.toThrow(/already running/);
    await engine.resume();
    await running;
  });

  it("cancel() aborts an in-flight run with AbortedError; idle cancel is a no-op", async () => {
    const store = new MemoryStore();
    await store.saveProgress({
      phase: "init",
      flow: "writing",
      totalChapters: 0,
      completedChapters: [],
      pendingRewrites: [],
      layered: false,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm = MockLlm.fromHandler(async () => {
      await gate;
      return { text: "noop" };
    });
    const engine = createEngine({ store, llm, maxSteps: 8 });
    engine.cancel();
    expect(engine.isRunning).toBe(false);

    const running = engine.run({ prompt: "短篇" });
    await waitFor(() => llm.callCount > 0);
    engine.cancel();
    await expect(running).rejects.toBeInstanceOf(AbortedError);
    expect(engine.isRunning).toBe(false);
    release();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 5);
    });
  }
}
