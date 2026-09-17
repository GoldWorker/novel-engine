import { validateFlowTransition } from "../domain/flow.js";
import { nextChapter, latestCompleted, type Progress } from "../domain/progress.js";
import { validatePhaseTransition } from "../domain/phase.js";
import type { StorePort } from "../ports/store.js";
import type {
  ArcSummary,
  BookMetadata,
  ChapterPlan,
  ChapterSummary,
  FoundationAudit,
  OutlineEntry,
  ReviewEntry,
  ReviewIssue,
  RunMeta,
  VolumeSummary,
} from "../store/artifacts.js";
import { appendCheckpoint, appendDecision } from "../store/audit.js";
import { assembleNovelContext } from "../store/context.js";
import { foundationFingerprint, foundationMissing } from "../store/foundation.js";
import { readJson, readText, writeJson, writeText } from "../store/io.js";
import {
  appendVolumePlan,
  estimatedChapterCapacity,
  expandArcAt,
  flattenOutline,
  loadLayeredOutline,
  parseArcExpansion,
  parseLayeredVolumes,
  parseVolumeOutline,
  saveLayeredViews,
  checkArcBoundary,
} from "../store/layered.js";
import {
  arcReviewPath,
  arcSummaryPath,
  chapterDraftPath,
  chapterFinalPath,
  chapterPlanPath,
  chapterSummaryPath,
  characterSnapshotPath,
  globalReviewPath,
  PATHS,
  volumeSummaryPath,
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
  return [
    novelContextTool(store),
    saveBookTool(store),
    saveFoundationTool(store),
    auditFoundationTool(store),
    expandNextArcTool(store),
  ];
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
  return [
    novelContextTool(store),
    readChapterTool(store),
    saveReviewTool(store),
    saveArcSummaryTool(store),
    saveVolumeSummaryTool(store),
  ];
}

