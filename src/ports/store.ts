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
   * can invalidate `meta/foundation_audit.json` after fingerprint files change.
   * Missing paths are a no-op. Custom adapters may omit it.
   */
  remove?(path: string): Promise<void>;
}
