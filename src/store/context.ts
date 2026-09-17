import { latestCompleted } from "../domain/progress.js";
import type { StorePort } from "../ports/store.js";
import type { ArcSummary, ChapterSummary, VolumeSummary } from "./artifacts.js";
import { foundationFingerprint, foundationMissing } from "./foundation.js";
import { readJson, readText } from "./io.js";
import { loadLayeredOutline } from "./layered.js";
import {
  arcSummaryPath,
  chapterDraftPath,
  chapterFinalPath,
  chapterPlanPath,
  chapterSummaryPath,
  PATHS,
  volumeSummaryPath,
} from "./paths.js";

/** Recent chapter summaries kept in `novel_context` (no four-stage compressor). */
export const SLIDING_SUMMARY_WINDOW = 8;

export interface NovelContextArgs {
  chapter?: number;
}

/**
 * Lightweight context pack: progress, foundation, a sliding window of chapter
 * summaries, plus any arc/volume summaries already on disk.
 */
export async function assembleNovelContext(
  store: StorePort,
  args: NovelContextArgs = {},
): Promise<Record<string, unknown>> {
  const chapter = args.chapter;
  const progress = await store.loadProgress();
  const missing = await foundationMissing(store);
  let fingerprint: string | null = null;
  if (!missing.some((item) => item !== "foundation_audit")) {
    fingerprint = await foundationFingerprint(store);
  }

  const lastCompleted = progress ? latestCompleted(progress) : 0;
  const current = chapter !== undefined && chapter > 0 ? chapter : lastCompleted + 1;
  const layered = await loadLayeredOutline(store);

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
    chapter_summaries: await loadSlidingChapterSummaries(store, current),
    arc_summaries: await loadArcSummaries(store, layered),
    volume_summaries: await loadVolumeSummaries(store, layered),
  };

  if (layered) {
    context.layered_outline = layered.map((volume) => ({
      index: volume.index,
      title: volume.title,
      theme: volume.theme,
      final: volume.final === true,
      arcs: volume.arcs.map((arc) => ({
        index: arc.index,
        title: arc.title,
        goal: arc.goal,
        expanded: arc.chapters.length > 0,
        chapter_count: arc.chapters.length,
        estimated_chapters: arc.estimatedChapters ?? 0,
      })),
    }));
  }

  if (chapter !== undefined) {
    context.chapter = {
      number: chapter,
      plan: await readJson(store, chapterPlanPath(chapter)),
      draft: await readText(store, chapterDraftPath(chapter)),
      final: await readText(store, chapterFinalPath(chapter)),
    };
  }

  return context;
}

async function loadSlidingChapterSummaries(
  store: StorePort,
  current: number,
): Promise<ChapterSummary[]> {
  const summaries: ChapterSummary[] = [];
  const start = Math.max(current - SLIDING_SUMMARY_WINDOW, 1);
  for (let chapter = start; chapter < current; chapter++) {
    const summary = await readJson<ChapterSummary>(store, chapterSummaryPath(chapter));
    if (summary) {
      summaries.push(summary);
    }
  }
  return summaries;
}

async function loadArcSummaries(
  store: StorePort,
  volumes: Awaited<ReturnType<typeof loadLayeredOutline>>,
): Promise<ArcSummary[]> {
  if (!volumes) {
    return [];
  }
  const summaries: ArcSummary[] = [];
  for (const volume of volumes) {
    for (const arc of volume.arcs) {
      const summary = await readJson<ArcSummary>(store, arcSummaryPath(volume.index, arc.index));
      if (summary) {
        summaries.push(summary);
      }
    }
  }
  return summaries;
}

async function loadVolumeSummaries(
  store: StorePort,
  volumes: Awaited<ReturnType<typeof loadLayeredOutline>>,
): Promise<VolumeSummary[]> {
  if (!volumes) {
    return [];
  }
  const summaries: VolumeSummary[] = [];
  for (const volume of volumes) {
    const summary = await readJson<VolumeSummary>(store, volumeSummaryPath(volume.index));
    if (summary) {
      summaries.push(summary);
    }
  }
  return summaries;
}
