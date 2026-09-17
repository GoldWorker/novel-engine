import type { ArcBoundary } from "../domain/arc-boundary.js";
import type { StorePort } from "../ports/store.js";
import type { ArcExpansion, ArcOutline, OutlineEntry, VolumeOutline } from "./artifacts.js";
import { readJson, writeJson } from "./io.js";
import { PATHS } from "./paths.js";

export function isArcExpanded(arc: ArcOutline): boolean {
  return arc.chapters.length > 0;
}

export function flattenOutline(volumes: readonly VolumeOutline[]): OutlineEntry[] {
  const result: OutlineEntry[] = [];
  let chapter = 1;
  for (const volume of volumes) {
    for (const arc of volume.arcs) {
      for (const entry of arc.chapters) {
        const next: OutlineEntry = { ...entry, chapter };
        if (next.summary === undefined && next.coreEvent) {
          next.summary = next.coreEvent;
        }
        result.push(next);
        chapter += 1;
      }
    }
  }
  return result;
}

/** Expanded arcs by real chapter count; skeleton arcs by estimatedChapters. */
export function estimatedChapterCapacity(volumes: readonly VolumeOutline[]): number {
  let total = 0;
  for (const volume of volumes) {
    for (const arc of volume.arcs) {
      total += isArcExpanded(arc) ? arc.chapters.length : (arc.estimatedChapters ?? 0);
    }
  }
  return total;
}

export function repairMissingLayeredIndexes(volumes: VolumeOutline[]): VolumeOutline[] {
  return volumes.map((volume, volumeIndex) => ({
    ...volume,
    index: volume.index > 0 ? volume.index : volumeIndex + 1,
    arcs: volume.arcs.map((arc, arcIndex) => ({
      ...arc,
      index: arc.index > 0 ? arc.index : arcIndex + 1,
    })),
  }));
}

export function numberVolume(volume: VolumeOutline, index: number): VolumeOutline {
  return {
    ...volume,
    index,
    arcs: volume.arcs.map((arc, arcIndex) => ({ ...arc, index: arcIndex + 1 })),
  };
}

/**
 * Arc / volume boundary of `chapter` in a layered outline.
 * Matches ainovel-cli `checkArcBoundary`: next-arc fields are only set at arc end.
 */
export function checkArcBoundary(
  volumes: readonly VolumeOutline[],
  chapter: number,
): ArcBoundary | null {
  type ArcPos = {
    volumeIndex: number;
    arcIndex: number;
    volume: number;
    arc: number;
    chapterInArc: number;
    arcLength: number;
    arcStart: number;
  };

  let cursor = 1;
  let current: ArcPos | null = null;
  for (let volumeIndex = 0; volumeIndex < volumes.length; volumeIndex++) {
    const volume = volumes[volumeIndex];
    if (!volume) {
      continue;
    }
    for (let arcIndex = 0; arcIndex < volume.arcs.length; arcIndex++) {
      const arc = volume.arcs[arcIndex];
      if (!arc) {
        continue;
      }
      const arcStart = cursor;
      for (let chapterInArc = 0; chapterInArc < arc.chapters.length; chapterInArc++) {
        if (cursor === chapter) {
          current = {
            volumeIndex,
            arcIndex,
            volume: volume.index,
            arc: arc.index,
            chapterInArc,
            arcLength: arc.chapters.length,
            arcStart,
          };
        }
        cursor += 1;
      }
    }
  }
  if (current == null) {
    return null;
  }

  const boundary: ArcBoundary = {
    isArcEnd: false,
    isVolumeEnd: false,
    volume: current.volume,
    arc: current.arc,
    startChapter: current.arcStart,
    endChapter: current.arcStart + current.arcLength - 1,
    nextVolume: 0,
    nextArc: 0,
    needsExpansion: false,
    needsNewVolume: false,
  };

  const isLastChapterInArc = current.chapterInArc === current.arcLength - 1;
  if (!isLastChapterInArc) {
    return boundary;
  }

  const volume = volumes[current.volumeIndex];
  boundary.isArcEnd = true;
  if (volume && current.arcIndex === volume.arcs.length - 1) {
    boundary.isVolumeEnd = true;
  }

  let found = false;
  for (let volumeIndex = current.volumeIndex; volumeIndex < volumes.length; volumeIndex++) {
    const nextVolume = volumes[volumeIndex];
    if (!nextVolume) {
      continue;
    }
    const startArc = volumeIndex === current.volumeIndex ? current.arcIndex + 1 : 0;
    for (let arcIndex = startArc; arcIndex < nextVolume.arcs.length; arcIndex++) {
      const nextArc = nextVolume.arcs[arcIndex];
      if (!nextArc) {
        continue;
      }
      boundary.nextVolume = nextVolume.index;
      boundary.nextArc = nextArc.index;
      boundary.needsExpansion = !isArcExpanded(nextArc);
      found = true;
      break;
    }
    if (found) {
      break;
    }
  }

  if (boundary.isVolumeEnd && !found) {
    boundary.needsNewVolume = true;
  }
  return boundary;
}

