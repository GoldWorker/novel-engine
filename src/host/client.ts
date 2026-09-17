import type { EngineResult } from "../engine/index.js";
import type {
  EngineCommand,
  EngineHostEvent,
  EngineNotice,
  EngineSnapshot,
  EngineStartCommand,
} from "./protocol.js";
import { ENGINE_PROTOCOL, isEngineNotice } from "./protocol.js";

/**
 * Minimal message-port surface shared by `Worker`, `DedicatedWorkerGlobalScope`,
 * and test fakes. Avoids pulling the DOM lib into this package.
 */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(type: "message", listener: MessageListener): void;
}

export type MessageListener = (event: { data: unknown }) => void;

export interface EngineClient {
  start(input?: { prompt?: string; maxSteps?: number }): Promise<EngineResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  steer(note: string): Promise<void>;
  snapshot(): Promise<EngineSnapshot>;
  onNotice(handler: (notice: EngineNotice) => void): () => void;
  onEvent(handler: (event: EngineHostEvent) => void): () => void;
  close(): void;
}

interface Pending {
  resolve: (notice: EngineNotice) => void;
  reject: (err: Error) => void;
}

/**
 * Main-thread wrapper: posts `start` / `steer` / `pause` / `resume` / `snapshot`
 * and listens for `event` / `snapshot` / `error`.
 */
export function createEngineClient(port: MessagePortLike): EngineClient {
  const pending = new Map<string, Pending>();
  const noticeHandlers = new Set<(notice: EngineNotice) => void>();
  let seq = 0;

  const onMessage: MessageListener = (event) => {
    if (!isEngineNotice(event.data)) {
      return;
    }
    const data = event.data;
    for (const handler of noticeHandlers) {
      handler(data);
    }
    if (data.type === "error" && data.id) {
      const waiter = pending.get(data.id);
      if (waiter) {
        pending.delete(data.id);
        waiter.reject(new Error(data.message));
      }
      return;
    }
    if (data.id) {
      const waiter = pending.get(data.id);
      if (waiter) {
        pending.delete(data.id);
        waiter.resolve(data);
      }
    }
  };

  port.addEventListener("message", onMessage);

  function nextId(): string {
    seq += 1;
    return `c-${seq}`;
  }

  function send(command: EngineCommand): Promise<EngineNotice> {
    return new Promise((resolve, reject) => {
      pending.set(command.id, { resolve, reject });
      port.postMessage(command);
    });
  }

  const client: EngineClient = {
    async start(input = {}) {
      const command: EngineStartCommand = {
        v: ENGINE_PROTOCOL,
        type: "start",
        id: nextId(),
      };
      if (input.prompt !== undefined) {
        command.prompt = input.prompt;
      }
      if (input.maxSteps !== undefined) {
        command.maxSteps = input.maxSteps;
      }
      const notice = await send(command);
      if (notice.type !== "snapshot") {
        throw new Error(`start expected snapshot, got ${notice.type}`);
      }
      if (notice.result == null) {
        throw new Error("start completed without an EngineResult");
      }
      return notice.result;
    },
    async pause() {
      await send({ v: ENGINE_PROTOCOL, type: "pause", id: nextId() });
    },
    async resume() {
      await send({ v: ENGINE_PROTOCOL, type: "resume", id: nextId() });
    },
    async steer(note: string) {
      await send({ v: ENGINE_PROTOCOL, type: "steer", id: nextId(), note });
    },
    async snapshot() {
      const notice = await send({ v: ENGINE_PROTOCOL, type: "snapshot", id: nextId() });
      if (notice.type !== "snapshot") {
        throw new Error(`snapshot expected snapshot, got ${notice.type}`);
      }
      return {
        state: notice.state,
        result: notice.result,
        running: notice.running,
        paused: notice.paused,
      };
    },
    onNotice(handler) {
      noticeHandlers.add(handler);
      return () => {
        noticeHandlers.delete(handler);
      };
    },
    onEvent(handler) {
      return client.onNotice((notice) => {
        if (notice.type === "event") {
          handler(notice.event);
        }
      });
    },
    close() {
      port.removeEventListener("message", onMessage);
      for (const waiter of pending.values()) {
        waiter.reject(new Error("engine client closed"));
      }
      pending.clear();
      noticeHandlers.clear();
    },
  };

  return client;
}
