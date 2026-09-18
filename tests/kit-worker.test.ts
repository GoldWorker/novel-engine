import { afterEach, describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import { ENGINE_PROTOCOL } from "../src/index.js";
import { connectKitWorker } from "../src/kit/connect-worker.js";
import {
  KIT_NS,
  KIT_PROTOCOL,
  attachKitWorker,
  isKitInitCommand,
  isKitNotice,
} from "../src/kit/index.js";
import { createLinkedMessagePorts } from "./helpers/fake-ports.js";
import type { ShortBookFixture } from "./helpers/short-book-llm.js";

const short = shortBook as unknown as ShortBookFixture;

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

describe("kit worker init protocol", () => {
  it("accepts kit init / notice discriminators and rejects session/engine envelopes", () => {
    expect(
      isKitInitCommand({
        v: KIT_PROTOCOL,
        ns: KIT_NS,
        type: "init",
        id: "kit-init-1",
        bookId: "letter",
        llmEndpoint: "/api/llm",
        store: "memory",
        fallbackToMemory: true,
      }),
    ).toBe(true);
    expect(
      isKitInitCommand({
        v: KIT_PROTOCOL,
        ns: "session",
        type: "init",
        id: "kit-init-1",
        bookId: "letter",
        llmEndpoint: "/api/llm",
        store: "memory",
        fallbackToMemory: true,
      }),
    ).toBe(false);
    expect(isKitNotice({ v: ENGINE_PROTOCOL, type: "error", message: "nope" })).toBe(false);
    expect(
      isKitNotice({
        v: KIT_PROTOCOL,
        ns: KIT_NS,
        type: "ready",
        id: "kit-init-1",
        bookId: "letter",
        storeKind: "memory",
      }),
    ).toBe(true);
  });

  it("errors before init, then inspect + fill round-trip after handshake", async () => {
    const { host, worker } = createLinkedMessagePorts();
    const notices: unknown[] = [];
    host.addEventListener("message", (event) => {
      notices.push(event.data);
    });
    const attached = attachKitWorker(worker);
    host.postMessage({ type: "nope" });
    await waitFor(() => notices.length > 0);
    expect(isKitNotice(notices[0])).toBe(true);
    expect(notices[0]).toMatchObject({
      type: "error",
      message: "kit worker is not initialized; send init first",
    });

    const connected = await connectKitWorker({
      port: host,
      bookId: "letter",
      llmEndpoint: "/api/llm",
      store: "memory",
      fallbackToMemory: true,
    });
    expect(connected.storeKind).toBe("memory");
    expect(connected.session.bookId).toBe("letter");

    const empty = await connected.session.inspectFoundation({ prompt: "写一本三章短篇" });
    expect(empty.readyToWrite).toBe(false);
    expect(empty.gaps.map((gap) => gap.key)).toContain("book");

    await connected.session.upsertFoundation({
      book: short.book,
      premise: short.premise,
    });
    const meta = await connected.session.getFoundation();
    expect(meta.book).toEqual(short.book);
    expect(meta.premise).toBe(short.premise);

    connected.session.close();
    attached.detach();
  });

  it("worker LlmPort.complete fetch(llmEndpoint) — generateFoundation uses BFF JSON", async () => {
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    const calls: { url: string; body: string }[] = [];
    const g = globalThis as unknown as {
      fetch: (
        url: string,
        init?: { body?: string },
      ) => Promise<{
        ok: boolean;
        status: number;
        statusText: string;
        text(): Promise<string>;
      }>;
    };
    g.fetch = async (url, init) => {
      calls.push({ url: String(url), body: init?.body ?? "" });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            text: JSON.stringify({
              outline: short.outline,
              characters: short.characters,
              world_rules: short.world_rules,
            }),
          });
        },
      };
    };

    try {
      const { host, worker } = createLinkedMessagePorts();
      const attached = attachKitWorker(worker);
      const connected = await connectKitWorker({
        port: host,
        bookId: "letter",
        llmEndpoint: "/api/llm",
        store: "memory",
        fallbackToMemory: true,
      });
      await connected.session.upsertFoundation({ book: short.book, premise: short.premise });
      const meta = await connected.session.generateFoundation({
        prompt: short.prompt,
        keys: ["outline", "characters", "world_rules"],
        mode: "fill_missing",
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("/api/llm");
      expect(meta.outline).toEqual(short.outline);
      expect(meta.characters).toEqual(short.characters);
      connected.session.close();
      attached.detach();
    } finally {
      if (originalFetch === undefined) {
        delete (globalThis as { fetch?: unknown }).fetch;
      } else {
        (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
      }
    }
  });

  it("pause / steer / resume during startAutoWrite after kit init", async () => {
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const g = globalThis as unknown as {
      fetch: () => Promise<{
        ok: boolean;
        status: number;
        statusText: string;
        text(): Promise<string>;
      }>;
    };
    g.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({ text: "noop" });
        },
      };
    };

    try {
      const { host, worker } = createLinkedMessagePorts();
      const attached = attachKitWorker(worker);
      const connected = await connectKitWorker({
        port: host,
        bookId: "ctrl",
        llmEndpoint: "/api/llm",
        store: "memory",
        fallbackToMemory: true,
      });
      await connected.session.upsertFoundation({
        book: short.book,
        premise: short.premise,
        outline: short.outline,
        characters: short.characters,
        worldRules: short.world_rules,
      });

      const events: string[] = [];
      connected.session.subscribe((event) => {
        events.push(event.type);
      });

      const pending = connected.session.startAutoWrite({
        prompt: short.prompt,
        confirmAuditGap: true,
        maxSteps: 6,
      });
      await waitFor(() => calls > 0);
      expect(await connected.session.pause()).toEqual({ status: "ok" });
      expect(await connected.session.steer("往和解写")).toEqual({ status: "ok" });
      release();
      await waitFor(() => events.includes("paused"));
      expect(await connected.session.resume()).toEqual({ status: "ok" });
      await pending;
      expect(await connected.session.pause()).toEqual({ status: "idle" });

      connected.session.close();
      attached.detach();
    } finally {
      if (originalFetch === undefined) {
        delete (globalThis as { fetch?: unknown }).fetch;
      } else {
        (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
      }
    }
  });

  it("kit llmEndpoint HTTP errors throw LlmError with status", async () => {
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    const g = globalThis as unknown as {
      fetch: () => Promise<{
        ok: boolean;
        status: number;
        statusText: string;
        text(): Promise<string>;
      }>;
    };
    g.fetch = async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      async text() {
        return "upstream down";
      },
    });

    try {
      const { host, worker } = createLinkedMessagePorts();
      const attached = attachKitWorker(worker);
      const connected = await connectKitWorker({
        port: host,
        bookId: "letter",
        llmEndpoint: "/api/llm",
        store: "memory",
        fallbackToMemory: true,
      });
      await expect(
        connected.session.generateFoundation({
          prompt: short.prompt,
          keys: ["premise"],
        }),
      ).rejects.toMatchObject({ name: "LlmError", status: 503 });
      expect(await connected.session.getRunState()).toBe("idle");
      expect(await connected.session.cancel()).toEqual({ status: "idle" });
      connected.session.close();
      attached.detach();
    } finally {
      if (originalFetch === undefined) {
        delete (globalThis as { fetch?: unknown }).fetch;
      } else {
        (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
      }
    }
  });
});
