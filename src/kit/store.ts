import type { StorePort } from "../ports/store.js";
import type { CreateOpfsStoreOptions } from "../store/opfs.js";
import { MemoryStore } from "../store/memory.js";
import { createOpfsStore, OpfsStore } from "../store/opfs.js";
import type { KitOpfsOptions, KitStoreKind, KitStoreOption } from "./types.js";

export const DEFAULT_OPFS_DIRECTORY = "novel-engine";

export function isStorePort(value: unknown): value is StorePort {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const rec = value as {
    read?: unknown;
    write?: unknown;
    has?: unknown;
    loadState?: unknown;
    loadProgress?: unknown;
    saveProgress?: unknown;
  };
  return (
    typeof rec.read === "function" &&
    typeof rec.write === "function" &&
    typeof rec.has === "function" &&
    typeof rec.loadState === "function" &&
    typeof rec.loadProgress === "function" &&
    typeof rec.saveProgress === "function"
  );
}

export function isNamedStore(value: KitStoreOption): value is "opfs" | "memory" {
  return value === "opfs" || value === "memory";
}

export function resolveOpfsDirectory(opfs?: KitOpfsOptions): string {
  return opfs?.directory ?? DEFAULT_OPFS_DIRECTORY;
}

export function bookOpfsDirectory(baseDir: string, bookId: string): string {
  if (baseDir === "") {
    return bookId;
  }
  return `${baseDir.replace(/\/+$/, "")}/${bookId}`;
}

export function storeKindOf(store: StorePort, named: "opfs" | "memory" | "custom"): KitStoreKind {
  if (named === "custom") {
    return "custom";
  }
  if (named === "memory") {
    return "memory";
  }
  return store instanceof OpfsStore ? "opfs" : "memory";
}

export async function openNamedStore(options: {
  named: "opfs" | "memory";
  bookId: string;
  baseDir: string;
  fallbackToMemory: boolean;
  opfs?: KitOpfsOptions;
  memoryCache?: Map<string, MemoryStore>;
}): Promise<{ store: StorePort; storeKind: KitStoreKind }> {
  if (options.named === "memory") {
    const cache = options.memoryCache;
    if (cache) {
      const existing = cache.get(options.bookId);
      if (existing) {
        return { store: existing, storeKind: "memory" };
      }
      const created = new MemoryStore();
      cache.set(options.bookId, created);
      return { store: created, storeKind: "memory" };
    }
    return { store: new MemoryStore(), storeKind: "memory" };
  }

  const directory = bookOpfsDirectory(options.baseDir, options.bookId);
  const created = await createOpfsStore(opfsOpenOptions(options.opfs, directory, options.fallbackToMemory));
  return { store: created, storeKind: storeKindOf(created, "opfs") };
}

export async function openIndexStore(options: {
  named: "opfs" | "memory";
  baseDir: string;
  fallbackToMemory: boolean;
  opfs?: KitOpfsOptions;
}): Promise<StorePort> {
  if (options.named === "memory") {
    return new MemoryStore();
  }
  return createOpfsStore(opfsOpenOptions(options.opfs, options.baseDir, options.fallbackToMemory));
}

function opfsOpenOptions(
  opfs: KitOpfsOptions | undefined,
  directory: string,
  fallbackToMemory: boolean,
): CreateOpfsStoreOptions {
  return {
    directory,
    fallbackToMemory,
    ...(opfs?.root !== undefined ? { root: opfs.root } : {}),
    ...(opfs?.storage !== undefined ? { storage: opfs.storage } : {}),
  };
}
