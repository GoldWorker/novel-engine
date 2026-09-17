/** Global review interval (every N completed chapters) — ainovel-cli `ReviewInterval`. */
export const REVIEW_INTERVAL = 5;

/**
 * Whether a non-layered book should trigger a global review at this completed count.
 * Matches ainovel-cli `ShouldReview`.
 */
export function shouldReview(completedCount: number): { due: boolean; reason: string } {
  if (completedCount > 0 && completedCount % REVIEW_INTERVAL === 0) {
    return {
      due: true,
      reason: `已完成 ${completedCount} 章，触发全局审阅`,
    };
  }
  return { due: false, reason: "" };
}
