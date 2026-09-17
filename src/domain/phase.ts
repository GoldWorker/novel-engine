export const PHASES = ["init", "premise", "outline", "writing", "complete"] as const;

export type Phase = (typeof PHASES)[number];

const phaseOrder: Record<Phase, number> = {
  init: 1,
  premise: 2,
  outline: 3,
  writing: 4,
  complete: 5,
};

function isPhase(value: string): value is Phase {
  return value in phaseOrder;
}

/**
 * Forward-only Phase validation aligned with ainovel-cli `CanTransitionPhase`.
 *
 * init → premise → outline → writing → complete
 * (same-state is allowed; skipping forward is allowed; rollback is not)
 *
 * Empty `from` is treated as uninitialized and may move to any non-empty value.
 */
export function canTransitionPhase(from: string, to: string): boolean {
  if (to === "") {
    return false;
  }
  if (from === "" || from === to) {
    return true;
  }
  if (!isPhase(from) || !isPhase(to)) {
    return false;
  }
  return phaseOrder[to] >= phaseOrder[from];
}

export class PhaseTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`invalid phase transition: "${from}" -> "${to}"`);
    this.name = "PhaseTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function validatePhaseTransition(from: string, to: string): void {
  if (!canTransitionPhase(from, to)) {
    throw new PhaseTransitionError(from, to);
  }
}
