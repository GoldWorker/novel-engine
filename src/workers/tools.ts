import { nextChapter, type Progress } from "../domain/progress.js";
import { validatePhaseTransition } from "../domain/phase.js";
import type { StorePort } from "../ports/store.js";
import type {
  BookMetadata,
  ChapterPlan,
  FoundationAudit,
  OutlineEntry,
  RunMeta,
} from "../store/artifacts.js";
import { appendCheckpoint } from "../store/audit.js";
import { foundationFingerprint, foundationMissing } from "../store/foundation.js";
import { readJson, readText, writeJson, writeText } from "../store/io.js";
import {
  arcReviewPath,
  chapterDraftPath,
  chapterFinalPath,
  chapterPlanPath,
  globalReviewPath,
  PATHS,
} from "../store/paths.js";
import { advancePhase, requireProgress } from "../store/progress-ops.js";

export interface Tool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("expected a JSON object");
}

function asString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function asNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function asBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

async function patchRunMeta(store: StorePort, patch: Partial<RunMeta>): Promise<void> {
  const current = (await readJson<RunMeta>(store, PATHS.runMeta)) ?? {};
  await writeJson(store, PATHS.runMeta, { ...current, ...patch });
}

export function architectTools(store: StorePort): Tool[] {
  return [novelContextTool(store), saveBookTool(store), saveFoundationTool(store), auditFoundationTool(store)];
}

export function writerTools(store: StorePort): Tool[] {
  return [
    novelContextTool(store),
    readChapterTool(store),
    planChapterTool(store),
    draftChapterTool(store),
    commitChapterTool(store),
  ];
}

export function editorTools(store: StorePort): Tool[] {
  return [novelContextTool(store), readChapterTool(store), saveReviewTool(store)];
}

function novelContextTool(store: StorePort): Tool {
  return {
    name: "novel_context",
    description: "读取已落盘的进度、基础设定与 foundation_status（含 fingerprint）",
    async execute(args) {
      const chapter = typeof args.chapter === "number" ? args.chapter : undefined;
      const progress = await store.loadProgress();
      const missing = await foundationMissing(store);
      let fingerprint: string | null = null;
      if (!missing.some((item) => item !== "foundation_audit")) {
        fingerprint = await foundationFingerprint(store);
      }
      const context: Record<string, unknown> = {
        progress,
        book: await readJson(store, PATHS.book),
        premise: await readText(store, PATHS.premise),
        outline: await readJson(store, PATHS.outline),
        characters: await readJson(store, PATHS.characters),
        world_rules: await readJson(store, PATHS.worldRules),
        foundation_status: {
          missing,
          fingerprint,
          ready: missing.length === 0,
        },
      };
      if (chapter !== undefined) {
        context.chapter = {
          number: chapter,
          plan: await readJson(store, chapterPlanPath(chapter)),
          draft: await readText(store, chapterDraftPath(chapter)),
          final: await readText(store, chapterFinalPath(chapter)),
        };
      }
      return context;
    },
  };
}

function saveBookTool(store: StorePort): Tool {
  return {
    name: "save_book",
    description: "保存书名与面向读者的简介（meta/book.json）",
    async execute(args) {
      const book: BookMetadata = {
        title: asString(args, "title"),
        synopsis: asString(args, "synopsis"),
      };
      if (book.title.trim() === "" || book.synopsis.trim() === "") {
        throw new Error("title and synopsis must be non-empty");
      }
      await writeJson(store, PATHS.book, book);
      await appendCheckpoint(store, "book", PATHS.book);
      const remaining = await foundationMissing(store);
      return { saved: true, foundation_ready: remaining.length === 0, remaining };
    },
  };
}

