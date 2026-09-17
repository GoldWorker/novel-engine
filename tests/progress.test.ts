import { describe, expect, it } from "vitest";
import {
  REVIEW_INTERVAL,
  isResumable,
  latestCompleted,
  nextChapter,
  plannerForTier,
  shouldReview,
  type Progress,
} from "../src/index.js";

const progress = (partial: Partial<Progress> = {}): Progress => ({
  phase: "writing",
  flow: "writing",
  totalChapters: 10,
  completedChapters: [],
  pendingRewrites: [],
  layered: false,
  ...partial,
});

describe("progress helpers", () => {
  it("latestCompleted is 0 when nothing is done", () => {
    expect(latestCompleted(progress())).toBe(0);
  });

  it("latestCompleted uses the max, not the last list entry", () => {
    expect(latestCompleted(progress({ completedChapters: [2, 5, 3] }))).toBe(5);
  });

  it("nextChapter is latestCompleted + 1", () => {
    expect(nextChapter(progress())).toBe(1);
    expect(nextChapter(progress({ completedChapters: [1, 2, 3] }))).toBe(4);
  });

  it("isResumable only when writing with a current chapter", () => {
    expect(isResumable(progress({ currentChapter: 3 }))).toBe(true);
    expect(isResumable(progress({ phase: "outline", currentChapter: 3 }))).toBe(
      false,
    );
    expect(isResumable(progress())).toBe(false);
  });
});

describe("plannerForTier", () => {
  it("maps short → architect_short; mid/long/empty → architect_long", () => {
    expect(plannerForTier("short")).toBe("architect_short");
    expect(plannerForTier("mid")).toBe("architect_long");
    expect(plannerForTier("long")).toBe("architect_long");
    expect(plannerForTier("")).toBe("architect_long");
    expect(plannerForTier(undefined)).toBe("architect_long");
  });
});

describe("shouldReview", () => {
  it(`is due every ${REVIEW_INTERVAL} completed chapters`, () => {
    expect(shouldReview(0)).toEqual({ due: false, reason: "" });
    expect(shouldReview(4).due).toBe(false);
    expect(shouldReview(5)).toEqual({
      due: true,
      reason: "已完成 5 章，触发全局审阅",
    });
    expect(shouldReview(10).due).toBe(true);
  });
});
