export const FLOWS = [
  "writing",
  "reviewing",
  "rewriting",
  "polishing",
  "steering",
] as const;

export type Flow = (typeof FLOWS)[number];

/**
 * Flow transition table aligned with ainovel-cli `CanTransitionFlow`.
 *
 * writing   → reviewing / rewriting / polishing / steering / writing
 * reviewing → writing / rewriting / polishing / steering / reviewing
 * rewriting → writing / steering / rewriting
 * polishing → writing / steering / polishing
 * steering  → writing / reviewing / rewriting / polishing / steering
 *
 * Empty `from` is uninitialized and may move to any non-empty value.
 * Same-state is always allowed. Illegal jumps (e.g. rewriting → reviewing) fail.
 */
export function canTransitionFlow(from: string, to: string): boolean {
  if (to === "") {
    return false;
  }
  if (from === "" || from === to) {
    return true;
  }

  switch (from) {
    case "writing":
      return (
        to === "reviewing" ||
        to === "rewriting" ||
        to === "polishing" ||
        to === "steering"
      );
    case "reviewing":
      return (
        to === "writing" ||
        to === "rewriting" ||
        to === "polishing" ||
        to === "steering"
      );
    case "rewriting":
      return to === "writing" || to === "steering";
    case "polishing":
      return to === "writing" || to === "steering";
    case "steering":
      return (
        to === "writing" ||
        to === "reviewing" ||
        to === "rewriting" ||
        to === "polishing"
      );
    default:
      return false;
  }
}

export class FlowTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`invalid flow transition: "${from}" -> "${to}"`);
    this.name = "FlowTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function validateFlowTransition(from: string, to: string): void {
  if (!canTransitionFlow(from, to)) {
    throw new FlowTransitionError(from, to);
  }
}
