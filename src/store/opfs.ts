import type { Progress } from "../domain/progress.js";
import type { State } from "../flow/state.js";
import type { StorePort } from "../ports/store.js";
import { MemoryStore } from "./memory.js";
import { decodeUtf8, encodeUtf8, readJson, writeJson } from "./io.js";
import { normalizeStorePath } from "./normalize.js";
import type {
  OpfsDirectoryHandle,
  OpfsFileHandle,
  OpfsStorageManager,
} from "./opfs-handles.js";
import { probeKnownBookPaths } from "./list-paths.js";
import { PATHS } from "./paths.js";
import { assembleState } from "./state.js";

export class OpfsUnavailableError extends Error {
  constructor(message = "Origin Private File System is not available in this environment") {
    super(message);
    this.name = "OpfsUnavailableError";
  }
}

export interface OpfsStoreOptions {
  /**
   * Subdirectory under the OPFS root (default `novel-engine`).
   * Empty string uses the injected/navigator root directly.
   */
  directory?: string;
  /** Injected directory handle — tests and hosts that already opened OPFS. */
  root?: OpfsDirectoryHandle;
  /** Injected `navigator.storage` (or a fake) for `getDirectory()`. */
  storage?: OpfsStorageManager;
}

export interface CreateOpfsStoreOptions extends OpfsStoreOptions {
  /**
   * When OPFS is missing or `getDirectory()` fails, return `MemoryStore`.
   * Default `true`. Set `false` to throw `OpfsUnavailableError` instead.
   */
  fallbackToMemory?: boolean;
}

/**
 * True when `storage.getDirectory` exists (real `navigator.storage` or a test fake).
 */
export function isOpfsAvailable(storage?: OpfsStorageManager | null): boolean {
  if (storage) {
    return typeof storage.getDirectory === "function";
  }
  const nav = globalThis as { navigator?: { storage?: { getDirectory?: unknown } } };
  return typeof nav.navigator?.storage?.getDirectory === "function";
}

function navigatorStorage(): OpfsStorageManager | undefined {
  const nav = globalThis as { navigator?: { storage?: OpfsStorageManager } };
  return nav.navigator?.storage;
}

/**
 * Open an `OpfsStore` when OPFS is available; otherwise return `MemoryStore`.
 *
 * Hosts that must persist should call `isOpfsAvailable()` (or `OpfsStore.open()`,
 * which throws) rather than silently accepting an ephemeral fallback.
 */
export async function createOpfsStore(
  options: CreateOpfsStoreOptions = {},
): Promise<StorePort> {
  const fallback = options.fallbackToMemory !== false;
  if (options.root) {
    return OpfsStore.open(options);
  }
  const storage = options.storage ?? navigatorStorage();
  if (!isOpfsAvailable(storage)) {
    if (!fallback) {
      throw new OpfsUnavailableError();
    }
    return new MemoryStore();
  }
  try {
    if (storage) {
      return await OpfsStore.open({ ...options, storage });
    }
    return await OpfsStore.open(options);
  } catch (err) {
    if (!fallback) {
      throw err;
    }
    return new MemoryStore();
  }
}

/**
 * `StorePort` over Origin Private File System.
 *
 * Writes go through a temp file + `move` (or copy-then-unlink) so a crash mid-write
 * does not truncate the previous artifact. Browser-only; Node tests inject a fake root.
 */
export class OpfsStore implements StorePort {
  private constructor(private readonly root: OpfsDirectoryHandle) {}

  static async open(options: OpfsStoreOptions = {}): Promise<OpfsStore> {
    const root = await resolveOpfsRoot(options);
    return new OpfsStore(root);
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
    const resolved = await this.resolveFile(path, false);
    if (!resolved) {
      return null;
    }
    const file = await resolved.handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    await this.atomicWrite(path, typeof data === "string" ? encodeUtf8(data) : data);
  }

  async has(path: string): Promise<boolean> {
    return (await this.resolveFile(path, false)) !== null;
  }

  async remove(path: string): Promise<void> {
    try {
      const { dir, name } = await this.resolveParent(path, false);
      await dir.removeEntry(name);
    } catch (err) {
      if (isNotFound(err)) {
        return;
      }
      throw err;
    }
  }