function saveFoundationTool(store: StorePort): Tool {
  return {
    name: "save_foundation",
    description:
      "保存基础设定。type: premise / outline / characters / world_rules / complete_book。短篇用 outline。",
    async execute(args) {
      const type = asString(args, "type");
      if (typeof args.scale === "string" && args.scale !== "") {
        if (args.scale !== "short" && args.scale !== "mid" && args.scale !== "long") {
          throw new Error(`invalid scale ${args.scale}`);
        }
        await patchRunMeta(store, { planningTier: args.scale });
      }

      const result: Record<string, unknown> = { saved: true, type };

      switch (type) {
        case "premise": {
          if (typeof args.content !== "string" || args.content.trim() === "") {
            throw new Error("premise content must be a non-empty string");
          }
          await writeText(store, PATHS.premise, args.content);
          await advancePhase(store, "premise");
          await appendCheckpoint(store, "premise", PATHS.premise);
          break;
        }
        case "outline": {
          const progress = await requireProgress(store);
          if (progress.phase === "writing" || progress.phase === "complete") {
            throw new Error("写作阶段禁止使用 outline 全量覆盖大纲");
          }
          const entries = parseOutline(args.content);
          await writeJson(store, PATHS.outline, entries);
          await advancePhase(store, "outline");
          const after = await requireProgress(store);
          await store.saveProgress({
            ...after,
            totalChapters: entries.length,
            layered: false,
          });
          await appendCheckpoint(store, "outline", PATHS.outline);
          result.chapters = entries.length;
          break;
        }
        case "characters": {
          const characters = parseObjectArray(args.content, "characters");
          await writeJson(store, PATHS.characters, characters);
          await appendCheckpoint(store, "characters", PATHS.characters);
          result.count = characters.length;
          break;
        }
        case "world_rules": {
          const rules = parseObjectArray(args.content, "world_rules");
          await writeJson(store, PATHS.worldRules, rules);
          await appendCheckpoint(store, "world_rules", PATHS.worldRules);
          result.count = rules.length;
          break;
        }
        case "complete_book": {
          const progress = await requireProgress(store);
          if (progress.phase !== "writing") {
            throw new Error(`complete_book 仅在 writing 阶段可调用（当前 phase=${progress.phase}）`);
          }
          if (progress.pendingRewrites.length > 0) {
            throw new Error(`还有 ${progress.pendingRewrites.length} 章在返工队列中`);
          }
          if (progress.completedChapters.length === 0) {
            throw new Error("一章未写不可完本");
          }
          const next = nextChapter(progress);
          if (progress.totalChapters > 0 && next <= progress.totalChapters) {
            throw new Error(
              `大纲内还有未写章节（下一章 ${next}/共 ${progress.totalChapters}）`,
            );
          }
          validatePhaseTransition(progress.phase, "complete");
          await store.saveProgress({ ...progress, phase: "complete" });
          await appendCheckpoint(store, "complete_book", PATHS.progress);
          result.book_complete = true;
          result.phase = "complete";
          break;
        }
        default:
          throw new Error(`unknown save_foundation type ${type}`);
      }

      const remaining = await foundationMissing(store);
      result.remaining = remaining;
      result.foundation_ready = remaining.length === 0;
      return result;
    },
  };
}

function parseOutline(content: unknown): OutlineEntry[] {
  const raw = typeof content === "string" ? (JSON.parse(content) as unknown) : content;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("outline content must be a non-empty array");
  }
  return raw.map((item, index) => {
    const row = asRecord(item);
    const chapter = typeof row.chapter === "number" ? row.chapter : index + 1;
    const title = typeof row.title === "string" ? row.title : `第 ${chapter} 章`;
    const entry: OutlineEntry = { chapter, title };
    if (typeof row.summary === "string") {
      entry.summary = row.summary;
    }
    return entry;
  });
}

