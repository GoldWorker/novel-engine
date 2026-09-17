import type { StorePort } from "../ports/store.js";
import type { Checkpoint, DecisionRecord } from "./artifacts.js";
import { appendJsonl, readJsonl } from "./io.js";
import { PATHS } from "./paths.js";

export async function appendCheckpoint(
  store: StorePort,
  step: string,
  artifact: string,
): Promise<Checkpoint> {
  const existing = await readJsonl<Checkpoint>(store, PATHS.checkpoints);
  let maxSeq = 0;
  for (const row of existing) {
    if (row.seq > maxSeq) {
      maxSeq = row.seq;
    }
  }
  const checkpoint: Checkpoint = {
    seq: maxSeq + 1,
    step,
    artifact,
    occurredAt: new Date().toISOString(),
  };
  await appendJsonl(store, PATHS.checkpoints, checkpoint);
  return checkpoint;
}

let decisionSeq = 0;

export async function appendDecision(
  store: StorePort,
  partial: {
    kind: string;
    decider: string;
    input?: string;
    reason?: string;
    decision?: unknown;
    error?: string;
  },
): Promise<DecisionRecord> {
  decisionSeq += 1;
  const record: DecisionRecord = {
    schemaVersion: 1,
    id: `d-${decisionSeq.toString().padStart(4, "0")}`,
    at: new Date().toISOString(),
    kind: partial.kind,
    decider: partial.decider,
  };
  if (partial.input !== undefined) {
    record.input = partial.input;
  }
  if (partial.reason !== undefined) {
    record.reason = partial.reason;
  }
  if (partial.decision !== undefined) {
    record.decision = partial.decision;
  }
  if (partial.error !== undefined) {
    record.error = partial.error;
  }
  await appendJsonl(store, PATHS.decisions, record);
  return record;
}
