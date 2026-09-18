import type { MessagePortLike } from "../host/client.js";
import { MemoryStore } from "../store/memory.js";
import { createOpfsStore, OpfsStore } from "../store/opfs.js";
import { attachSessionWorker } from "../session/server.js";
import { createNovelSession } from "../session/novel-session.js";
import { createEndpointLlm } from "./llm-endpoint.js";
import {
  isKitInitCommand,
  KIT_NS,
  KIT_PROTOCOL,
  type KitErrorNotice,
  type KitInitCommand,
  type KitNotice,
} from "./protocol.js";
import { bookOpfsDirectory, DEFAULT_OPFS_DIRECTORY } from "./store.js";

export interface AttachKitWorkerHandle {
  detach: () => void;
}

/**
 * Worker-side kit bootstrap: handshake `init`, then the existing session
 * bridge. Used by the shipped `novel-kit.worker.js` and Node fake-port tests.
 */
export function attachKitWorker(port: MessagePortLike): AttachKitWorkerHandle {
  let sessionDetach: (() => void) | null = null;
  let initialized = false;
  let booting = false;

  const onMessage = (event: { data: unknown }): void => {
    void handle(event.data);
  };
  port.addEventListener("message", onMessage);

  function post(notice: KitNotice): void {
    port.postMessage(notice);
  }

  function postError(id: string | undefined, err: unknown): void {
    const name = err instanceof Error && err.name !== "" ? err.name : "Error";
    const message = err instanceof Error ? err.message : String(err);
    const notice: KitErrorNotice = {
      v: KIT_PROTOCOL,
      ns: KIT_NS,
      type: "error",
      name,
      message,
    };
    if (id !== undefined) {
      notice.id = id;
    }
    post(notice);
  }

  async function handle(data: unknown): Promise<void> {
    if (initialized) {
      return;
    }
    if (!isKitInitCommand(data)) {
      postError(undefined, new Error("kit worker is not initialized; send init first"));
      return;
    }
    if (booting) {
      postError(data.id, new Error("kit worker already initialized"));
      return;
    }
    booting = true;
    try {
      await bootstrap(data);
      initialized = true;
    } catch (err) {
      booting = false;
      postError(data.id, err);
    }
  }

  async function bootstrap(cmd: KitInitCommand): Promise<void> {
    const bookId = cmd.bookId.trim();
    if (bookId === "") {
      throw new Error("bookId must be a non-empty string");
    }
    const store =
      cmd.store === "memory"
        ? new MemoryStore()
        : await createOpfsStore({
            directory: cmd.opfsDirectory ?? bookOpfsDirectory(DEFAULT_OPFS_DIRECTORY, bookId),
            fallbackToMemory: cmd.fallbackToMemory,
          });
    const storeKind = store instanceof OpfsStore ? "opfs" : "memory";
    const llm = createEndpointLlm(cmd.llmEndpoint);
    port.removeEventListener("message", onMessage);
    const attached = attachSessionWorker(port, {
      createSession: () => createNovelSession({ store, llm, bookId }),
    });
    sessionDetach = attached.detach;
    post({
      v: KIT_PROTOCOL,
      ns: KIT_NS,
      type: "ready",
      id: cmd.id,
      bookId,
      storeKind,
    });
  }

  return {
    detach() {
      port.removeEventListener("message", onMessage);
      sessionDetach?.();
      sessionDetach = null;
    },
  };
}
