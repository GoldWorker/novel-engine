import type { Progress } from "../domain/progress.js";
import { latestCompleted } from "../domain/progress.js";
import type { LlmMessage, LlmPort, LlmToolCall } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import type { ChapterPlan, ChapterSummary, OutlineEntry, VolumeOutline } from "../store/artifacts.js";
import { appendCheckpoint } from "../store/audit.js";
import { readJson, readText, writeJson, writeText } from "../store/io.js";
import { loadLayeredOutline } from "../store/layered.js";
import {
  PATHS,
  chapterDraftPath,
  chapterFinalPath,
  chapterPlanPath,
  chapterSummaryPath,
} from "../store/paths.js";
import { writerTools } from "../workers/tools.js";
import { ChapterConflictError, ChapterRunnerError } from "./errors.js";
import { removeStorePath } from "./foundation-write.js";
import type {
  ChapterDeleteOptions,
  ChapterDeleteResult,
  ChapterRunner,
  ChapterView,
  ChapterWriteInput,
  ChapterWriteMode,
  ChapterWriteResult,
  FoundationMeta,
  FoundationPatch,
  SessionEvent,
} from "./types.js";
import { CHAPTER_WRITE_MODES } from "./types.js";

const DEFAULT_MAX_TURNS = 16;

const WRITER_SYSTEM =
  "你是章节作者。只处理当前这一章。按 plan_chapter → draft_chapter → commit_chapter 落盘。需要上下文时调用 novel_context 或 read_chapter。不要写其他章，不要调用 save_review / complete_book。";

export async function readChapterView(
  store: StorePort,
  chapter: number,
): Promise<ChapterView | null> {
  assertChapterNumber(chapter);
  const plan = await readJson<ChapterPlan>(store, chapterPlanPath(chapter));
  const draft = await readText(store, chapterDraftPath(chapter));
  const final = await readText(store, chapterFinalPath(chapter));
  const summary = await readJson<ChapterSummary>(store, chapterSummaryPath(chapter));
  if (plan == null && draft == null && final == null && summary == null) {
    return null;
  }
  return { chapter, plan, draft, final, summary };
}

export async function saveChapterFinal(
  store: StorePort,
  chapter: number,
  markdown: string,
): Promise<ChapterView> {
  assertChapterNumber(chapter);
  const text = markdown.trim();
  if (text === "") {
    throw new ChapterRunnerError("saveFinal markdown must be non-empty");
  }
  await ensureWritingProgress(store, chapter);
  const path = chapterFinalPath(chapter);
  await writeText(store, path, markdown);
  const progress = await store.loadProgress();
  if (progress) {
    const completed = progress.completedChapters.includes(chapter)
      ? [...progress.completedChapters]
      : [...progress.completedChapters, chapter];
    const next: Progress = {
      ...progress,
      phase: progress.phase === "complete" ? "complete" : "writing",
      completedChapters: completed,
      currentChapter: Math.max(progress.currentChapter ?? 0, chapter),
      totalChapters: Math.max(progress.totalChapters, chapter),
    };
    await store.saveProgress(next);
  }
  const existingSummary = await readJson<ChapterSummary>(store, chapterSummaryPath(chapter));
  if (existingSummary == null) {
    const plan = await readJson<ChapterPlan>(store, chapterPlanPath(chapter));
    const summary: ChapterSummary = {
      chapter,
      title: plan?.title ?? `第 ${chapter} 章`,
      summary: plan?.goal ?? markdown.slice(0, 240),
    };
    await writeJson(store, chapterSummaryPath(chapter), summary);
  }
  await appendCheckpoint(store, "save_final", path);
  const view = await readChapterView(store, chapter);
  if (view == null) {
    throw new ChapterRunnerError(`saveFinal failed to persist chapter ${chapter}`);
  }
  return view;
}

