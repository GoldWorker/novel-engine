import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import type {
  Character,
  ChapterPlan,
  ChapterSummary,
  OutlineEntry,
  WorldRule,
} from "../store/artifacts.js";
import { readJson, readText } from "../store/io.js";
import { flattenOutline } from "../store/layered.js";
import { listStorePaths } from "../store/list-paths.js";
import {
  chapterDraftPath,
  chapterFinalPath,
  chapterPlanPath,
  chapterSummaryPath,
} from "../store/paths.js";
import { normalizeFoundationPatch } from "./foundation-write.js";
import type {
  AssessFoundationImpactOptions,
  ChapterRange,
  FoundationImpactAssessment,
  FoundationImpactMode,
  FoundationImpactSeverity,
  FoundationKey,
  FoundationMeta,
  FoundationPatch,
} from "./types.js";
import {
  FOUNDATION_IMPACT_MODES,
  FOUNDATION_IMPACT_SEVERITIES,
  FOUNDATION_KEYS,
} from "./types.js";

interface Finding {
  severity: FoundationImpactSeverity;
  mode: FoundationImpactMode;
  chapters: number[];
  key: FoundationKey;
  reason: string;
}

interface ChapterCorpus {
  chapter: number;
  text: string;
}

const SEVERITY_RANK: Record<FoundationImpactSeverity, number> = {
  meta_only: 0,
  forward_only: 1,
  rewrite_needed: 2,
};

const MODE_RANK: Record<FoundationImpactMode, number> = {
  none: 0,
  polish: 1,
  rewrite: 2,
};

const FINAL_PATH = /^chapters\/(\d+)\.md$/u;
const DRAFT_PATH = /^drafts\/(\d+)\.draft\.md$/u;

export function compactChapterRanges(chapters: readonly number[]): ChapterRange[] {
  const sorted = uniqueSorted(chapters);
  if (sorted.length === 0) {
    return [];
  }
  const ranges: ChapterRange[] = [];
  let start = sorted[0]!;
  let end = start;
  for (let i = 1; i < sorted.length; i += 1) {
    const n = sorted[i]!;
    if (n === end + 1) {
      end = n;
      continue;
    }
    ranges.push({ start, end });
    start = n;
    end = n;
  }
  ranges.push({ start, end });
  return ranges;
}

export function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

export async function listWrittenChapters(store: StorePort): Promise<number[]> {
  const paths = await listStorePaths(store, "chapters/");
  const fromFiles: number[] = [];
  for (const path of paths) {
    const match = FINAL_PATH.exec(path);
    if (match) {
      fromFiles.push(Number(match[1]));
    }
  }
  const confirmed: number[] = [];
  for (const chapter of uniqueSorted(fromFiles)) {
    const final = await readText(store, chapterFinalPath(chapter));
    if (final != null && final.trim() !== "") {
      confirmed.push(chapter);
    }
  }
  return confirmed;
}

export async function listDraftOnlyChapters(
  store: StorePort,
  written: readonly number[],
): Promise<number[]> {
  const writtenSet = new Set(written);
  const paths = await listStorePaths(store, "drafts/");
  const drafts: number[] = [];
  for (const path of paths) {
    const match = DRAFT_PATH.exec(path);
    if (!match) {
      continue;
    }
    const chapter = Number(match[1]);
    if (!writtenSet.has(chapter)) {
      drafts.push(chapter);
    }
  }
  return uniqueSorted(drafts);
}

