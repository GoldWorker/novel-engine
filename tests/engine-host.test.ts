import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  createEngineClient,
  ENGINE_PROTOCOL,
  isEngineCommand,
  isEngineNotice,
  MemoryStore,
  MockLlm,
  readText,
} from "../src/index.js";
import { attachEngineWorker } from "../src/worker.js";
import { shortBookLlmHandler, type ShortBookFixture } from "./helpers/short-book-llm.js";
import { createLinkedMessagePorts } from "./helpers/fake-ports.js";

const book = shortBook as ShortBookFixture;

describe("engine host protocol", () => {
  it("accepts the documented command / notice discriminators", () => {
    expect(
      isEngineCommand({ v: ENGINE_PROTOCOL, type: "start", id: "c-1", prompt: "hi" }),
    ).toBe(true);
    expect(isEngineCommand({ v: ENGINE_PROTOCOL, type: "steer", id: "c-2", note: "n" })).toBe(
      true,
    );
    expect(isEngineCommand({ v: ENGINE_PROTOCOL, type: "pause", id: "c-3" })).toBe(true);
    expect(isEngineCommand({ v: ENGINE_PROTOCOL, type: "resume", id: "c-4" })).toBe(true);
    expect(isEngineCommand({ v: ENGINE_PROTOCOL, type: "snapshot", id: "c-5" })).toBe(true);
    expect(isEngineCommand({ type: "start" })).toBe(false);

    expect(
      isEngineNotice({
        v: ENGINE_PROTOCOL,
        type: "event",
        event: { kind: "paused" },
      }),
    ).toBe(true);
    expect(
      isEngineNotice({
        v: ENGINE_PROTOCOL,
        type: "snapshot",
        state: {},
        result: null,
        running: false,
        paused: false,
      }),
    ).toBe(true);
    expect(
      isEngineNotice({ v: ENGINE_PROTOCOL, type: "error", id: "c-1", message: "nope" }),
    ).toBe(true);
    expect(isEngineNotice({ type: "error", message: "nope" })).toBe(false);
  });

  it("rejects a second start while the engine is running", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    let release!: (value: { text: string }) => void;
    const hang = new Promise<{ text: string }>((resolve) => {
      release = resolve;
    });
    const llm = MockLlm.fromHandler(() => hang);
    const attached = attachEngineWorker(worker, {
      createPorts: () => ({ store, llm, maxSteps: 20 }),
    });
    const client = createEngineClient(host);
    const kinds: string[] = [];
    client.onEvent((event) => {
      kinds.push(event.kind);
    });
    const first = client.start({ prompt: book.prompt });
    await waitFor(() => kinds.includes("started") || kinds.includes("step"));
    await expect(client.start({ prompt: "again" })).rejects.toThrow(/already running/);
    release({ text: "noop" });
    const result = await first;
    expect(result.stoppedReason).toBe("paused");
    client.close();
    attached.detach();
  });

  it("pause / resume / steer / snapshot round-trip on a fake port", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: 3,
      completedChapters: [1],
      pendingRewrites: [],
      layered: false,
    });
    const attached = attachEngineWorker(worker, {
      createPorts: () => ({
        store,
        llm: MockLlm.fromHandler(() => ({ text: "noop" })),
      }),
    });
    const client = createEngineClient(host);
    const kinds: string[] = [];
    client.onEvent((event) => {
      kinds.push(event.kind);
    });

    await client.steer("改结局");
    expect(kinds).toContain("steered");
    expect((await store.loadProgress())?.flow).toBe("steering");

    await client.pause();
    expect(kinds).toContain("paused");

    const snap = await client.snapshot();
    expect(snap.paused).toBe(true);
    expect(snap.state.progress?.flow).toBe("steering");

    await client.resume();
    expect(kinds).toContain("resumed");
    expect((await store.loadProgress())?.flow).toBe("writing");

    client.close();
    attached.detach();
  });

  it("posts error for an invalid command", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const notices: unknown[] = [];
    host.addEventListener("message", (event) => {
      notices.push(event.data);
    });
    const attached = attachEngineWorker(worker, {
      createPorts: () => ({
        store: new MemoryStore(),
        llm: MockLlm.fromHandler(() => ({ text: "x" })),
      }),
    });
    host.postMessage({ type: "nope" });
    await waitFor(() => notices.length > 0);
    expect(isEngineNotice(notices[0])).toBe(true);
    expect(notices[0]).toMatchObject({ type: "error", message: "invalid engine command" });
    attached.detach();
  });

  it("runs the short-book mock through the worker protocol", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const store = new MemoryStore();
    const llm = MockLlm.fromHandler(shortBookLlmHandler(book));
    const attached = attachEngineWorker(worker, {
      createPorts: () => ({ store, llm, maxSteps: 20 }),
    });
    const client = createEngineClient(host);

    const result = await client.start({ prompt: book.prompt, maxSteps: 20 });
    expect(result.stoppedReason).toBe("complete");
    expect(result.phase).toBe("complete");
    expect(await readText(store, "chapters/01.md")).toContain("蜡封的瓶子");

    const snap = await client.snapshot();
    expect(snap.state.progress?.phase).toBe("complete");
    expect(snap.running).toBe(false);

    client.close();
    attached.detach();
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