/** Story-order boundaries of fully written expanded arcs. */
export function completedArcBoundaries(
  volumes: readonly VolumeOutline[],
  lastCompleted: number,
): ArcBoundary[] {
  const result: ArcBoundary[] = [];
  let chapter = 1;
  for (const volume of volumes) {
    for (let arcIndex = 0; arcIndex < volume.arcs.length; arcIndex++) {
      const arc = volume.arcs[arcIndex];
      if (!arc || arc.chapters.length === 0) {
        continue;
      }
      const start = chapter;
      const end = start + arc.chapters.length - 1;
      chapter = end + 1;
      if (end > lastCompleted) {
        return result;
      }
      result.push({
        isArcEnd: true,
        isVolumeEnd: arcIndex === volume.arcs.length - 1,
        volume: volume.index,
        arc: arc.index,
        startChapter: start,
        endChapter: end,
        nextVolume: 0,
        nextArc: 0,
        needsExpansion: false,
        needsNewVolume: false,
      });
    }
  }
  return result;
}

export function expandArcAt(
  volumes: VolumeOutline[],
  lastCompleted: number,
  expansion: ArcExpansion,
): { volumes: VolumeOutline[]; volume: number; arc: number } {
  if (expansion.title.trim() === "") {
    throw new Error("弧标题不能为空");
  }
  if (expansion.goal.trim() === "") {
    throw new Error("弧目标不能为空");
  }
  if (expansion.chapters.length === 0) {
    throw new Error("展开弧必须至少包含一章");
  }

  const repaired = repairMissingLayeredIndexes(volumes);
  const boundary = checkArcBoundary(repaired, lastCompleted);
  if (boundary == null || !boundary.isArcEnd || boundary.nextArc <= 0) {
    throw new Error("当前进度不在弧末，无下一弧可展开");
  }

  const located = findArc(repaired, boundary.nextVolume, boundary.nextArc);
  if (located == null) {
    throw new Error(`找不到第 ${boundary.nextVolume} 卷第 ${boundary.nextArc} 弧`);
  }
  const target = located.arc;
  if (isArcExpanded(target)) {
    if (!sameExpansion(target, expansion)) {
      throw new Error(`arc already expanded: volume=${located.volume.index}, arc=${target.index}`);
    }
    return { volumes: repaired, volume: located.volume.index, arc: target.index };
  }

  located.volume.arcs[located.arcIndex] = {
    ...target,
    title: expansion.title,
    goal: expansion.goal,
    chapters: expansion.chapters.map((entry, index) => ({ ...entry, chapter: index + 1 })),
    estimatedChapters: 0,
  };
  return { volumes: repaired, volume: located.volume.index, arc: target.index };
}

export function appendVolumePlan(
  volumes: VolumeOutline[],
  incoming: VolumeOutline,
): { volumes: VolumeOutline[]; saved: VolumeOutline } {
  const repaired = repairMissingLayeredIndexes(volumes);
  const nextIndex = repaired.length > 0 ? (repaired[repaired.length - 1]?.index ?? 0) + 1 : 1;
  const numbered = numberVolume(incoming, nextIndex);
  if (numbered.arcs.length === 0) {
    throw new Error("新卷必须至少包含一个弧");
  }
  const firstArc = numbered.arcs[0];
  if (!firstArc || !isArcExpanded(firstArc)) {
    throw new Error("新卷的首弧必须包含详细章节");
  }

  const last = repaired[repaired.length - 1];
  if (last && sameVolumePlan(last, numbered)) {
    return { volumes: repaired, saved: last };
  }
  return { volumes: [...repaired, numbered], saved: numbered };
}

function findArc(
  volumes: VolumeOutline[],
  volumeIndex: number,
  arcIndex: number,
): { volume: VolumeOutline; arc: ArcOutline; arcIndex: number } | null {
  for (const volume of volumes) {
    if (volume.index !== volumeIndex) {
      continue;
    }
    for (let i = 0; i < volume.arcs.length; i++) {
      const arc = volume.arcs[i];
      if (arc && arc.index === arcIndex) {
        return { volume, arc, arcIndex: i };
      }
    }
  }
  return null;
}

