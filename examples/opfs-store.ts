/**
 * Scenario 3 — persist in the browser (OPFS).
 * 场景 3：浏览器持久化（OPFS）。Root README: Usage by scenario / 使用场景.
 *
 * OPFS store setup for a browser host.
 * 浏览器宿主的 OPFS 持久化：不可用时回落到 MemoryStore（刷新即丢失）。
 *
 * `isOpfsAvailable()` is a capability check (`navigator.storage.getDirectory`).
 * `createOpfsStore()` returns `OpfsStore` when OPFS exists, otherwise `MemoryStore`.
 * Hosts that *must* persist should call `OpfsStore.open()` (throws `OpfsUnavailableError`)
 * or pass `{ fallbackToMemory: false }`.
 *
 * This library never uses `node:fs` / `node:path`. Implement `StorePort` outside
 * the package if you need a Node filesystem adapter.
 */

import {
  createOpfsStore,
  isOpfsAvailable,
  MemoryStore,
  OpfsStore,
  OpfsUnavailableError,
  type StorePort,
} from "novel-engine";

/** Preferred helper: OPFS when present, in-memory otherwise. */
export async function openStoreWithFallback(): Promise<StorePort> {
  if (!isOpfsAvailable()) {
    // Node, insecure context, or older browser.
    // createOpfsStore() also returns MemoryStore unless { fallbackToMemory: false }.
    return new MemoryStore();
  }
  return createOpfsStore();
}

/** Strict open — throws if OPFS is missing. Artifacts live under "novel-engine/". */
export async function openPersistedStore(): Promise<OpfsStore> {
  try {
    return await OpfsStore.open();
  } catch (err) {
    if (err instanceof OpfsUnavailableError) {
      throw err;
    }
    throw err;
  }
}

export async function openOrThrow(): Promise<StorePort> {
  return createOpfsStore({ fallbackToMemory: false });
}

export async function demo(): Promise<void> {
  const store = await openStoreWithFallback();
  const persisted = store instanceof OpfsStore;
  console.log(persisted ? "OPFS" : "MemoryStore (ephemeral)");
  // Writes use a sibling temp file then move (or copy-then-unlink).
}

void demo();