export async function runChapterWrite(
  store: StorePort,
  llm: LlmPort,
  input: ChapterWriteInput,
  emit: (event: SessionEvent) => void,
): Promise<ChapterWriteResult> {
  const chapter = input.chapter;
  assertChapterNumber(chapter);
  const mode = input.mode;
  if (!CHAPTER_WRITE_MODES.includes(mode)) {
    throw new ChapterRunnerError(`unknown chapter write mode: ${String(mode)}`);
  }
  await assertModePreconditions(store, chapter, mode, input.force === true);
  await ensureWritingProgress(store, chapter);

  const task = buildWriterTask(input);
  const tools = writerTools(store);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const messages: LlmMessage[] = [
    { role: "system", content: WRITER_SYSTEM },
    { role: "user", content: task },
  ];

  let turns = 0;
  for (let turn = 0; turn < DEFAULT_MAX_TURNS; turn++) {
    const result = await llm.complete({
      messages,
      agent: "writer",
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
    });
    const calls = extractToolCalls(result);
    if (calls.length === 0) {
      break;
    }
    turns += 1;
    messages.push({ role: "assistant", content: result.text });
    for (const call of calls) {
      const tool = byName.get(call.name);
      if (!tool) {
        throw new ChapterRunnerError(`unknown writer tool: ${call.name}`);
      }
      emit({ type: "chapter_step", chapter, mode, step: turns, tool: call.name });
      const output = await tool.execute(withSessionOverride(call.name, call.arguments));
      messages.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: JSON.stringify(output),
      });
    }
  }

  if (turns >= DEFAULT_MAX_TURNS) {
    throw new ChapterRunnerError(`chapter.write exceeded ${DEFAULT_MAX_TURNS} tool turns`);
  }

  const view = await readChapterView(store, chapter);
  if (view?.final == null || view.final.trim() === "") {
    throw new ChapterRunnerError(`chapter.write did not produce a final for chapter ${chapter}`);
  }
  return { chapter, mode, view, turns };
}

export function createChapterRunner(hooks: {
  store: StorePort;
  requireOpen: () => void;
  requireLlm: () => LlmPort;
  withBusy: <T>(fn: () => Promise<T>) => Promise<T>;
  emit: (event: SessionEvent) => void;
  upsertFoundation: (patch: FoundationPatch) => Promise<FoundationMeta>;
}): ChapterRunner {
  return {
    async get(chapter: number): Promise<ChapterView | null> {
      hooks.requireOpen();
      return readChapterView(hooks.store, chapter);
    },
    async saveFinal(chapter: number, markdown: string): Promise<void> {
      hooks.requireOpen();
      await saveChapterFinal(hooks.store, chapter, markdown);
    },
    async write(input: ChapterWriteInput): Promise<ChapterWriteResult> {
      hooks.requireOpen();
      const llm = hooks.requireLlm();
      return hooks.withBusy(() => runChapterWrite(hooks.store, llm, input, hooks.emit));
    },
    async delete(
      chapter: number,
      options: ChapterDeleteOptions = {},
    ): Promise<ChapterDeleteResult> {
      hooks.requireOpen();
      return hooks.withBusy(() =>
        deleteChapter(hooks.store, chapter, options, hooks.upsertFoundation),
      );
    },
  };
}

function assertChapterNumber(chapter: number): void {
  if (!Number.isInteger(chapter) || chapter <= 0) {
    throw new ChapterRunnerError("chapter must be an integer > 0");
  }
}

async function assertModePreconditions(
  store: StorePort,
  chapter: number,
  mode: ChapterWriteMode,
  force: boolean,
): Promise<void> {
  const final = await readText(store, chapterFinalPath(chapter));
  const hasFinal = final != null && final.trim() !== "";
  const draft = await readText(store, chapterDraftPath(chapter));
  const hasDraft = draft != null && draft.trim() !== "";

  switch (mode) {
    case "create":
      if (hasFinal && !force) {
        throw new ChapterConflictError(
          chapter,
          `chapter ${chapter} already has a final; pass force: true to overwrite`,
        );
      }
      return;
    case "continue":
      if (hasFinal) {
        throw new ChapterConflictError(
          chapter,
          `chapter ${chapter} already has a final; use rewrite or polish`,
        );
      }
      if (!hasDraft) {
        throw new ChapterConflictError(chapter, `continue requires an existing draft for chapter ${chapter}`);
      }
      return;
    case "rewrite":
    case "polish":
      if (!hasFinal) {
        throw new ChapterConflictError(
          chapter,
          `${mode} requires an existing final for chapter ${chapter}`,
        );
      }
      return;
  }
}

function buildWriterTask(input: ChapterWriteInput): string {
  const title = input.title?.trim() ? `标题：${input.title.trim()}。` : "";
  const instruction = input.instruction?.trim() ? `额外指令：${input.instruction.trim()}` : "";
  switch (input.mode) {
    case "create":
      return `写第 ${input.chapter} 章。${title}按 plan_chapter → draft_chapter(mode=write) → commit_chapter 完成。${instruction}`;
    case "continue":
      return `继续第 ${input.chapter} 章。已有草稿，用 draft_chapter(mode=append) 续写后再 commit_chapter。不要丢掉已有草稿。${instruction}`;
    case "rewrite":
      return `重写第 ${input.chapter} 章。即使该章已提交也要覆盖：plan_chapter → draft_chapter(mode=write) → commit_chapter。${title}${instruction}`;
    case "polish":
      return `打磨第 ${input.chapter} 章终稿（轻度改写）。读取现有终稿后，用 draft_chapter(mode=write) 写入打磨后的全文并 commit_chapter。${instruction}`;
  }
}

