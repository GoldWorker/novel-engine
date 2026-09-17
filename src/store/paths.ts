/** Logical artifact paths. Mirrors ainovel-cli store layout without a filesystem. */
export const PATHS = {
  progress: "meta/progress.json",
  book: "meta/book.json",
  runMeta: "meta/run_meta.json",
  checkpoints: "meta/checkpoints.jsonl",
  decisions: "meta/decisions.jsonl",
  foundationAudit: "meta/foundation_audit.json",
  premise: "premise.md",
  outline: "outline.json",
  characters: "characters.json",
  worldRules: "world_rules.json",
} as const;

export function padChapter(chapter: number): string {
  return String(chapter).padStart(2, "0");
}

export function chapterPlanPath(chapter: number): string {
  return `drafts/${padChapter(chapter)}.plan.json`;
}

export function chapterDraftPath(chapter: number): string {
  return `drafts/${padChapter(chapter)}.draft.md`;
}

export function chapterFinalPath(chapter: number): string {
  return `chapters/${padChapter(chapter)}.md`;
}

export function globalReviewPath(chapter: number): string {
  return `reviews/global_${chapter}.json`;
}

export function arcReviewPath(chapter: number): string {
  return `reviews/arc_${chapter}.json`;
}
