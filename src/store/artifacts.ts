import type { AgentId, Flow, PlanningTier } from "../domain/index.js";

export interface BookMetadata {
  title: string;
  synopsis: string;
}

export interface OutlineEntry {
  chapter: number;
  title: string;
  summary?: string;
}

export interface Character {
  name: string;
  role?: string;
  bio?: string;
}

export interface WorldRule {
  name: string;
  description: string;
}

export interface ChapterPlan {
  chapter: number;
  title: string;
  goal: string;
  conflict: string;
  hook: string;
  notes?: string;
}

export interface FoundationAudit {
  fingerprint: string;
  ready: boolean;
  summary: string;
  issues: readonly FoundationAuditIssue[];
}

export interface FoundationAuditIssue {
  artifact: string;
  description: string;
  evidence: string;
}

export interface Checkpoint {
  seq: number;
  step: string;
  artifact: string;
  occurredAt: string;
}

export interface DecisionRecord {
  schemaVersion: number;
  id: string;
  at: string;
  kind: string;
  decider: string;
  input?: string;
  reason?: string;
  decision?: unknown;
  error?: string;
}

export interface PlanStartRecord {
  rawPrompt: string;
  planner: AgentId;
  plannerTask: string;
  decisionId: string;
}

export interface PendingSteer {
  note: string;
  previousFlow: Flow;
}

export interface RunMeta {
  startPrompt?: string;
  planningTier?: PlanningTier | "";
  planStart?: PlanStartRecord;
  /** Host steer in flight; cleared when the engine resumes. */
  pendingSteer?: PendingSteer;
}
