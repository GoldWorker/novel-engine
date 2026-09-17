import { describe, expect, it } from "vitest";
import phaseCases from "../fixtures/phase-transitions.json" with { type: "json" };
import {
  PHASES,
  PhaseTransitionError,
  canTransitionPhase,
  validatePhaseTransition,
} from "../src/index.js";

describe("canTransitionPhase (golden fixtures)", () => {
  it.each(phaseCases)("$from → $to = $ok", ({ from, to, ok }) => {
    expect(canTransitionPhase(from, to)).toBe(ok);
  });
});

describe("canTransitionPhase (forward-only table)", () => {
  it("allows skipping forward along init→complete", () => {
    for (let i = 0; i < PHASES.length; i++) {
      for (let j = i; j < PHASES.length; j++) {
        const from = PHASES[i]!;
        const to = PHASES[j]!;
        expect(canTransitionPhase(from, to), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it("rejects every rollback", () => {
    for (let i = 0; i < PHASES.length; i++) {
      for (let j = 0; j < i; j++) {
        const from = PHASES[i]!;
        const to = PHASES[j]!;
        expect(canTransitionPhase(from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });
});

describe("validatePhaseTransition", () => {
  it("throws PhaseTransitionError on rollback", () => {
    expect(() => validatePhaseTransition("complete", "writing")).toThrow(
      PhaseTransitionError,
    );
  });

  it("does not throw on a legal advance", () => {
    expect(() => validatePhaseTransition("outline", "writing")).not.toThrow();
  });
});
