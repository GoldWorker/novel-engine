import type { AgentId } from "../domain/agents.js";

/**
 * Deterministic worker instruction produced by `route`.
 * `chapter` is omitted for architect/editor tasks (Go uses 0).
 */
export interface Instruction {
  agent: AgentId;
  task: string;
  reason: string;
  chapter?: number;
}

export type AggregateKind =
  | "arc_review"
  | "arc_summary"
  | "volume_summary"
  | "global_review";

export interface AggregateRefresh {
  kind: AggregateKind;
  volume: number;
  arc: number;
  startChapter: number;
  endChapter: number;
}
