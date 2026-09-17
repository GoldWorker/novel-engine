import type { EngineLoopEvent, EngineResult } from "../engine/index.js";
import type { Instruction } from "../flow/instruction.js";
import type { State } from "../flow/state.js";

/** Protocol version carried on every host ↔ worker message. */
export const ENGINE_PROTOCOL = 1 as const;

export type EngineCommandType = "start" | "steer" | "pause" | "resume" | "snapshot";
export type EngineNoticeType = "event" | "snapshot" | "error";

export type EngineStartCommand = {
  v: typeof ENGINE_PROTOCOL;
  type: "start";
  id: string;
  prompt?: string;
  maxSteps?: number;
};

export type EngineSteerCommand = {
  v: typeof ENGINE_PROTOCOL;
  type: "steer";
  id: string;
  note: string;
};

export type EnginePauseCommand = {
  v: typeof ENGINE_PROTOCOL;
  type: "pause";
  id: string;
};

export type EngineResumeCommand = {
  v: typeof ENGINE_PROTOCOL;
  type: "resume";
  id: string;
};

export type EngineSnapshotCommand = {
  v: typeof ENGINE_PROTOCOL;
  type: "snapshot";
  id: string;
};

export type EngineCommand =
  | EngineStartCommand
  | EngineSteerCommand
  | EnginePauseCommand
  | EngineResumeCommand
  | EngineSnapshotCommand;

export type EngineHostEvent =
  | { kind: "started"; prompt?: string }
  | { kind: "step"; step: number; instruction: Instruction }
  | { kind: "paused" }
  | { kind: "resumed" }
  | { kind: "steered"; note: string }
  | { kind: "stopped"; result: EngineResult };

export type EngineEventNotice = {
  v: typeof ENGINE_PROTOCOL;
  type: "event";
  id?: string;
  event: EngineHostEvent;
};

export interface EngineSnapshot {
  state: State;
  result: EngineResult | null;
  running: boolean;
  paused: boolean;
}

export type EngineSnapshotNotice = {
  v: typeof ENGINE_PROTOCOL;
  type: "snapshot";
  id?: string;
} & EngineSnapshot;

export type EngineErrorNotice = {
  v: typeof ENGINE_PROTOCOL;
  type: "error";
  id?: string;
  message: string;
};

export type EngineNotice = EngineEventNotice | EngineSnapshotNotice | EngineErrorNotice;

export function isEngineCommand(value: unknown): value is EngineCommand {
  if (!isRecord(value) || value.v !== ENGINE_PROTOCOL || typeof value.id !== "string") {
    return false;
  }
  switch (value.type) {
    case "start":
      return (
        (value.prompt === undefined || typeof value.prompt === "string") &&
        (value.maxSteps === undefined || typeof value.maxSteps === "number")
      );
    case "steer":
      return typeof value.note === "string";
    case "pause":
    case "resume":
    case "snapshot":
      return true;
    default:
      return false;
  }
}

export function isEngineNotice(value: unknown): value is EngineNotice {
  if (!isRecord(value) || value.v !== ENGINE_PROTOCOL || typeof value.type !== "string") {
    return false;
  }
  if (value.id !== undefined && typeof value.id !== "string") {
    return false;
  }
  switch (value.type) {
    case "event":
      return isRecord(value.event) && typeof value.event.kind === "string";
    case "snapshot":
      return (
        isRecord(value.state) &&
        typeof value.running === "boolean" &&
        typeof value.paused === "boolean"
      );
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loopEventToHost(event: EngineLoopEvent): EngineHostEvent {
  switch (event.type) {
    case "step":
      return { kind: "step", step: event.step, instruction: event.instruction };
    case "paused":
      return { kind: "paused" };
    case "resumed":
      return { kind: "resumed" };
    case "steered":
      return { kind: "steered", note: event.note };
    case "stopped":
      return { kind: "stopped", result: event.result };
  }
}
