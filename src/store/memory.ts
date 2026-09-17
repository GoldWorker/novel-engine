import type { Progress } from "../domain/progress.js";
import type { State } from "../flow/state.js";
import type { StorePort } from "../ports/store.js";
import { decodeUtf8, encodeUtf8, readJson, writeJson } from "./io.js";
import { normalizeStorePath } from "./normalize.js";
import { PATHS } from "./paths.js";
import { assembleState } from "./state.js";

/**
 * In-memory `StorePort`: a map of logical paths → UTF-8 bytes / JSON.
 * Enough for Engine tests and browser hosts that do not yet have OPFS.
 */
export class MemoryStore implements StorePort {
  private readonly files = new Map<string, Uint8Array>();

  constructor(initial?: Record<string, string | Uint8Array>) {
    if (!initial) {
      return;
    }
    for (const [path, value] of Object.entries(initial)) {
      this.files.set(
        normalizeStorePath(path),
        typeof value === "string" ? encodeUtf8(value) : value.slice(),
      );
    }
  }

  async loadState(): Promise<State> {
    return assembleState(this);
  }

  async loadProgress(): Promise<Progress | null> {
    return readJson<Progress>(this, PATHS.progress);
  }

  async saveProgress(progress: Progress): Promise<void> {
    await writeJson(this, PATHS.progress, progress);
  }

  async read(path: string): Promise<Uint8Array | null> {
    const data = this.files.get(normalizeStorePath(path));
    return data ? data.slice() : null;
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const bytes = typeof data === "string" ? encodeUtf8(data) : data.slice();
    this.files.set(normalizeStorePath(path), bytes);
  }

  async has(path: string): Promise<boolean> {
    return this.files.has(normalizeStorePath(path));
  }

  async remove(path: string): Promise<void> {
    this.files.delete(normalizeStorePath(path));
  }

  /** Sorted logical paths, optionally filtered by prefix. Used by snapshot export. */
  list(prefix = ""): string[] {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  /** Decode a stored artifact as UTF-8 text. */
  async readText(path: string): Promise<string | null> {
    const data = await this.read(path);
    return data ? decodeUtf8(data) : null;
  }
}
