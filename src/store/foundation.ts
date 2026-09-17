import type { Progress } from "../domain/progress.js";
import type { StorePort } from "../ports/store.js";
import { PATHS } from "./paths.js";
import { readJson, readText } from "./io.js";

/**
 * Missing foundation artifacts in stable order, aligned with ainovel-cli
 * `Store.FoundationMissing` (short-book subset; no compass / layered outline).
 */
export async function foundationMissing(store: StorePort): Promise<string[]> {
  const missing: string[] = [];

  if (!(await store.has(PATHS.book))) {
    missing.push("book");
  }

  const premise = await readText(store, PATHS.premise);
  if (premise == null || premise.trim() === "") {
    missing.push("premise");
  }

  const outline = await readJson<unknown>(store, PATHS.outline);
  if (!Array.isArray(outline) || outline.length === 0) {
    missing.push("outline");
  }

  const characters = await readJson<unknown>(store, PATHS.characters);
  if (!Array.isArray(characters) || characters.length === 0) {
    missing.push("characters");
  }

  const rules = await readJson<unknown>(store, PATHS.worldRules);
  if (!Array.isArray(rules) || rules.length === 0) {
    missing.push("world_rules");
  }

  if (missing.length === 0) {
    const progress = await readJson<Progress>(store, PATHS.progress);
    if (
      progress == null ||
      (progress.phase !== "writing" && progress.phase !== "complete")
    ) {
      missing.push("foundation_audit");
    }
  }

  return missing;
}

/** Files that participate in the foundation fingerprint (short-book set). */
export const FINGERPRINT_FILES = [
  PATHS.book,
  PATHS.premise,
  PATHS.outline,
  PATHS.characters,
  PATHS.worldRules,
] as const;

/** Browser-safe FNV-1a over concatenated path + content pairs. */
export async function foundationFingerprint(store: StorePort): Promise<string> {
  let hash = 2166136261;
  const mix = (byte: number): void => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  };

  for (const rel of FINGERPRINT_FILES) {
    const data = await store.read(rel);
    if (data == null) {
      throw new Error(`fingerprint: missing ${rel}`);
    }
    for (let i = 0; i < rel.length; i++) {
      mix(rel.charCodeAt(i) & 0xff);
    }
    mix(0);
    for (const byte of data) {
      mix(byte);
    }
    mix(0);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
