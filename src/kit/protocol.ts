import type { KitStoreKind } from "./types.js";

/**
 * Kit worker handshake version. Distinct `ns` from Engine (`engine`) and
 * Session (`session`) so init messages are never mistaken for session RPCs.
 */
export const KIT_PROTOCOL = 1 as const;
export const KIT_NS = "kit" as const;

export type KitStoreName = "opfs" | "memory";

interface KitEnvelope {
  v: typeof KIT_PROTOCOL;
  ns: typeof KIT_NS;
  id: string;
}

/**
 * Main → worker, once, before any session command.
 *
 * Worker creates `StorePort` + `LlmPort` (`fetch(llmEndpoint)`), then
 * `attachSessionWorker` + `createNovelSession`.
 */
export type KitInitCommand = KitEnvelope & {
  type: "init";
  bookId: string;
  llmEndpoint: string;
  store: KitStoreName;
  fallbackToMemory: boolean;
  /** Full OPFS directory for this book, e.g. `novel-engine/default`. */
  opfsDirectory?: string;
};

export type KitReadyNotice = KitEnvelope & {
  type: "ready";
  bookId: string;
  storeKind: Exclude<KitStoreKind, "custom">;
};

export type KitErrorNotice = {
  v: typeof KIT_PROTOCOL;
  ns: typeof KIT_NS;
  type: "error";
  id?: string;
  name: string;
  message: string;
};

export type KitNotice = KitReadyNotice | KitErrorNotice;

export type KitCommand = KitInitCommand;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isKitInitCommand(value: unknown): value is KitInitCommand {
  if (!isRecord(value) || value.v !== KIT_PROTOCOL || value.ns !== KIT_NS) {
    return false;
  }
  if (value.type !== "init" || typeof value.id !== "string") {
    return false;
  }
  if (typeof value.bookId !== "string" || typeof value.llmEndpoint !== "string") {
    return false;
  }
  if (value.store !== "opfs" && value.store !== "memory") {
    return false;
  }
  if (typeof value.fallbackToMemory !== "boolean") {
    return false;
  }
  return value.opfsDirectory === undefined || typeof value.opfsDirectory === "string";
}

export function isKitNotice(value: unknown): value is KitNotice {
  if (!isRecord(value) || value.v !== KIT_PROTOCOL || value.ns !== KIT_NS) {
    return false;
  }
  if (value.id !== undefined && typeof value.id !== "string") {
    return false;
  }
  if (value.type === "ready") {
    return (
      typeof value.id === "string" &&
      typeof value.bookId === "string" &&
      (value.storeKind === "opfs" || value.storeKind === "memory")
    );
  }
  if (value.type === "error") {
    return typeof value.name === "string" && typeof value.message === "string";
  }
  return false;
}
