import { inferPlanningStub } from "../engine/plan-start.js";
import { raceAbort } from "../abort.js";
import type { LlmCompletionRequest, LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import { FoundationGenerateError } from "./errors.js";
import {
  parseBookPatch,
  parseCharactersPatch,
  parseLayeredOutlinePatch,
  parseOutlinePatch,
  parsePremisePatch,
  parseWorldRulesPatch,
} from "./foundation-write.js";
import { resolveSessionPlanning } from "./planning.js";
import type {
  FoundationGenerateMode,
  FoundationKey,
  FoundationMeta,
  FoundationPatch,
  GenerateFoundationOptions,
} from "./types.js";
import { FOUNDATION_KEYS } from "./types.js";

function isFoundationKey(value: unknown): value is FoundationKey {
  return typeof value === "string" && (FOUNDATION_KEYS as readonly string[]).includes(value);
}

export function assertFoundationKeys(keys: readonly string[]): FoundationKey[] {
  if (keys.length === 0) {
    throw new FoundationGenerateError("generateFoundation keys must be a non-empty subset");
  }
  const seen = new Set<FoundationKey>();
  for (const key of keys) {
    if (!isFoundationKey(key)) {
      throw new FoundationGenerateError(`unknown foundation key: ${key}`);
    }
    seen.add(key);
  }
  return FOUNDATION_KEYS.filter((key) => seen.has(key));
}

function pick(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in record) {
      return record[name];
    }
  }
  return undefined;
}

export function patchFromGeneratedJson(
  raw: Record<string, unknown>,
  keys: readonly FoundationKey[],
): FoundationPatch {
  const patch: FoundationPatch = {};
  for (const key of keys) {
    switch (key) {
      case "book": {
        const value = pick(raw, "book");
        if (value !== undefined) {
          patch.book = parseBookPatch(value);
        }
        break;
      }
      case "premise": {
        const value = pick(raw, "premise");
        if (value !== undefined) {
          patch.premise = parsePremisePatch(value);
        }
        break;
      }
      case "outline": {
        const value = pick(raw, "outline");
        if (value !== undefined) {
          patch.outline = parseOutlinePatch(value);
        }
        break;
      }
      case "layered_outline": {
        const value = pick(raw, "layered_outline", "layeredOutline");
        if (value !== undefined) {
          patch.layeredOutline = parseLayeredOutlinePatch(value);
        }
        break;
      }
      case "characters": {
        const value = pick(raw, "characters");
        if (value !== undefined) {
          patch.characters = parseCharactersPatch(value);
        }
        break;
      }
      case "world_rules": {
        const value = pick(raw, "world_rules", "worldRules");
        if (value !== undefined) {
          patch.worldRules = parseWorldRulesPatch(value);
        }
        break;
      }
    }
  }
  return patch;
}

/** Strip optional ```json fences and parse the first JSON object in `text`. */
export function parseFoundationJsonText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new FoundationGenerateError("generateFoundation expected JSON text in LlmPort.complete().text");
  }
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/iu.exec(trimmed);
  const body = (fence?.[1] ?? trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new FoundationGenerateError("generateFoundation text did not contain a JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FoundationGenerateError(`generateFoundation JSON parse failed: ${message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FoundationGenerateError("generateFoundation JSON must be an object of artifacts");
  }
  return parsed as Record<string, unknown>;
}

function schemaHint(keys: readonly FoundationKey[]): string {
  const parts: string[] = [];
  for (const key of keys) {
    switch (key) {
      case "book":
        parts.push(`"book": { "title": string, "synopsis": string }`);
        break;
      case "premise":
        parts.push(`"premise": string`);
        break;
      case "outline":
        parts.push(
          `"outline": [ { "chapter": number, "title": string, "summary"?: string } ]`,
        );
        break;
      case "layered_outline":
        parts.push(
          `"layered_outline": [ { "title": string, "theme": string, "arcs": [ { "title": string, "goal": string, "chapters"?: [...], "estimatedChapters"?: number } ] } ]`,
        );
        break;
      case "characters":
        parts.push(`"characters": [ { "name": string, "role"?: string, "bio"?: string } ]`);
        break;
      case "world_rules":
        parts.push(`"world_rules": [ { "name": string, "description": string } ]`);
        break;
    }
  }
  return `{ ${parts.join(", ")} }`;
}

function existingSummary(meta: FoundationMeta): string {
  return JSON.stringify(
    {
      book: meta.book,
      premise: meta.premise,
      outline: meta.outline,
      layered_outline: meta.layeredOutline,
      characters: meta.characters,
      world_rules: meta.worldRules,
    },
    null,
    2,
  );
}

export async function keysToGenerate(
  requested: readonly FoundationKey[],
  mode: FoundationGenerateMode,
  inspect: (options?: { prompt?: string }) => Promise<{
    gaps: { key: string }[];
    planning: { tier: string };
  }>,
  prompt: string,
): Promise<FoundationKey[]> {
  if (mode === "overwrite") {
    return [...requested];
  }
  const inspected = await inspect({ prompt });
  const missing = new Set(inspected.gaps.map((gap) => gap.key));
  const selected: FoundationKey[] = [];
  for (const key of requested) {
    if (key === "outline") {
      if (missing.has("outline")) {
        selected.push("outline");
      }
      continue;
    }
    if (key === "layered_outline") {
      if (missing.has("outline") && inspected.planning.tier !== "short") {
        selected.push("layered_outline");
      }
      continue;
    }
    if (missing.has(key)) {
      selected.push(key);
    }
  }
  return selected;
}

export function missingKeysFromGaps(
  gaps: readonly { key: string }[],
  tier: string,
): FoundationKey[] {
  const keys: FoundationKey[] = [];
  for (const gap of gaps) {
    if (gap.key === "foundation_audit") {
      continue;
    }
    if (gap.key === "outline") {
      keys.push(tier === "short" ? "outline" : "layered_outline");
      continue;
    }
    if (isFoundationKey(gap.key)) {
      keys.push(gap.key);
    }
  }
  return keys;
}

export async function completeFoundationJson(
  llm: LlmPort,
  store: StorePort,
  prompt: string,
  keys: readonly FoundationKey[],
  meta: FoundationMeta,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const planning = await resolveSessionPlanning(store, prompt);
  const stub = inferPlanningStub(prompt);
  const request: LlmCompletionRequest = {
    agent: stub.planner,
    messages: [
      {
        role: "system",
        content:
          "You generate novel-engine foundation artifacts. Reply with a single JSON object only — no markdown, no tool calls, no chapter drafts. Keys must match the requested schema.",
      },
      {
        role: "user",
        content: [
          `规划档位 planning tier: ${planning.tier} (${planning.label})`,
          `用户需求 prompt:\n${prompt}`,
          `只生成这些键 keys: ${keys.join(", ")}`,
          `JSON 形状 schema:\n${schemaHint(keys)}`,
          `已有基础设定 existing (do not invent chapters):\n${existingSummary(meta)}`,
        ].join("\n\n"),
      },
    ],
  };
  if (signal !== undefined) {
    request.signal = signal;
  }
  const result = await raceAbort(llm.complete(request), signal);
  return parseFoundationJsonText(result.text);
}
