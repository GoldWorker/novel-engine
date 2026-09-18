/**
 * Optional host façade (`novel-engine/kit`).
 *
 * Out-of-the-box path: `NovelKit.create` (no `new` + `init`), shipped worker
 * at `novel-engine/kit/worker`, defaults OPFS + Worker. Session remains the
 * reference implementation — Kit only composes it.
 *
 * Not part of the default `novel-engine` / `novel-engine/worker` /
 * `novel-engine/llm` / `novel-engine/session` bundles.
 */
export { NovelKit } from "./novel-kit.js";
export type {
  KitOpfsOptions,
  KitRuntime,
  KitStoreKind,
  KitStoreOption,
  NovelKitOptions,
} from "./types.js";
export {
  KitClosedError,
  KitLlmRequiredError,
  KitWorkerError,
  KitWorkspaceDisabledError,
} from "./errors.js";
export {
  KIT_NS,
  KIT_PROTOCOL,
  isKitInitCommand,
  isKitNotice,
} from "./protocol.js";
export type {
  KitCommand,
  KitErrorNotice,
  KitInitCommand,
  KitNotice,
  KitReadyNotice,
  KitStoreName,
} from "./protocol.js";
export { defaultKitWorkerUrl } from "./worker-url.js";
export { attachKitWorker } from "./worker-runtime.js";
export type { AttachKitWorkerHandle } from "./worker-runtime.js";
