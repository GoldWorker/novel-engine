import type { AgentId, Flow, PlanningTier } from "../domain/index.js";

export interface BookMetadata {
  title: string;
  synopsis: string;
}

export interface OutlineEntry {
  chapter: number;
  title: string;
  summary?: string;
  coreEvent?: string;
  hook?: string;
  scenes?: readonly string[];
}

/** Volume-level outline (layered mid/long books). */
export interface VolumeOutline {
  index: number;
  title: string;
  theme: string;
  final?: boolean;
  arcs: ArcOutline[];
}

/** Arc-level outline. Skeleton arcs have `estimatedChapters` and empty `chapters`. */
export interface ArcOutline {
  index: number;
  title: string;
  goal: string;
  estimatedChapters?: number;
  chapters: OutlineEntry[];
}

/** Architect payload for `expand_next_arc`. */
export interface ArcExpansion {
  title: string;
  goal: string;
  chapters: OutlineEntry[];
}

export interface ChapterSummary {
  chapter: number;
  title: string;
  summary: string;
  characters?: readonly string[];
  keyEvents?: readonly string[];
}

export interface ArcSummary {
  volume: number;
  arc: number;
  title: string;
  summary: string;
  keyEvents?: readonly string[];
}

export interface VolumeSummary {
  volume: number;
  title: string;
  summary: string;
  keyEvents?: readonly string[];
}

export interface CharacterSnapshot {
  volume?: number;
  arc?: number;
  name: string;
  status: string;
  power?: string;
  motivation: string;
  relations?: string;
}

export interface CharacterVoice {
  name: string;
  rules: readonly string[];
}

export interface WritingStyleRules {
  volume: number;
  arc: number;
  prose: readonly string[];
  dialogue: readonly CharacterVoice[];
  taboos?: readonly string[];
}

export interface ReviewIssue {
  type?: string;
  severity?: string;
  description?: string;
  evidence?: string;
  suggestion?: string;
  chapters?: readonly number[];
  requiresChange?: boolean;
}

export interface ReviewEntry {
  chapter: number;
  scope: string;
  summary: string;
  issues: readonly ReviewIssue[];
  verdict?: string;
  dimensions?: readonly unknown[];
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