async function loadChapterCorpus(
  store: StorePort,
  chapters: readonly number[],
): Promise<ChapterCorpus[]> {
  const rows: ChapterCorpus[] = [];
  for (const chapter of chapters) {
    const final = (await readText(store, chapterFinalPath(chapter))) ?? "";
    const draft = (await readText(store, chapterDraftPath(chapter))) ?? "";
    const plan = await readJson<ChapterPlan>(store, chapterPlanPath(chapter));
    const summary = await readJson<ChapterSummary>(store, chapterSummaryPath(chapter));
    const text = [
      final,
      draft,
      plan?.title ?? "",
      plan?.goal ?? "",
      plan?.conflict ?? "",
      plan?.hook ?? "",
      plan?.notes ?? "",
      summary?.title ?? "",
      summary?.summary ?? "",
      ...(summary?.characters ?? []),
      ...(summary?.keyEvents ?? []),
    ].join("\n");
    rows.push({ chapter, text });
  }
  return rows;
}

function chaptersMentioning(corpus: readonly ChapterCorpus[], needle: string): number[] {
  const token = needle.trim();
  if (token === "") {
    return [];
  }
  const lower = token.toLowerCase();
  return corpus.filter((row) => row.text.toLowerCase().includes(lower)).map((row) => row.chapter);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function outlineMap(entries: readonly OutlineEntry[] | null | undefined): Map<number, OutlineEntry> {
  const map = new Map<number, OutlineEntry>();
  for (const entry of entries ?? []) {
    if (Number.isInteger(entry.chapter) && entry.chapter > 0) {
      map.set(entry.chapter, entry);
    }
  }
  return map;
}

function outlineSignature(entry: OutlineEntry): { title: string; plot: string } {
  return {
    title: entry.title,
    plot: JSON.stringify({
      summary: entry.summary ?? "",
      coreEvent: entry.coreEvent ?? "",
      hook: entry.hook ?? "",
      scenes: entry.scenes ?? [],
    }),
  };
}

function characterKey(row: Character): string {
  return row.name.trim();
}

function worldKey(row: WorldRule): string {
  return row.name.trim();
}

function flattenCurrentOutline(meta: FoundationMeta): OutlineEntry[] | null {
  if (meta.outline != null) {
    return meta.outline;
  }
  if (meta.layeredOutline != null) {
    return flattenOutline(meta.layeredOutline);
  }
  return null;
}

function assessBook(current: FoundationMeta, next: FoundationPatch, findings: Finding[]): void {
  if (next.book === undefined) {
    return;
  }
  const prev = current.book;
  if (prev != null && jsonEqual(prev, next.book)) {
    return;
  }
  findings.push({
    severity: "meta_only",
    mode: "none",
    chapters: [],
    key: "book",
    reason:
      "标题/简介类元信息变更（meta/book.json）。 / Book title or synopsis-style metadata changed.",
  });
}

function assessPremise(
  current: FoundationMeta,
  next: FoundationPatch,
  written: readonly number[],
  findings: Finding[],
): void {
  if (next.premise === undefined) {
    return;
  }
  if (current.premise === next.premise) {
    return;
  }
  if (written.length === 0) {
    findings.push({
      severity: "forward_only",
      mode: "none",
      chapters: [],
      key: "premise",
      reason: "前提变更且尚无已写章节，只影响后续写作。 / Premise changed with no written chapters (forward only).",
    });
    return;
  }
  findings.push({
    severity: "rewrite_needed",
    mode: "rewrite",
    chapters: [...written],
    key: "premise",
    reason: `前提与已写章节可能冲突（第 ${formatChapterList(written)} 章）。 / Premise contradicts written chapters ${formatChapterList(written)}.`,
  });
}

function assessOutlineEntries(
  key: "outline" | "layered_outline",
  currentEntries: OutlineEntry[] | null,
  nextEntries: OutlineEntry[],
  written: readonly number[],
  findings: Finding[],
): void {
  const currentMap = outlineMap(currentEntries);
  const nextMap = outlineMap(nextEntries);
  const writtenSet = new Set(written);
  const plotChapters: number[] = [];
  const titleChapters: number[] = [];
  let futureChanged = false;

  for (const chapter of written) {
    const before = currentMap.get(chapter);
    const after = nextMap.get(chapter);
    if (after === undefined) {
      plotChapters.push(chapter);
      continue;
    }
    if (before === undefined) {
      plotChapters.push(chapter);
      continue;
    }
    const a = outlineSignature(before);
    const b = outlineSignature(after);
    if (a.plot !== b.plot) {
      plotChapters.push(chapter);
    } else if (a.title !== b.title) {
      titleChapters.push(chapter);
    }
  }

  for (const [chapter, after] of nextMap) {
    if (writtenSet.has(chapter)) {
      continue;
    }
    const before = currentMap.get(chapter);
    if (before === undefined || !jsonEqual(outlineSignature(before), outlineSignature(after))) {
      futureChanged = true;
    }
  }

  for (const [chapter] of currentMap) {
    if (!writtenSet.has(chapter) && !nextMap.has(chapter)) {
      futureChanged = true;
    }
  }

  if (plotChapters.length > 0) {
    const chapters = uniqueSorted(plotChapters);
    findings.push({
      severity: "rewrite_needed",
      mode: "rewrite",
      chapters,
      key,
      reason: `已写章节的大纲情节变更（第 ${formatChapterList(chapters)} 章）。 / Outline plot for written chapters ${formatChapterList(chapters)} changed.`,
    });
  } else if (titleChapters.length > 0) {
    const chapters = uniqueSorted(titleChapters);
    findings.push({
      severity: "rewrite_needed",
      mode: "polish",
      chapters,
      key,
      reason: `已写章节的大纲标题变更，建议打磨（第 ${formatChapterList(chapters)} 章）。 / Outline titles for written chapters ${formatChapterList(chapters)} changed; polish suggested.`,
    });
  }

  if (futureChanged) {
    findings.push({
      severity: "forward_only",
      mode: "none",
      chapters: [],
      key,
      reason: "大纲变更主要落在未写的后续章节。 / Outline changes mainly affect unwritten future chapters.",
    });
  }

  if (plotChapters.length === 0 && titleChapters.length === 0 && !futureChanged) {
      if (!jsonEqual(currentEntries ?? [], nextEntries)) {
        findings.push({
          severity: "forward_only",
          mode: "none",
          chapters: [],
          key,
          reason: "大纲有结构调整，但不触及已写章节情节。 / Outline restructured without touching written plot.",
        });
      }
  }
}

function assessCharacters(
  current: FoundationMeta,
  next: FoundationPatch,
  written: readonly number[],
  corpus: readonly ChapterCorpus[],
  findings: Finding[],
): void {
  if (next.characters === undefined) {
    return;
  }
  const prev = new Map((current.characters ?? []).map((row) => [characterKey(row), row]));
  const upcoming = new Map(next.characters.map((row) => [characterKey(row), row]));
  const added: string[] = [];
  const removedTouched: number[] = [];
  const changedTouched: number[] = [];
  let addedOnly = false;
  let removedUntouched = false;

  for (const [name, row] of upcoming) {
    const before = prev.get(name);
    if (before === undefined) {
      added.push(name);
      addedOnly = true;
      continue;
    }
    if (jsonEqual(before, row)) {
      continue;
    }
    const mentioned = chaptersMentioning(corpus, name);
    if (mentioned.length > 0) {
      changedTouched.push(...mentioned);
    } else if (written.length > 0) {
      changedTouched.push(...written);
    } else {
      addedOnly = true;
    }
  }

  for (const [name] of prev) {
    if (upcoming.has(name)) {
      continue;
    }
    const mentioned = chaptersMentioning(corpus, name);
    if (mentioned.length > 0) {
      removedTouched.push(...mentioned);
    } else if (written.length > 0) {
      removedUntouched = true;
    }
  }

  if (changedTouched.length > 0 || removedTouched.length > 0) {
    const chapters = uniqueSorted([...changedTouched, ...removedTouched]);
    findings.push({
      severity: "rewrite_needed",
      mode: "rewrite",
      chapters,
      key: "characters",
      reason: `角色设定与已写章节冲突（第 ${formatChapterList(chapters)} 章）。 / Character bible contradicts written chapters ${formatChapterList(chapters)}.`,
    });
  } else if (removedUntouched) {
    findings.push({
      severity: "forward_only",
      mode: "none",
      chapters: [],
      key: "characters",
      reason: "角色表删除了尚未出场的角色，只影响后续。 / Removed characters that do not appear in written chapters (forward only).",
    });
  } else if (addedOnly || added.length > 0) {
    findings.push({
      severity: "forward_only",
      mode: "none",
      chapters: [],
      key: "characters",
      reason: `新增角色（${added.join("、") || "characters"}）主要服务未写章节。 / New characters are for unwritten future chapters.`,
    });
  }
}

function assessWorldRules(
  current: FoundationMeta,
  next: FoundationPatch,
  written: readonly number[],
  corpus: readonly ChapterCorpus[],
  findings: Finding[],
): void {
  if (next.worldRules === undefined) {
    return;
  }
  const prev = new Map((current.worldRules ?? []).map((row) => [worldKey(row), row]));
  const upcoming = new Map(next.worldRules.map((row) => [worldKey(row), row]));
  const mentioned: number[] = [];
  let added = false;
  let existingChanged = false;

  for (const [name, row] of upcoming) {
    const before = prev.get(name);
    if (before === undefined) {
      added = true;
      continue;
    }
    if (jsonEqual(before, row)) {
      continue;
    }
    existingChanged = true;
    mentioned.push(...chaptersMentioning(corpus, name));
  }
  for (const [name] of prev) {
    if (!upcoming.has(name)) {
      existingChanged = true;
      mentioned.push(...chaptersMentioning(corpus, name));
    }
  }

  if (existingChanged && written.length > 0) {
    const chapters = uniqueSorted(mentioned.length > 0 ? mentioned : written);
    findings.push({
      severity: "rewrite_needed",
      mode: "rewrite",
      chapters,
      key: "world_rules",
      reason: `世界规则与已写章节可能冲突（第 ${formatChapterList(chapters)} 章）。 / World rules contradict written chapters ${formatChapterList(chapters)}.`,
    });
  } else if (added || existingChanged) {
    findings.push({
      severity: "forward_only",
      mode: "none",
      chapters: [],
      key: "world_rules",
      reason: "世界规则变更主要约束未写的后续章节。 / World-rule changes mainly constrain unwritten future chapters.",
    });
  }
}

function formatChapterList(chapters: readonly number[]): string {
  return compactChapterRanges(chapters)
    .map((range) => (range.start === range.end ? String(range.start) : `${range.start}–${range.end}`))
    .join(", ");
}

function mergeFindings(
  findings: readonly Finding[],
  draftOnly: readonly number[],
): Omit<FoundationImpactAssessment, "source"> {
  if (findings.length === 0) {
    return {
      severity: "meta_only",
      suggestedChapters: [],
      suggestedRanges: [],
      suggestedMode: "none",
      reasons: ["补丁未改动基础设定。 / Patch does not change foundation artifacts."],
      notes: [],
      changedKeys: [],
    };
  }

  let severity: FoundationImpactSeverity = "meta_only";
  let mode: FoundationImpactMode = "none";
  const chapters: number[] = [];
  const reasons: string[] = [];
  const changedKeys: FoundationKey[] = [];

  for (const finding of findings) {
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[severity]) {
      severity = finding.severity;
    }
    if (MODE_RANK[finding.mode] > MODE_RANK[mode]) {
      mode = finding.mode;
    }
    chapters.push(...finding.chapters);
    reasons.push(finding.reason);
    if (!changedKeys.includes(finding.key)) {
      changedKeys.push(finding.key);
    }
  }

  const orderedKeys = FOUNDATION_KEYS.filter((key) => changedKeys.includes(key));
  const suggestedChapters =
    severity === "rewrite_needed" ? uniqueSorted(chapters) : [];
  const suggestedMode =
    severity === "rewrite_needed" ? (mode === "none" ? "rewrite" : mode) : "none";
  const notes: string[] = [];
  if (draftOnly.length > 0) {
    notes.push(
      `存在无终稿草稿（第 ${formatChapterList(draftOnly)} 章），rewrite/polish 需要终稿，故未列入 suggestedChapters。 / Draft-only chapters ${formatChapterList(draftOnly)} omitted (rewrite/polish need a final).`,
    );
  }
  if (suggestedChapters.length > 0) {
    notes.push(
      `建议处理章节 ${formatChapterList(suggestedChapters)}，模式 ${suggestedMode}。 / Suggested chapters ${formatChapterList(suggestedChapters)} via ${suggestedMode}.`,
    );
  }
  notes.push("评估不写盘、不改写章节。 / Assessment is pure: it does not mutate the store or rewrite chapters.");

  return {
    severity,
    suggestedChapters,
    suggestedRanges: compactChapterRanges(suggestedChapters),
    suggestedMode,
    reasons,
    notes,
    changedKeys: orderedKeys,
  };
}

