import type { MessageListener, MessagePortLike } from "../host/client.js";
import { createSessionClient, type SessionClient } from "../session/client.js";
import { KitWorkerError } from "./errors.js";
import {
  isKitNotice,
  KIT_NS,
  KIT_PROTOCOL,
  type KitInitCommand,
  type KitReadyNotice,
  type KitStoreName,
} from "./protocol.js";
import type { KitStoreKind } from "./types.js";
import { defaultKitWorkerUrl } from "./worker-url.js";

export type KitWorkerPort = MessagePortLike & {
  terminate?: () => void;
};

export interface ConnectKitWorkerOptions {
  bookId: string;
  llmEndpoint: string;
  store: KitStoreName;
  fallbackToMemory: boolean;
  opfsDirectory?: string;
  workerUrl?: string | URL;
  /** Tests inject a fake port instead of `new Worker`. */
  port?: KitWorkerPort;
}

export interface ConnectedKitWorker {
  session: SessionClient;
  worker: KitWorkerPort;
  storeKind: Exclude<KitStoreKind, "custom">;
}

export function spawnKitWorker(url: string | URL): KitWorkerPort {
  const WorkerCtor = (
    globalThis as {
      Worker?: new (scriptURL: string | URL, options?: { type?: string }) => KitWorkerPort;
    }
  ).Worker;
  if (typeof WorkerCtor !== "function") {
    throw new KitWorkerError(
      'Worker is not available. Use NovelKit.create({ runtime: "main", store: "memory" }) in Node/tests, or pass workerUrl in a browser.',
    );
  }
  return new WorkerCtor(url, { type: "module" });
}

export async function connectKitWorker(
  options: ConnectKitWorkerOptions,
): Promise<ConnectedKitWorker> {
  const worker =
    options.port ?? spawnKitWorker(options.workerUrl ?? defaultKitWorkerUrl());
  const id = nextInitId();
  const ready = waitForKitReady(worker, id);
  const command: KitInitCommand = {
    v: KIT_PROTOCOL,
    ns: KIT_NS,
    type: "init",
    id,
    bookId: options.bookId,
    llmEndpoint: options.llmEndpoint,
    store: options.store,
    fallbackToMemory: options.fallbackToMemory,
  };
  if (options.opfsDirectory !== undefined) {
    command.opfsDirectory = options.opfsDirectory;
  }
  worker.postMessage(command);
  const notice = await ready;
  const session = createSessionClient(worker, { bookId: options.bookId });
  return { session, worker, storeKind: notice.storeKind };
}

export function terminateKitWorker(worker: KitWorkerPort): void {
  try {
    worker.terminate?.();
  } catch {
    // Worker may already be gone.
  }
}

let initSeq = 0;

function nextInitId(): string {
  initSeq += 1;
  return `kit-init-${initSeq}`;
}

function waitForKitReady(
  port: MessagePortLike,
  id: string,
  timeoutMs = 15_000,
): Promise<KitReadyNotice> {
  return new Promise((resolve, reject) => {
    let settled = false;
    setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup();
      reject(new KitWorkerError("timed out waiting for kit worker init"));
    }, timeoutMs);
    const onMessage: MessageListener = (event) => {
      if (!isKitNotice(event.data)) {
        return;
      }
      const data = event.data;
      if (data.type === "error" && (data.id === id || data.id === undefined)) {
        cleanup();
        reject(new KitWorkerError(data.message));
        return;
      }
      if (data.type === "ready" && data.id === id) {
        cleanup();
        resolve(data);
      }
    };
    function cleanup(): void {
      settled = true;
      port.removeEventListener("message", onMessage);
    }
    port.addEventListener("message", onMessage);
  });
}
