import type { MessageListener, MessagePortLike } from "../../src/host/client.js";

/**
 * Two MessagePortLike ends that forward `postMessage` via `queueMicrotask`,
 * approximating a Dedicated Worker without a real Worker thread.
 */
export function createLinkedMessagePorts(): {
  host: MessagePortLike;
  worker: MessagePortLike;
} {
  const hostListeners = new Set<MessageListener>();
  const workerListeners = new Set<MessageListener>();

  function deliver(listeners: Set<MessageListener>, data: unknown): void {
    queueMicrotask(() => {
      for (const listener of [...listeners]) {
        listener({ data });
      }
    });
  }

  const host: MessagePortLike = {
    postMessage(message) {
      deliver(workerListeners, message);
    },
    addEventListener(_type, listener) {
      hostListeners.add(listener);
    },
    removeEventListener(_type, listener) {
      hostListeners.delete(listener);
    },
  };

  const worker: MessagePortLike = {
    postMessage(message) {
      deliver(hostListeners, message);
    },
    addEventListener(_type, listener) {
      workerListeners.add(listener);
    },
    removeEventListener(_type, listener) {
      workerListeners.delete(listener);
    },
  };

  return { host, worker };
}
