/**
 * Shipped kit worker (`novel-engine/kit/worker` → `dist/novel-kit.worker.js`).
 *
 * Dedicated Worker entry: waits for a kit `init` handshake, then attaches
 * the existing session bridge. Do not import this from the UI thread — pass
 * the URL to `new Worker(..., { type: "module" })` or let `NovelKit.create`
 * resolve it.
 */
import type { MessagePortLike } from "../host/client.js";
import { attachKitWorker } from "./worker-runtime.js";

export { attachKitWorker } from "./worker-runtime.js";
export type { AttachKitWorkerHandle } from "./worker-runtime.js";
export {
  KIT_NS,
  KIT_PROTOCOL,
  isKitInitCommand,
  isKitNotice,
} from "./protocol.js";

function isDedicatedWorkerScope(value: unknown): value is MessagePortLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as {
    postMessage?: unknown;
    importScripts?: unknown;
    document?: unknown;
  };
  return (
    typeof rec.postMessage === "function" &&
    typeof rec.importScripts === "function" &&
    rec.document === undefined
  );
}

if (isDedicatedWorkerScope(globalThis)) {
  attachKitWorker(globalThis as unknown as MessagePortLike);
}