function withSessionOverride(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "plan_chapter" || name === "commit_chapter") {
    return { ...args, sessionOverride: true };
  }
  return args;
}

function extractToolCalls(result: { text: string; toolCalls?: readonly LlmToolCall[] }): readonly LlmToolCall[] {
  if (result.toolCalls && result.toolCalls.length > 0) {
    return result.toolCalls;
  }
  return [];
}

export async function ensureWritingProgress(store: StorePort, chapter: number): Promise<void> {
  const progress = await store.loadProgress();
  if (progress == null) {
    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: chapter,
      completedChapters: [],
      pendingRewrites: [],
      layered: false,
      currentChapter: chapter,
    });
    return;
  }
  if (progress.phase === "init" || progress.phase === "premise" || progress.phase === "outline") {
    await store.saveProgress({
      ...progress,
      phase: "writing",
      currentChapter: Math.max(progress.currentChapter ?? 0, chapter),
    });
  }
}

const CHAPTER_ARTIFACT_PATHS = [
  chapterPlanPath,
  chapterDraftPath,
  chapterFinalPath,
  chapterSummaryPath,
] as const;

export async function deleteChapter(
  store: StorePort,
  chapter: number,
  options: ChapterDeleteOptions,
  upsertFoundation: (patch: FoundationPatch) => Promise<FoundationMeta>,
): Promise<ChapterDeleteResult> {
  assertChapterNumber(chapter);
  const removed: string[] = [];
  for (const pathOf of CHAPTER_ARTIFACT_PATHS) {
    const path = pathOf(chapter);
    if (await store.has(path)) {
      await removeStorePath(store, path);
      if (!(await store.has(path))) {
        removed.push(path);
      }
    }
  }

  await dropChapterFromProgress(store, chapter);

  let outlineSynced = false;
  if (options.syncOutline === true) {
    const patch = await outlinePatchWithoutChapter(store, chapter);
    if (patch !== null) {
      await upsertFoundation(patch);
      outlineSynced = true;
    }
  }

  return {
    chapter,
    removed,
    outlineSynced,
    progress: await store.loadProgress(),
  };
}

async function dropChapterFromProgress(store: StorePort, chapter: number): Promise<void> {
  const progress = await store.loadProgress();
  if (progress == null) {
    return;
  }
  const completed = progress.completedChapters.filter((n) => n !== chapter);
  const pendingRewrites = progress.pendingRewrites.filter((n) => n !== chapter);
  const wasCompleted = completed.length !== progress.completedChapters.length;
  let currentChapter = progress.currentChapter;
  if (currentChapter === chapter) {
    currentChapter = latestCompleted({ ...progress, completedChapters: completed });
  }
  let phase = progress.phase;
  if (phase === "complete" && wasCompleted) {
    phase = "writing";
  }
  const next: Progress = {
    ...progress,
    phase,
    completedChapters: completed,
    pendingRewrites,
  };
  if (currentChapter !== undefined) {
    next.currentChapter = currentChapter;
  }
  await store.saveProgress(next);
}

/**
 * Build an upsert patch that drops `chapter` from flat and/or layered outline.
 * Returns null when nothing can be rewritten (no files, unchanged, or remaining
 * flat outline would be empty — upsert forbids empty arrays).
 */
async function outlinePatchWithoutChapter(
  store: StorePort,
  chapter: number,
): Promise<FoundationPatch | null> {
  const patch: FoundationPatch = {};
  const outline = await readJson<OutlineEntry[]>(store, PATHS.outline);
  if (Array.isArray(outline) && outline.some((entry) => entry.chapter === chapter)) {
    const next = outline.filter((entry) => entry.chapter !== chapter);
    if (next.length > 0) {
      patch.outline = next;
    }
  }
  const layered = await loadLayeredOutline(store);
  if (layered && layered.some((volume) => volumeHasChapter(volume, chapter))) {
    patch.layeredOutline = layered.map((volume) => ({
      ...volume,
      arcs: volume.arcs.map((arc) => ({
        ...arc,
        chapters: arc.chapters.filter((entry) => entry.chapter !== chapter),
      })),
    }));
  }
  if (patch.outline === undefined && patch.layeredOutline === undefined) {
    return null;
  }
  return patch;
}

function volumeHasChapter(volume: VolumeOutline, chapter: number): boolean {
  return volume.arcs.some((arc) => arc.chapters.some((entry) => entry.chapter === chapter));
}
