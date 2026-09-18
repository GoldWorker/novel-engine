import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import type { OpfsDirectoryHandle, OpfsStorageManager } from "../store/opfs-handles.js";

/** Persistence backend reported on a live kit instance. */
export type KitStoreKind = "opfs" | "memory" | "custom";

/** Where Session/Engine run. Default `"worker"`. */
export type KitRuntime = "worker" | "main";

/** Named stores plus an injected `StorePort` (`storeKind: "custom"`). */
export type KitStoreOption = "opfs" | "memory" | StorePort;

export interface KitOpfsOptions {
  /**
   * OPFS subdirectory (default `"novel-engine"`). Per-book stores use
   * `${directory}/${bookId}`; the workspace index lives at `${directory}`.
   */
  directory?: string;
  /** Injected directory handle — `runtime: "main"` only. */
  root?: OpfsDirectoryHandle;
  /** Injected `navigator.storage` — `runtime: "main"` only. */
  storage?: OpfsStorageManager;
}

export interface NovelKitOptions {
  /**
   * `"worker"` (default) runs Session off the UI thread via the shipped
   * `novel-kit.worker.js`. `"main"` is same-thread (Node/tests).
   */
  runtime?: KitRuntime;
  /**
   * `"opfs"` (default) or `"memory"`. Pass a `StorePort` for `storeKind: "custom"`
   * (`runtime: "main"` only).
   */
  store?: KitStoreOption;
  /**
   * Required when `runtime: "main"`. Ignored in worker mode — the worker
   * always `fetch`es `llmEndpoint` (no API keys in the worker).
   */
  llm?: LlmPort;
  /**
   * Worker `LlmPort.complete` posts JSON to this URL. Default `"/api/llm"`.
   * Unused on `runtime: "main"`.
   */
  llmEndpoint?: string;
  /** Current book id. Default `"default"`. */
  bookId?: string;
  /**
   * Override the shipped worker module URL. Default is
   * `new URL("./novel-kit.worker.js", import.meta.url)` relative to `dist/kit.js`.
   */
  workerUrl?: string | URL;
  /**
   * Multi-book APIs (`createBook` / `switchBook` / `listBooks`). Default `true`.
   * When `false`, those methods throw.
   */
  workspace?: boolean;
  /**
   * When OPFS is missing or `getDirectory()` fails, use `MemoryStore`.
   * Default `true`. Set `false` to throw `OpfsUnavailableError`.
   */
  fallbackToMemory?: boolean;
  /** OPFS directory / injected handles. */
  opfs?: KitOpfsOptions;
}
