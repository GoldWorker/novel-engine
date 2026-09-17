import { describe, expect, it } from "vitest";
import flowCases from "../fixtures/flow-transitions.json" with { type: "json" };
import {
  FLOWS,
  FlowTransitionError,
  canTransitionFlow,
  validateFlowTransition,
} from "../src/index.js";

const legal: Record<(typeof FLOWS)[number], ReadonlySet<string>> = {
  writing: new Set(["writing", "reviewing", "rewriting", "polishing", "steering"]),
  reviewing: new Set(["reviewing", "writing", "rewriting", "polishing", "steering"]),
  rewriting: new Set(["rewriting", "writing", "steering"]),
  polishing: new Set(["polishing", "writing", "steering"]),
  steering: new Set(["steering", "writing", "reviewing", "rewriting", "polishing"]),
};

describe("canTransitionFlow (golden fixtures)", () => {
  it.each(flowCases)("$from → $to = $ok", ({ from, to, ok }) => {
    expect(canTransitionFlow(from, to)).toBe(ok);
  });
});

describe("canTransitionFlow (illegal-transition table)", () => {
  it("matches the Go adjacency table for every pair", () => {
    for (const from of FLOWS) {
      for (const to of FLOWS) {
        expect(canTransitionFlow(from, to), `${from} → ${to}`).toBe(
          legal[from].has(to),
        );
      }
    }
  });
});

describe("validateFlowTransition", () => {
  it("throws FlowTransitionError on rewriting → reviewing", () => {
    expect(() => validateFlowTransition("rewriting", "reviewing")).toThrow(
      FlowTransitionError,
    );
  });
});