function novelContextTool(store: StorePort): Tool {
  return {
    name: "novel_context",
    description:
      "读取进度、基础设定、foundation_status，以及已落盘的滑动章节摘要与弧/卷摘要（若有）",
    async execute(args) {
      const chapter = typeof args.chapter === "number" ? args.chapter : undefined;
      return assembleNovelContext(store, chapter !== undefined ? { chapter } : {});
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
      "保存基础设定。type: premise / outline / layered_outline / characters / world_rules / append_volume / complete_book。短篇用 outline；中长篇用 layered_outline。append_volume / complete_book 须带 reason。",
    async execute(args) {
      const type = asString(args, "type");
      if (typeof args.scale === "string" && args.scale !== "") {
        if (args.scale !== "short" && args.scale !== "mid" && args.scale !== "long") {
          throw new Error(`invalid scale ${args.scale}`);
        }
        await patchRunMeta(store, { planningTier: args.scale });
      }

      const result: Record<string, unknown> = { saved: true, type };
      const volumeEnd = type === "append_volume" || type === "complete_book";
      const reason = typeof args.reason === "string" ? args.reason.trim() : "";
      if (volumeEnd && reason === "") {
        throw new Error(
          `${type} 必须带 reason 参数：对照完结判定清单，一句话说明本次为何续卷、宣告收官或完结`,
        );
      }

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
        case "layered_outline": {
          const progress = await requireProgress(store);
          if (progress.phase === "writing" || progress.phase === "complete") {
            throw new Error("写作阶段禁止使用 layered_outline 全量覆盖大纲");
          }
          const volumes = parseLayeredVolumes(args.content);
          const firstArc = volumes[0]?.arcs[0];
          if (!firstArc || firstArc.chapters.length === 0) {
            throw new Error("分层大纲第 1 卷首弧必须包含详细章节");
          }
          await saveLayeredViews(store, volumes);
          await advancePhase(store, "outline");
          const after = await requireProgress(store);
          await store.saveProgress({
            ...after,
            totalChapters: estimatedChapterCapacity(volumes),
            layered: true,
          });
          await appendCheckpoint(store, "layered_outline", PATHS.layeredOutline);
          result.volumes = volumes.length;
          result.outlined_chapters = flattenOutline(volumes).length;
          result.dynamic_planning = true;
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
        case "append_volume": {
          const progress = await requireProgress(store);
          if (progress.phase === "complete") {
            throw new Error("全书已完结（phase=complete），不允许追加新卷");
          }
          if (!progress.layered) {
            throw new Error("append_volume 仅用于分层大纲");
          }
          const existing = (await loadLayeredOutline(store)) ?? [];
          const incoming = parseVolumeOutline(args.content, existing.length + 1);
          const appended = appendVolumePlan(existing, incoming);
          await saveLayeredViews(store, appended.volumes);
          const after = await requireProgress(store);
          await store.saveProgress({
            ...after,
            totalChapters: estimatedChapterCapacity(appended.volumes),
            layered: true,
          });
          await appendCheckpoint(store, "append_volume", PATHS.layeredOutline);
          result.volume = appended.saved.index;
          result.arcs = appended.saved.arcs.length;
          if (appended.saved.final) {
            result.final_volume = true;
          }
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
          if (progress.layered) {
            const volumes = await loadLayeredOutline(store);
            const outlined = volumes ? flattenOutline(volumes).length : 0;
            if (next <= outlined) {
              throw new Error(
                `当前详细大纲还有未写章节（下一章 ${next}/当前已细化 ${outlined}），不可完本`,
              );
            }
          } else if (progress.totalChapters > 0 && next <= progress.totalChapters) {
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

      if (type === "append_volume" || (type === "complete_book" && (await store.loadProgress())?.layered)) {
        await appendDecision(store, {
          kind: "volume_end",
          decider: "architect",
          reason,
          decision: { action: type, ...result },
        });
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
      // ChapterRunner injects sessionOverride so a completed chapter can be
      // re-planned. Engine LLM never sets this; do not use pendingRewrites here.
      const sessionOverride = args.sessionOverride === true;
      const progress = await requireProgress(store);
      if (!sessionOverride && progress.completedChapters.includes(plan.chapter)) {
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
      // Session-only: overwrite a completed chapter without Engine saga /
      // pendingRewrites. Omit this flag (Engine path) to keep sequential commit.
      const sessionOverride = args.sessionOverride === true;
      const progress = await requireProgress(store);
      if (!sessionOverride && progress.phase !== "writing") {
        throw new Error(`章节提交仅允许在 writing 阶段（当前 phase=${progress.phase}）`);
      }
      if (!sessionOverride && progress.completedChapters.includes(chapter)) {
        return {
          chapter,
          skipped: true,
          completed: true,
          next_chapter: nextChapter(progress),
        };
      }
      if (!sessionOverride) {
        const expected = progress.pendingRewrites[0] ?? nextChapter(progress);
        if (chapter !== expected) {
          throw new Error(`只能提交第 ${expected} 章，收到第 ${chapter} 章`);
        }
      }
      const draft = await readText(store, chapterDraftPath(chapter));
      if (draft == null || draft.trim() === "") {
        throw new Error(`第 ${chapter} 章草稿为空，请先 draft_chapter`);
      }
      const finalPath = chapterFinalPath(chapter);
      await writeText(store, finalPath, draft);
      const completed = progress.completedChapters.includes(chapter)
        ? [...progress.completedChapters]
        : [...progress.completedChapters, chapter];
      const pending = sessionOverride
        ? [...progress.pendingRewrites]
        : progress.pendingRewrites.filter((item) => item !== chapter);
      const next: Progress = {
        ...progress,
        phase: sessionOverride && progress.phase === "complete" ? "complete" : "writing",
        completedChapters: completed,
        pendingRewrites: pending,
        currentChapter: Math.max(
          progress.currentChapter ?? 0,
          sessionOverride ? chapter : chapter + 1,
        ),
        totalChapters: sessionOverride
          ? Math.max(progress.totalChapters, chapter)
          : progress.totalChapters,
        flow: sessionOverride ? progress.flow : pending.length > 0 ? progress.flow : "writing",
      };
      await store.saveProgress(next);
      const plan = await readJson<ChapterPlan>(store, chapterPlanPath(chapter));
      const summary: ChapterSummary = {
        chapter,
        title: plan?.title ?? `第 ${chapter} 章`,
        summary: plan?.goal ?? draft.slice(0, 240),
      };
      if (plan?.goal) {
        summary.keyEvents = [plan.goal];
      }
      await writeJson(store, chapterSummaryPath(chapter), summary);
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
    description: "保存审阅结果。scope=global|arc。issues[].requires_change 会写入 PendingRewrites。",
    async execute(args) {
      const chapter = asNumber(args, "chapter");
      if (chapter <= 0) {
        throw new Error("chapter must be > 0");
      }
      const scope = typeof args.scope === "string" ? args.scope : "global";
      if (scope !== "arc" && scope !== "global" && scope !== "chapter") {
        throw new Error(`invalid review scope: ${scope}`);
      }
      const summary = typeof args.summary === "string" ? args.summary.trim() : "";
      if (summary === "") {
        throw new Error("summary is required");
      }
      const issues = parseReviewIssues(args.issues);
      if (scope === "arc") {
        const volumes = await loadLayeredOutline(store);
        if (volumes) {
          const boundary = checkArcBoundary(volumes, chapter);
          if (boundary == null || !boundary.isArcEnd || boundary.endChapter !== chapter) {
            throw new Error("arc review chapter must be an arc endpoint");
          }
          for (const issue of issues) {
            for (const issueChapter of issue.chapters ?? []) {
              if (issueChapter < boundary.startChapter || issueChapter > boundary.endChapter) {
                throw new Error(
                  `arc review issue chapter ${issueChapter} outside ${boundary.startChapter}-${boundary.endChapter}`,
                );
              }
            }
          }
        }
      }

      const progress = await requireProgress(store);
      if (progress.phase === "writing" && !progress.completedChapters.includes(chapter)) {
        throw new Error(`review chapter ${chapter} must be completed`);
      }

      const path = scope === "arc" ? arcReviewPath(chapter) : globalReviewPath(chapter);
      const entry: ReviewEntry = { chapter, scope, summary, issues };
      if (typeof args.verdict === "string") {
        entry.verdict = args.verdict;
      }
      if (Array.isArray(args.dimensions)) {
        entry.dimensions = args.dimensions;
      }
      await writeJson(store, path, entry);

      const affected = uniqueSorted(
        issues.flatMap((issue) => (issue.requiresChange ? [...(issue.chapters ?? [])] : [])),
      );
      let nextFlow = progress.flow;
      if (affected.length > 0) {
        const verdict = typeof args.verdict === "string" ? args.verdict : "rewrite";
        const desired = verdict === "polish" ? "polishing" : "rewriting";
        validateFlowTransition(progress.flow, desired);
        nextFlow = desired;
        await store.saveProgress({
          ...progress,
          pendingRewrites: affected,
          flow: desired,
        });
      }

      await appendCheckpoint(store, "save_review", path);
      return {
        saved: true,
        chapter,
        scope,
        issues: issues.length,
        affected_chapters: affected,
        next_flow: nextFlow,
        next_chapter: nextChapter(
          affected.length > 0 ? { ...progress, pendingRewrites: affected, flow: nextFlow } : progress,
        ),
      };
    },
  };
}

function expandNextArcTool(store: StorePort): Tool {
  return {
    name: "expand_next_arc",
    description: "展开当前已完成弧之后的下一骨架弧。提交校准后的 title、goal 和 chapters。",
    async execute(args) {
      const expansion = parseArcExpansion(args);
      const progress = await requireProgress(store);
      if (!progress.layered) {
        throw new Error("expand_next_arc 仅用于分层大纲");
      }
      const volumes = await loadLayeredOutline(store);
      if (volumes == null) {
        throw new Error("layered_outline 未落盘");
      }
      const expanded = expandArcAt(volumes, latestCompleted(progress), expansion);
      await saveLayeredViews(store, expanded.volumes);
      await store.saveProgress({
        ...progress,
        totalChapters: estimatedChapterCapacity(expanded.volumes),
        layered: true,
      });
      await appendCheckpoint(store, "expand_next_arc", PATHS.layeredOutline);
      return {
        saved: true,
        type: "expand_next_arc",
        volume: expanded.volume,
        arc: expanded.arc,
        title: expansion.title,
        goal: expansion.goal,
        chapters: expansion.chapters.length,
      };
    },
  };
}

function saveArcSummaryTool(store: StorePort): Tool {
  return {
    name: "save_arc_summary",
    description: "保存弧级摘要、角色快照与写作规则（弧结束时调用）",
    async execute(args) {
      const volume = asNumber(args, "volume");
      const arc = asNumber(args, "arc");
      if (volume <= 0 || arc <= 0) {
        throw new Error("volume and arc must be > 0");
      }
      const title = asString(args, "title").trim();
      const summary = asString(args, "summary").trim();
      if (title === "" || summary === "") {
        throw new Error("title and summary are required");
      }
      const keyEvents = parseStringArray(args.key_events ?? args.keyEvents);
      const snapshots = parseCharacterSnapshots(args.character_snapshots ?? args.characterSnapshots, volume, arc);
      const styleRules = parseStyleRules(args.style_rules ?? args.styleRules, volume, arc);

      const path = arcSummaryPath(volume, arc);
      const existing = await readJson<ArcSummary>(store, path);
      const record: ArcSummary = { volume, arc, title, summary };
      if (keyEvents.length > 0) {
        record.keyEvents = keyEvents;
      }
      if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
        throw new Error(`第 ${volume} 卷第 ${arc} 弧摘要已存在但内容不同，拒绝覆盖`);
      }
      if (!existing) {
        await writeJson(store, path, record);
      }
      if (snapshots.length > 0) {
        await writeJson(store, characterSnapshotPath(volume, arc), snapshots);
      }
      if (styleRules) {
        await writeJson(store, "meta/style_rules.json", styleRules);
      }
      await appendCheckpoint(store, "arc_summary", path);
      return {
        saved: true,
        type: "arc_summary",
        volume,
        arc,
        snapshots: snapshots.length,
        style_rules_saved: styleRules != null,
      };
    },
  };
}

function saveVolumeSummaryTool(store: StorePort): Tool {
  return {
    name: "save_volume_summary",
    description: "保存卷级摘要（卷结束时调用）",
    async execute(args) {
      const volume = asNumber(args, "volume");
      if (volume <= 0) {
        throw new Error("volume must be > 0");
      }
      const title = asString(args, "title").trim();
      const summary = asString(args, "summary").trim();
      if (title === "" || summary === "") {
        throw new Error("title and summary are required");
      }
      const keyEvents = parseStringArray(args.key_events ?? args.keyEvents);
      const path = volumeSummaryPath(volume);
      const record: VolumeSummary = { volume, title, summary };
      if (keyEvents.length > 0) {
        record.keyEvents = keyEvents;
      }
      const existing = await readJson<VolumeSummary>(store, path);
      if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
        throw new Error(`卷 ${volume} 摘要已存在且内容不同，拒绝覆盖`);
      }
      if (!existing) {
        await writeJson(store, path, record);
      }
      await appendCheckpoint(store, "volume_summary", path);

      const result: Record<string, unknown> = { saved: true, type: "volume_summary", volume };
      if (await maybeCompleteFinalVolume(store)) {
        result.book_complete = true;
      }
      return result;
    },
  };
}

function parseReviewIssues(raw: unknown): ReviewIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    const row = asRecord(item);
    const issue: ReviewIssue = {};
    if (typeof row.type === "string") {
      issue.type = row.type;
    }
    if (typeof row.severity === "string") {
      issue.severity = row.severity;
    }
    if (typeof row.description === "string") {
      issue.description = row.description;
    }
    if (typeof row.evidence === "string") {
      issue.evidence = row.evidence;
    }
    if (typeof row.suggestion === "string") {
      issue.suggestion = row.suggestion;
    }
    if (Array.isArray(row.chapters)) {
      issue.chapters = row.chapters.filter((value): value is number => typeof value === "number");
    }
    if (row.requires_change === true || row.requiresChange === true) {
      issue.requiresChange = true;
    }
    return issue;
  });
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function parseCharacterSnapshots(raw: unknown, volume: number, arc: number): unknown[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    const row = asRecord(item);
    return {
      volume,
      arc,
      name: typeof row.name === "string" ? row.name : "",
      status: typeof row.status === "string" ? row.status : "",
      motivation: typeof row.motivation === "string" ? row.motivation : "",
      power: typeof row.power === "string" ? row.power : "",
      relations: typeof row.relations === "string" ? row.relations : "",
    };
  });
}

function parseStyleRules(
  raw: unknown,
  volume: number,
  arc: number,
): Record<string, unknown> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const prose = parseStringArray(row.prose);
  if (prose.length === 0) {
    return null;
  }
  return { volume, arc, prose, dialogue: Array.isArray(row.dialogue) ? row.dialogue : [], taboos: parseStringArray(row.taboos) };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

async function maybeCompleteFinalVolume(store: StorePort): Promise<boolean> {
  const progress = await requireProgress(store);
  if (!progress.layered || progress.pendingRewrites.length > 0 || progress.phase !== "writing") {
    return false;
  }
  const volumes = await loadLayeredOutline(store);
  if (volumes == null) {
    return false;
  }
  const last = volumes[volumes.length - 1];
  if (last?.final !== true) {
    return false;
  }
  const outlined = flattenOutline(volumes).length;
  if (nextChapter(progress) <= outlined) {
    return false;
  }
  validatePhaseTransition(progress.phase, "complete");
  await store.saveProgress({ ...progress, phase: "complete" });
  await appendCheckpoint(store, "complete_book", PATHS.progress);
  return true;
}
