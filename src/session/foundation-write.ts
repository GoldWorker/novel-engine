import type { StorePort } from "../ports/store.js";
import type {
  BookMetadata,
  Character,
  OutlineEntry,
  VolumeOutline,
  WorldRule,
} from "../store/artifacts.js";
import { writeJson, writeText } from "../store/io.js";
import { parseLayeredVolumes, parseOutlineEntry } from "../store/layered.js";
import { PATHS } from "../store/paths.js";
import type { FoundationPatch } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("expected a JSON object");
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function parseBookPatch(value: unknown): BookMetadata {
  const row = asRecord(value);
  return {
    title: asNonEmptyString(row.title, "book.title"),
    synopsis: asNonEmptyString(row.synopsis, "book.synopsis"),
  };
}

export function parsePremisePatch(value: unknown): string {
  return asNonEmptyString(value, "premise");
}

export function parseOutlinePatch(value: unknown): OutlineEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("outline must be a non-empty array");
  }
  return value.map((item, index) => parseOutlineEntry(item, index + 1));
}

export function parseLayeredOutlinePatch(value: unknown): VolumeOutline[] {
  return parseLayeredVolumes(value);
}

export function parseCharactersPatch(value: unknown): Character[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("characters must be a non-empty array");
  }
  return value.map((item, index) => {
    const row = asRecord(item);
    const character: Character = {
      name: asNonEmptyString(row.name, `characters[${index}].name`),
    };
    if (typeof row.role === "string") {
      character.role = row.role;
    }
    if (typeof row.bio === "string") {
      character.bio = row.bio;
    }
    return character;
  });
}

export function parseWorldRulesPatch(value: unknown): WorldRule[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("world_rules must be a non-empty array");
  }
  return value.map((item, index) => {
    const row = asRecord(item);
    return {
      name: asNonEmptyString(row.name, `world_rules[${index}].name`),
      description: asNonEmptyString(row.description, `world_rules[${index}].description`),
    };
  });
}

export function normalizeFoundationPatch(patch: FoundationPatch): FoundationPatch {
  const next: FoundationPatch = {};
  if (patch.book !== undefined) {
    next.book = parseBookPatch(patch.book);
  }
  if (patch.premise !== undefined) {
    next.premise = parsePremisePatch(patch.premise);
  }
  if (patch.outline !== undefined) {
    next.outline = parseOutlinePatch(patch.outline);
  }
  if (patch.layeredOutline !== undefined) {
    next.layeredOutline = parseLayeredOutlinePatch(patch.layeredOutline);
  }
  if (patch.characters !== undefined) {
    next.characters = parseCharactersPatch(patch.characters);
  }
  if (patch.worldRules !== undefined) {
    next.worldRules = parseWorldRulesPatch(patch.worldRules);
  }
  return next;
}

function patchTouchesFingerprint(patch: FoundationPatch): boolean {
  return (
    patch.book !== undefined ||
    patch.premise !== undefined ||
    patch.outline !== undefined ||
    patch.layeredOutline !== undefined ||
    patch.characters !== undefined ||
    patch.worldRules !== undefined
  );
}

export async function removeStorePath(store: StorePort, path: string): Promise<void> {
  if (typeof store.remove === "function") {
    await store.remove(path);
    return;
  }
  if (path === PATHS.foundationAudit) {
    await writeJson(store, PATHS.foundationAudit, {
      fingerprint: "",
      ready: false,
      summary: "invalidated by upsertFoundation",
      issues: [
        {
          artifact: "foundation",
          description: "fingerprint files changed",
          evidence: "upsertFoundation",
        },
      ],
    });
  }
}

/** Drop `meta/foundation_audit.json` after any fingerprint-related write. */
export async function invalidateFoundationAudit(store: StorePort): Promise<void> {
  await removeStorePath(store, PATHS.foundationAudit);
}

export async function writeFoundationPatch(
  store: StorePort,
  patch: FoundationPatch,
): Promise<boolean> {
  const normalized = normalizeFoundationPatch(patch);
  let wrote = false;
  if (normalized.book !== undefined) {
    await writeJson(store, PATHS.book, normalized.book);
    wrote = true;
  }
  if (normalized.premise !== undefined) {
    await writeText(store, PATHS.premise, normalized.premise);
    wrote = true;
  }
  if (normalized.outline !== undefined) {
    await writeJson(store, PATHS.outline, normalized.outline);
    wrote = true;
  }
  if (normalized.layeredOutline !== undefined) {
    await writeJson(store, PATHS.layeredOutline, normalized.layeredOutline);
    wrote = true;
  }
  if (normalized.characters !== undefined) {
    await writeJson(store, PATHS.characters, normalized.characters);
    wrote = true;
  }
  if (normalized.worldRules !== undefined) {
    await writeJson(store, PATHS.worldRules, normalized.worldRules);
    wrote = true;
  }
  if (wrote && patchTouchesFingerprint(normalized)) {
    await invalidateFoundationAudit(store);
  }
  return wrote;
}
