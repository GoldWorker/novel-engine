import { describe, expect, it } from "vitest";
import routeCases from "../fixtures/route-cases.json" with { type: "json" };
import { route, type Instruction, type State } from "../src/index.js";

describe("route (golden fixtures)", () => {
  it.each(routeCases)("$name", ({ state, expected }) => {
    expect(route(state as State)).toEqual(expected);
  });
});

describe("route purity", () => {
  it("does not mutate the input snapshot", () => {
    const state: State = {
      progress: {
        phase: "writing",
        flow: "writing",
        totalChapters: 20,
        completedChapters: [1, 2, 3],
        pendingRewrites: [],
        layered: false,
      },
      lastCompleted: 3,
    };
    const before = JSON.parse(JSON.stringify(state)) as State;
    const first = route(state);
    const second = route(state);
    expect(state).toEqual(before);
    expect(first).toEqual(second);
    expect(first).toMatchObject<Partial<Instruction>>({
      agent: "writer",
      chapter: 4,
    });
  });
});

describe("route required cases", () => {
  it("complete→null", () => {
    expect(
      route({
        progress: {
          phase: "complete",
          flow: "writing",
          totalChapters: 3,
          completedChapters: [1, 2, 3],
          pendingRewrites: [],
          layered: false,
        },
      }),
    ).toBeNull();
  });

  it("foundation missing→architect", () => {
    const got = route({
      progress: {
        phase: "outline",
        flow: "writing",
        totalChapters: 0,
        completedChapters: [],
        pendingRewrites: [],
        layered: false,
      },
      foundationMissing: ["characters"],
      planningTier: "long",
    });
    expect(got?.agent).toBe("architect_long");
  });

  it("pending rewrite→writer", () => {
    const got = route({
      progress: {
        phase: "writing",
        flow: "rewriting",
        totalChapters: 10,
        completedChapters: [1],
        pendingRewrites: [4],
        layered: false,
      },
    });
    expect(got).toMatchObject({ agent: "writer", chapter: 4 });
  });

  it("arc-end missing review→editor", () => {
    const got = route({
      progress: {
        phase: "writing",
        flow: "writing",
        totalChapters: 20,
        completedChapters: [8],
        pendingRewrites: [],
        layered: true,
      },
      lastCompleted: 8,
      arcBoundary: {
        isArcEnd: true,
        isVolumeEnd: false,
        volume: 1,
        arc: 1,
        startChapter: 1,
        endChapter: 8,
        nextVolume: 0,
        nextArc: 0,
        needsExpansion: false,
        needsNewVolume: false,
      },
    });
    expect(got?.agent).toBe("editor");
    expect(got?.reason).toBe("弧末评审未完成");
  });

  it("default next chapter→writer", () => {
    const got = route({
      progress: {
        phase: "writing",
        flow: "writing",
        totalChapters: 12,
        completedChapters: [1],
        pendingRewrites: [],
        layered: false,
      },
      lastCompleted: 1,
    });
    expect(got).toMatchObject({ agent: "writer", chapter: 2, task: "写第 2 章" });
  });

  it("steering→null", () => {
    expect(
      route({
        progress: {
          phase: "writing",
          flow: "steering",
          totalChapters: 12,
          completedChapters: [1],
          pendingRewrites: [],
          layered: false,
        },
      }),
    ).toBeNull();
  });
});