function isSeverity(value: unknown): value is FoundationImpactSeverity {
  return (
    typeof value === "string" &&
    (FOUNDATION_IMPACT_SEVERITIES as readonly string[]).includes(value)
  );
}

function isMode(value: unknown): value is FoundationImpactMode {
  return typeof value === "string" && (FOUNDATION_IMPACT_MODES as readonly string[]).includes(value);
}

function parseJsonObjectText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/iu.exec(trimmed);
  const body = (fence?.[1] ?? trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function maxSeverity(
  a: FoundationImpactSeverity,
  b: FoundationImpactSeverity,
): FoundationImpactSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function maxMode(a: FoundationImpactMode, b: FoundationImpactMode): FoundationImpactMode {
  return MODE_RANK[a] >= MODE_RANK[b] ? a : b;
}

function applyLlmRefinement(
  heuristics: FoundationImpactAssessment,
  raw: Record<string, unknown>,
  written: readonly number[],
): FoundationImpactAssessment {
  const writtenSet = new Set(written);
  let severity = heuristics.severity;
  if (isSeverity(raw.severity)) {
    severity = maxSeverity(heuristics.severity, raw.severity);
  }
  let suggestedMode = heuristics.suggestedMode;
  if (isMode(raw.suggestedMode)) {
    suggestedMode = maxMode(heuristics.suggestedMode, raw.suggestedMode);
  }
  let suggestedChapters = heuristics.suggestedChapters;
  if (Array.isArray(raw.suggestedChapters)) {
    const parsed = uniqueSorted(
      raw.suggestedChapters.filter((n): n is number => typeof n === "number"),
    ).filter((chapter) => writtenSet.has(chapter));
    suggestedChapters = uniqueSorted([...heuristics.suggestedChapters, ...parsed]);
  }
  if (severity !== "rewrite_needed") {
    suggestedChapters = [];
    suggestedMode = "none";
  } else if (suggestedMode === "none") {
    suggestedMode = "rewrite";
  } else if (suggestedChapters.length === 0) {
    suggestedChapters = heuristics.suggestedChapters;
  }

  const extraReasons: string[] = [];
  if (Array.isArray(raw.reasons)) {
    for (const row of raw.reasons) {
      if (typeof row === "string" && row.trim() !== "") {
        extraReasons.push(row.trim());
      }
    }
  }
  const extraNotes: string[] = [];
  if (Array.isArray(raw.notes)) {
    for (const row of raw.notes) {
      if (typeof row === "string" && row.trim() !== "") {
        extraNotes.push(row.trim());
      }
    }
  }

  return {
    severity,
    suggestedChapters,
    suggestedRanges: compactChapterRanges(suggestedChapters),
    suggestedMode,
    reasons: extraReasons.length > 0 ? [...heuristics.reasons, ...extraReasons] : heuristics.reasons,
    notes: [
      ...heuristics.notes,
      "已用 LLM 精炼评估（不可把严重度降到启发式之下）。 / LLM refined the assessment (cannot downgrade heuristic severity).",
      ...extraNotes,
    ],
    changedKeys: heuristics.changedKeys,
    source: "llm",
  };
}

async function refineWithLlm(
  llm: LlmPort,
  heuristics: FoundationImpactAssessment,
  patch: FoundationPatch,
  written: readonly number[],
): Promise<FoundationImpactAssessment> {
  const result = await llm.complete({
    agent: "editor",
    messages: [
      {
        role: "system",
        content:
          "You refine a novel-engine foundation-impact assessment. Reply with a single JSON object only — no markdown, no tool calls. Schema: { \"severity\": \"meta_only\"|\"forward_only\"|\"rewrite_needed\", \"suggestedChapters\": number[], \"suggestedMode\": \"none\"|\"polish\"|\"rewrite\", \"reasons\": string[], \"notes\": string[] }. Do not invent unwritten chapters.",
      },
      {
        role: "user",
        content: [
          `heuristic assessment:\n${JSON.stringify(heuristics, null, 2)}`,
          `proposed patch:\n${JSON.stringify(patch, null, 2)}`,
          `written chapters with finals: ${written.join(", ") || "(none)"}`,
        ].join("\n\n"),
      },
    ],
  });
  const parsed = parseJsonObjectText(result.text);
  if (parsed == null) {
    return {
      ...heuristics,
      notes: [
        ...heuristics.notes,
        "LLM 精炼未返回合法 JSON，沿用启发式结果。 / LLM refinement was not valid JSON; keeping heuristics.",
      ],
    };
  }
  return applyLlmRefinement(heuristics, parsed, written);
}

export async function assessProposedFoundation(
  store: StorePort,
  current: FoundationMeta,
  patch: FoundationPatch,
  llm: LlmPort | undefined,
  options: AssessFoundationImpactOptions = {},
): Promise<FoundationImpactAssessment> {
  const normalized = normalizeFoundationPatch(patch);
  const written = await listWrittenChapters(store);
  const draftOnly = await listDraftOnlyChapters(store, written);
  const corpus = await loadChapterCorpus(store, written);
  const findings: Finding[] = [];

  assessBook(current, normalized, findings);
  assessPremise(current, normalized, written, findings);
  if (normalized.outline !== undefined) {
    assessOutlineEntries(
      "outline",
      flattenCurrentOutline(current),
      normalized.outline,
      written,
      findings,
    );
  }
  if (normalized.layeredOutline !== undefined) {
    assessOutlineEntries(
      "layered_outline",
      flattenCurrentOutline(current),
      flattenOutline(normalized.layeredOutline),
      written,
      findings,
    );
  }
  assessCharacters(current, normalized, written, corpus, findings);
  assessWorldRules(current, normalized, written, corpus, findings);

  const merged = mergeFindings(findings, draftOnly);
  const heuristics: FoundationImpactAssessment = { ...merged, source: "heuristics" };

  if (options.refineWithLlm === true && llm !== undefined) {
    return refineWithLlm(llm, heuristics, normalized, written);
  }
  if (options.refineWithLlm === true && llm === undefined) {
    return {
      ...heuristics,
      notes: [
        ...heuristics.notes,
        "refineWithLlm 已请求但 session 没有 LlmPort，沿用启发式。 / refineWithLlm requested but no LlmPort; using heuristics.",
      ],
    };
  }
  return heuristics;
}

export function defaultRewriteInstruction(assessment: FoundationImpactAssessment): string {
  const reasons = assessment.reasons.join(" ");
  return `基础设定已更新（${assessment.severity}）。请按新设定对齐本章。 / Foundation changed (${assessment.severity}). Align this chapter. ${reasons}`;
}