function sameExpansion(arc: ArcOutline, expansion: ArcExpansion): boolean {
  if (arc.title !== expansion.title || arc.goal !== expansion.goal) {
    return false;
  }
  if (arc.chapters.length !== expansion.chapters.length) {
    return false;
  }
  for (let i = 0; i < arc.chapters.length; i++) {
    const left = arc.chapters[i];
    const right = expansion.chapters[i];
    if (!left || !right) {
      return false;
    }
    if (left.title !== right.title) {
      return false;
    }
    if ((left.coreEvent ?? left.summary ?? "") !== (right.coreEvent ?? right.summary ?? "")) {
      return false;
    }
  }
  return true;
}

function sameVolumePlan(left: VolumeOutline, right: VolumeOutline): boolean {
  const a = numberVolume(left, 1);
  const b = numberVolume(right, 1);
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function loadLayeredOutline(store: StorePort): Promise<VolumeOutline[] | null> {
  const raw = await readJson<VolumeOutline[]>(store, PATHS.layeredOutline);
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  return repairMissingLayeredIndexes(raw);
}

export async function saveLayeredViews(store: StorePort, volumes: VolumeOutline[]): Promise<void> {
  const repaired = repairMissingLayeredIndexes(volumes);
  await writeJson(store, PATHS.layeredOutline, repaired);
  await writeJson(store, PATHS.outline, flattenOutline(repaired));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("expected a JSON object");
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function pickNumber(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function parseJsonContent(content: unknown): unknown {
  if (typeof content === "string") {
    return JSON.parse(content) as unknown;
  }
  return content;
}

export function parseOutlineEntry(raw: unknown, fallbackChapter: number): OutlineEntry {
  const row = asRecord(raw);
  const chapter = pickNumber(row, "chapter") ?? fallbackChapter;
  const title = pickString(row, "title") ?? `第 ${chapter} 章`;
  const entry: OutlineEntry = { chapter, title };
  const summary = pickString(row, "summary");
  if (summary !== undefined) {
    entry.summary = summary;
  }
  const coreEvent = pickString(row, "coreEvent", "core_event");
  if (coreEvent !== undefined) {
    entry.coreEvent = coreEvent;
    if (entry.summary === undefined) {
      entry.summary = coreEvent;
    }
  }
  const hook = pickString(row, "hook");
  if (hook !== undefined) {
    entry.hook = hook;
  }
  const scenes = row.scenes;
  if (Array.isArray(scenes)) {
    entry.scenes = scenes.filter((item): item is string => typeof item === "string");
  }
  return entry;
}

export function parseArcOutline(raw: unknown, fallbackIndex: number): ArcOutline {
  const row = asRecord(raw);
  const title = pickString(row, "title") ?? `第 ${fallbackIndex} 弧`;
  const goal = pickString(row, "goal") ?? "";
  const chaptersRaw = row.chapters;
  const chapters = Array.isArray(chaptersRaw)
    ? chaptersRaw.map((item, index) => parseOutlineEntry(item, index + 1))
    : [];
  const arc: ArcOutline = {
    index: pickNumber(row, "index") ?? fallbackIndex,
    title,
    goal,
    chapters,
  };
  const estimated = pickNumber(row, "estimatedChapters", "estimated_chapters");
  if (estimated !== undefined) {
    arc.estimatedChapters = estimated;
  }
  return arc;
}

export function parseVolumeOutline(raw: unknown, fallbackIndex: number): VolumeOutline {
  const row = asRecord(raw);
  const title = pickString(row, "title") ?? `第 ${fallbackIndex} 卷`;
  const theme = pickString(row, "theme") ?? "";
  const arcsRaw = row.arcs;
  if (!Array.isArray(arcsRaw) || arcsRaw.length === 0) {
    throw new Error("volume must contain at least one arc");
  }
  const volume: VolumeOutline = {
    index: pickNumber(row, "index") ?? fallbackIndex,
    title,
    theme,
    arcs: arcsRaw.map((item, index) => parseArcOutline(item, index + 1)),
  };
  if (row.final === true) {
    volume.final = true;
  }
  return volume;
}

export function parseLayeredVolumes(content: unknown): VolumeOutline[] {
  const raw = parseJsonContent(content);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("layered_outline content must be a non-empty array of volumes");
  }
  return repairMissingLayeredIndexes(raw.map((item, index) => parseVolumeOutline(item, index + 1)));
}

export function parseArcExpansion(args: Record<string, unknown>): ArcExpansion {
  const title = pickString(args, "title");
  const goal = pickString(args, "goal");
  if (!title || title.trim() === "" || !goal || goal.trim() === "") {
    throw new Error("title and goal must be non-empty strings");
  }
  const chaptersRaw = args.chapters;
  if (!Array.isArray(chaptersRaw) || chaptersRaw.length === 0) {
    throw new Error("chapters must be a non-empty array");
  }
  return {
    title,
    goal,
    chapters: chaptersRaw.map((item, index) => parseOutlineEntry(item, index + 1)),
  };
}
