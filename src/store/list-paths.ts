import type { StorePort } from "../ports/store.js";
import type { VolumeOutline } from "./artifacts.js";
import { readJson } from "./io.js";
import { normalizeStorePath } from "./normalize.js";
import {
  PATHS,
  arcReviewPath,
  arcSummaryPath,
  chapterDraftPath,
  chapterFinalPath,
  chapterPlanPath,
  chapterSummaryPath,
  characterSnapshotPath,
  globalReviewPath,
  volumeSummaryPath,
} from "./paths.js";

const CHAPTER_PROBE_MIN = 32;
const CHAPTER_PROBE_MAX = 512;
const VOLUME_PROBE = 8;
const ARC_PROBE = 8;

function hasList(
  store: StorePort,
): store is StorePort & { list: NonNullable<StorePort["list"]> } {
  return typeof store.list === "function";
}

function uniqueSorted(paths: Iterable<string>, prefix = ""): string[] {
  const set = new Set<string>();
  for (const path of paths) {
    const normalized = normalizeStorePath(path);
    if (prefix === "" || normalized.startsWith(prefix)) {
      set.add(normalized);
    }
  }
  return [...set].sort();
}

/**
 * Enumerate stored book paths.
 *
 * Prefers `StorePort.list` when the adapter implements it (`MemoryStore`,
 * `OpfsStore`). Otherwise probes known artifact paths from Progress / PATHS.
 */
export async function listStorePaths(store: StorePort, prefix = ""): Promise<string[]> {
  if (hasList(store)) {
    return uniqueSorted(await store.list(prefix), prefix);
  }
  return probeKnownBookPaths(store, prefix);
}

/** Walk the well-known book layout by `has()` — used when `list` is absent. */
export async function probeKnownBookPaths(
  store: StorePort,
  prefix = "",
): Promise<string[]> {
  const candidates = new Set<string>(Object.values(PATHS));
  const progress = await store.loadProgress();
  const fromProgress = Math.max(
    progress?.totalChapters ?? 0,
    progress?.currentChapter ?? 0,
    ...(progress?.completedChapters ?? []),
    ...(progress?.pendingRewrites ?? []),
  );
  const maxChapter = Math.min(
    Math.max(fromProgress, CHAPTER_PROBE_MIN),
    CHAPTER_PROBE_MAX,
  );

  for (let chapter = 1; chapter <= maxChapter; chapter += 1) {
    candidates.add(chapterPlanPath(chapter));
    candidates.add(chapterDraftPath(chapter));
    candidates.add(chapterFinalPath(chapter));
    candidates.add(globalReviewPath(chapter));
    candidates.add(arcReviewPath(chapter));
    candidates.add(chapterSummaryPath(chapter));
  }

  let volumes: VolumeOutline[] | null = null;
  try {
    volumes = await readJson<VolumeOutline[]>(store, PATHS.layeredOutline);
  } catch {
    volumes = null;
  }
  if (Array.isArray(volumes)) {
    for (const volume of volumes) {
      const v = volume.index > 0 ? volume.index : 0;
      if (v > 0) {
        candidates.add(volumeSummaryPath(v));
      }
      for (const arc of volume.arcs ?? []) {
        const a = arc.index > 0 ? arc.index : 0;
        if (v > 0 && a > 0) {
          candidates.add(arcSummaryPath(v, a));
          candidates.add(characterSnapshotPath(v, a));
        }
      }
    }
  }

  for (let volume = 1; volume <= VOLUME_PROBE; volume += 1) {
    candidates.add(volumeSummaryPath(volume));
    for (let arc = 1; arc <= ARC_PROBE; arc += 1) {
      candidates.add(arcSummaryPath(volume, arc));
      candidates.add(characterSnapshotPath(volume, arc));
    }
  }

  const found: string[] = [];
  for (const path of candidates) {
    if (prefix !== "" && !path.startsWith(prefix)) {
      continue;
    }
    if (await store.has(path)) {
      found.push(path);
    }
  }
  return found.sort();
}
