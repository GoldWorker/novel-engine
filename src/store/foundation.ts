import { isPlanningTier, type PlanningTier } from "../domain/planning-tier.js";
import type { Progress } from "../domain/progress.js";
import type { StorePort } from "../ports/store.js";
import type { RunMeta } from "./artifacts.js";
import { readJson, readText } from "./io.js";
import { parseLayeredVolumes } from "./layered.js";
import { PATHS } from "./paths.js";

/**
 * True when `layered_outline.json` is a non-empty array of volumes that each
 * have a valid arc shape (`parseLayeredVolumes`).
 */
export async function hasValidLayeredOutline(store: StorePort): Promise<boolean> {
  try {
    const raw = await readJson<unknown>(store, PATHS.layeredOutline);
    if (!Array.isArray(raw) || raw.length === 0) {
      return false;
    }
    parseLayeredVolumes(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Planning scale for foundation gap checks.
 *
 * Order: explicit `tier` → `meta/run_meta.json` → `progress.planningTier` →
 * `progress.layered` → a valid layered outline (treated as mid) → short.
 */
export async function resolveFoundationTier(
  store: StorePort,
  tier?: PlanningTier,
): Promise<PlanningTier> {
  if (isPlanningTier(tier)) {
    return tier;
  }

  const meta = await readJson<RunMeta>(store, PATHS.runMeta);
  if (isPlanningTier(meta?.planningTier)) {
    return meta.planningTier;
  }

  const progress = await store.loadProgress();
  if (progress != null && isPlanningTier(progress.planningTier)) {
    return progress.planningTier;
  }
  if (progress?.layered === true) {
    return "mid";
  }
  if (await hasValidLayeredOutline(store)) {
    return "mid";
  }
  return "short";
}

async function outlineRequirementSatisfied(
  store: StorePort,
  tier: PlanningTier,
): Promise<boolean> {
  const outline = await readJson<unknown>(store, PATHS.outline);
  if (Array.isArray(outline) && outline.length > 0) {
    return true;
  }
  if (tier === "short") {
    return false;
  }
  return hasValidLayeredOutline(store);
}

/**
 * Missing foundation artifacts in stable order, aligned with ainovel-cli
 * `Store.FoundationMissing` (compass omitted in this simplified SDK).
 *
 * Mid/long books with a valid non-empty `layered_outline.json` do **not**
 * require a flat `outline.json`. Short books still do.
 */
export async function foundationMissing(
  store: StorePort,
  tier?: PlanningTier,
): Promise<string[]> {
  const missing: string[] = [];
  const resolved = await resolveFoundationTier(store, tier);

  if (!(await store.has(PATHS.book))) {
    missing.push("book");
  }

  const premise = await readText(store, PATHS.premise);
  if (premise == null || premise.trim() === "") {
    missing.push("premise");
  }

  if (!(await outlineRequirementSatisfied(store, resolved))) {
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
    const progress = await store.loadProgress();
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
  const files: string[] = [...FINGERPRINT_FILES];
  if (await store.has(PATHS.layeredOutline)) {
    files.push(PATHS.layeredOutline);
  }

  let hash = 2166136261;
  const mix = (byte: number): void => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  };

  for (const rel of files) {
    const data = await store.read(rel);
    if (data == null) {
      if (rel === PATHS.outline && (await hasValidLayeredOutline(store))) {
        continue;
      }
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