function parseObjectArray(content: unknown, label: string): unknown[] {
  const raw = typeof content === "string" ? (JSON.parse(content) as unknown) : content;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${label} content must be a non-empty array`);
  }
  return raw;
}

function auditFoundationTool(store: StorePort): Tool {
  return {
    name: "audit_foundation",
    description: "审查已落盘基础设定。ready=true 时进入 writing。",
    async execute(args) {
      const fingerprint = asString(args, "fingerprint");
      const ready = asBoolean(args, "ready");
      const summary = asString(args, "summary");
      const issues = Array.isArray(args.issues) ? args.issues : [];
      if (ready && issues.length > 0) {
        throw new Error("ready=true 时 issues 必须为空");
      }
      if (!ready && issues.length === 0) {
        throw new Error("ready=false 时必须给出具体 issues");
      }

      const missing = await foundationMissing(store);
      for (const item of missing) {
        if (item !== "foundation_audit") {
          throw new Error(`基础设定尚缺 ${item}，不能审查`);
        }
      }
      const current = await foundationFingerprint(store);
      if (fingerprint !== current) {
        throw new Error("基础设定已发生变化；请重新调用 novel_context 获取最新 fingerprint");
      }

      const audit: FoundationAudit = {
        fingerprint,
        ready,
        summary,
        issues: issues as FoundationAudit["issues"],
      };
      await writeJson(store, PATHS.foundationAudit, audit);
      if (!ready) {
        return {
          foundation_ready: false,
          issues,
          next_action: "按 issues 修正对应基础设定后再审查",
        };
      }
      await appendCheckpoint(store, "foundation_audit", PATHS.foundationAudit);
      await advancePhase(store, "writing");
      return { foundation_ready: true, issues: [], phase: "writing" };
    },
  };
}

function planChapterTool(store: StorePort): Tool {
  return {
    name: "plan_chapter",
    description: "保存章节构思到 drafts/{ch}.plan.json",
    async execute(args) {
      const plan: ChapterPlan = {
        chapter: asNumber(args, "chapter"),
        title: asString(args, "title"),
        goal: asString(args, "goal"),
        conflict: asString(args, "conflict"),
        hook: asString(args, "hook"),
      };
      if (typeof args.notes === "string") {
        plan.notes = args.notes;
      }
      if (plan.chapter <= 0) {
        throw new Error("chapter must be > 0");
      }
      const progress = await requireProgress(store);
      if (progress.completedChapters.includes(plan.chapter)) {
        return {
          chapter: plan.chapter,
          skipped: true,
          completed: true,
          reason: `第 ${plan.chapter} 章已提交完成，不能重新规划`,
        };
      }
      const path = chapterPlanPath(plan.chapter);
      await writeJson(store, path, plan);
      await appendCheckpoint(store, "plan_chapter", path);
      return { saved: true, chapter: plan.chapter, title: plan.title };
    },
  };
}

function draftChapterTool(store: StorePort): Tool {
  return {
    name: "draft_chapter",
    description: "写入章节草稿。mode=write 覆盖，mode=append 追加。",
    async execute(args) {
      const chapter = asNumber(args, "chapter");
      const content = asString(args, "content");
      const mode = typeof args.mode === "string" ? args.mode : "write";
      if (chapter <= 0) {
        throw new Error("chapter must be > 0");
      }
      if (content.trim() === "") {
        throw new Error("content must not be empty");
      }
      const path = chapterDraftPath(chapter);
      if (mode === "append") {
        const existing = (await readText(store, path)) ?? "";
        const merged = existing === "" ? content : `${existing}\n\n${content}`;
        await writeText(store, path, merged);
      } else {
        await writeText(store, path, content);
      }
      await appendCheckpoint(store, "draft_chapter", path);
      const stored = (await readText(store, path)) ?? "";
      return { saved: true, chapter, chars: [...stored].length, mode };
    },
  };
}

function commitChapterTool(store: StorePort): Tool {
  return {
    name: "commit_chapter",
    description: "把草稿提交为终稿并更新 Progress。简化 saga：终稿 + 进度 + checkpoint。",
    async execute(args) {
      const chapter = asNumber(args, "chapter");
      if (chapter <= 0) {
        throw new Error("chapter must be > 0");
      }
      const progress = await requireProgress(store);
      if (progress.phase !== "writing") {
        throw new Error(`章节提交仅允许在 writing 阶段（当前 phase=${progress.phase}）`);
      }
      if (progress.completedChapters.includes(chapter)) {
        return {
          chapter,
          skipped: true,
          completed: true,
          next_chapter: nextChapter(progress),
        };
      }
      const expected = progress.pendingRewrites[0] ?? nextChapter(progress);
      if (chapter !== expected) {
        throw new Error(`只能提交第 ${expected} 章，收到第 ${chapter} 章`);
      }
      const draft = await readText(store, chapterDraftPath(chapter));
      if (draft == null || draft.trim() === "") {
        throw new Error(`第 ${chapter} 章草稿为空，请先 draft_chapter`);
      }
      const finalPath = chapterFinalPath(chapter);
      await writeText(store, finalPath, draft);
      const completed = [...progress.completedChapters, chapter];
      const pending = progress.pendingRewrites.filter((item) => item !== chapter);
      const next: Progress = {
        ...progress,
        phase: "writing",
        completedChapters: completed,
        pendingRewrites: pending,
        currentChapter: Math.max(progress.currentChapter ?? 0, chapter + 1),
        flow: pending.length > 0 ? progress.flow : "writing",
      };
      await store.saveProgress(next);
      await appendCheckpoint(store, "commit_chapter", finalPath);
      const following = nextChapter(next);
      return {
        chapter,
        saved: true,
        next_chapter: following,
        book_complete: next.totalChapters > 0 && following > next.totalChapters,
        flow: next.flow,
      };
    },
  };
}

function readChapterTool(store: StorePort): Tool {
  return {
    name: "read_chapter",
    description: "读取已提交终稿或草稿",
    async execute(args) {
      const chapter = asNumber(args, "chapter");
      const final = await readText(store, chapterFinalPath(chapter));
      const draft = await readText(store, chapterDraftPath(chapter));
      return {
        chapter,
        final,
        draft,
        found: final != null || draft != null,
      };
    },
  };
}

function saveReviewTool(store: StorePort): Tool {
  return {
    name: "save_review",
    description: "保存审阅结果（editor stub）。scope=global|arc。",
    async execute(args) {
      const chapter = asNumber(args, "chapter");
      const scope = typeof args.scope === "string" ? args.scope : "global";
      const path = scope === "arc" ? arcReviewPath(chapter) : globalReviewPath(chapter);
      await writeJson(store, path, {
        chapter,
        scope,
        issues: Array.isArray(args.issues) ? args.issues : [],
        summary: typeof args.summary === "string" ? args.summary : "",
      });
      await appendCheckpoint(store, "save_review", path);
      return { saved: true, chapter, scope };
    },
  };
}
