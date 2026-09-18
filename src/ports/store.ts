import type { Progress } from "../domain/progress.js";
import type { State } from "../flow/state.js";

/**
 * Persistence port. Hosts inject an implementation (memory, OPFS, IndexedDB,
 * or Node fs *outside* this library). All IO belongs in the adapter; `route` stays pure.
 *
 * Phase 1 adds a path-keyed artifact map so Engine / tools can persist Progress,
 * foundation, drafts, checkpoints, and decisions without a filesystem.
 */
export interface StorePort {
  /** Load every fact `route` needs. Adapters perform IO; Route never does. */
  loadState(): Promise<State>;
  loadProgress(): Promise<Progress | null>;
  saveProgress(progress: Progress): Promise<void>;
  /** Read a stored artifact. Missing paths return `null`. */
  read(path: string): Promise<Uint8Array | null>;
  /** Write bytes or UTF-8 text to a logical path. */
  write(path: string, data: Uint8Array | string): Promise<void>;
  has(path: string): Promise<boolean>;
  /**
   * Optional path listing. `MemoryStore` and `OpfsStore` implement this so
   * `exportBookSnapshot` can pack every artifact. Custom adapters may omit it;
   * export then probes the known book layout via `has()`.
   */
  list?(prefix?: string): readonly string[] | Promise<readonly string[]>;
  /**
   * Optional delete. `MemoryStore` and `OpfsStore` implement this so Session
   * can invalidate `meta/foundation_audit.json` after fingerprint files change
   * and `chapter.delete` can drop chapter artifacts. Missing paths are a no-op.
   * Custom adapters may omit it — `chapter.delete` then throws
   * `StoreRemoveUnsupportedError` before mutating progress.
   */
  remove?(path: string): Promise<void>;
}

export type StoreOperation = "read" | "write" | "remove" | "list" | "has";

/**
 * Failure from a store operation hosts hit (delete, optional `remove`, …).
 * Serializable across the Session Worker bridge.
 */
export class StoreError extends Error {
  readonly path?: string;
  readonly operation?: StoreOperation;

  constructor(message: string, options?: { path?: string; operation?: StoreOperation }) {
    super(message);
    this.name = "StoreError";
    if (options?.path !== undefined) {
      this.path = options.path;
    }
    if (options?.operation !== undefined) {
      this.operation = options.operation;
    }
  }
}

/**
 * `StorePort.remove` is missing. Thrown by `chapter.delete` before any
 * progress mutation so hosts do not get a half-deleted chapter.
 */
export class StoreRemoveUnsupportedError extends StoreError {
  constructor(
    message = "chapter.delete requires StorePort.remove (MemoryStore and OpfsStore implement it)",
  ) {
    super(message, { operation: "remove" });
    this.name = "StoreRemoveUnsupportedError";
  }
}

export function requireStoreRemove(store: StorePort): (path: string) => Promise<void> {
  if (typeof store.remove !== "function") {
    throw new StoreRemoveUnsupportedError();
  }
  const remove = store.remove.bind(store);
  return (path: string) => remove(path);
}