  /**
   * Sorted logical paths under the OPFS root, optionally filtered by prefix.
   * Skips atomic-write temp files (`.name.tmp`). When the directory handle
   * cannot iterate `keys()`, falls back to probing known book paths.
   */
  async list(prefix = ""): Promise<string[]> {
    if (typeof this.root.keys !== "function") {
      return probeKnownBookPaths(this, prefix);
    }
    const out: string[] = [];
    await this.collectPaths(this.root, "", out);
    return out.filter((path) => prefix === "" || path.startsWith(prefix)).sort();
  }

  /** Decode a stored artifact as UTF-8 text. */
  async readText(path: string): Promise<string | null> {
    const data = await this.read(path);
    return data ? decodeUtf8(data) : null;
  }

  /**
   * Write `path` via a sibling temp file, then replace the destination.
   * If `move` is unavailable, copy the temp bytes onto the destination and delete temp.
   */
  async atomicWrite(path: string, data: Uint8Array | string): Promise<void> {
    const bytes = typeof data === "string" ? encodeUtf8(data) : data.slice();
    const { dir, name } = await this.resolveParent(path, true);
    const tmpName = `.${name}.tmp`;
    const tmp = await dir.getFileHandle(tmpName, { create: true });
    const writable = await tmp.createWritable({ keepExistingData: false });
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (err) {
      try {
        await writable.close();
      } catch {
        /* ignore close after failed write */
      }
      try {
        await dir.removeEntry(tmpName);
      } catch {
        /* tmp may not exist */
      }
      throw err;
    }

    if (typeof tmp.move === "function") {
      try {
        await tmp.move(name);
        return;
      } catch {
        /* fall through to copy-replace */
      }
    }

    const dest = await dir.getFileHandle(name, { create: true });
    const file = await tmp.getFile();
    const destWritable = await dest.createWritable({ keepExistingData: false });
    await destWritable.write(new Uint8Array(await file.arrayBuffer()));
    await destWritable.close();
    await dir.removeEntry(tmpName);
  }

  private async collectPaths(
    dir: OpfsDirectoryHandle,
    prefix: string,
    out: string[],
  ): Promise<void> {
    if (typeof dir.keys !== "function") {
      return;
    }
    for await (const name of dir.keys()) {
      if (name.startsWith(".") && name.endsWith(".tmp")) {
        continue;
      }
      const path = prefix === "" ? name : `${prefix}/${name}`;
      try {
        await dir.getFileHandle(name);
        out.push(path);
        continue;
      } catch (err) {
        if (isNotFound(err)) {
          continue;
        }
        if (!isTypeMismatch(err)) {
          throw err;
        }
      }
      const child = await dir.getDirectoryHandle(name);
      await this.collectPaths(child, path, out);
    }
  }

  private async resolveParent(
    path: string,
    create: boolean,
  ): Promise<{ dir: OpfsDirectoryHandle; name: string }> {
    const parts = normalizeStorePath(path).split("/");
    const name = parts.pop();
    if (name === undefined || name === "") {
      throw new Error(`invalid store path: ${path}`);
    }
    let dir = this.root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return { dir, name };
  }

  private async resolveFile(
    path: string,
    create: boolean,
  ): Promise<{ dir: OpfsDirectoryHandle; name: string; handle: OpfsFileHandle } | null> {
    try {
      const { dir, name } = await this.resolveParent(path, create);
      const handle = await dir.getFileHandle(name, { create });
      return { dir, name, handle };
    } catch (err) {
      if (!create && isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }
}

async function resolveOpfsRoot(options: OpfsStoreOptions): Promise<OpfsDirectoryHandle> {
  const storage = options.storage ?? navigatorStorage();
  const base = options.root ?? (storage ? await storage.getDirectory() : undefined);
  if (!base) {
    throw new OpfsUnavailableError();
  }
  const directory = options.directory ?? "novel-engine";
  if (directory === "") {
    return base;
  }
  let dir = base;
  for (const part of normalizeStorePath(directory).split("/")) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  const message = "message" in err ? String(err.message) : "";
  return (
    name === "NotFoundError" ||
    name === "NotFound" ||
    message.includes("NotFound") ||
    message.includes("not found")
  );
}

function isTypeMismatch(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  const message = "message" in err ? String(err.message) : "";
  return (
    name === "TypeMismatchError" ||
    name === "TypeMismatch" ||
    message.includes("TypeMismatch") ||
    message.includes("is a directory")
  );
}
