import type { Progress } from "../domain/progress.js";
import type { State } from "../flow/state.js";

/**
 * Persistence port. Phase 0 exports the contract only — no adapter, no Engine.
 *
 * Host apps will inject an implementation (memory, OPFS, IndexedDB, or Node fs
 * outside this library). All IO belongs in the adapter; `route` stays pure.
 */
export interface StorePort {
  /** Load every fact `route` needs. Adapters perform IO; Route never does. */
  loadState(): Promise<State>;
  loadProgress(): Promise<Progress | null>;
  saveProgress(progress: Progress): Promise<void>;
}
