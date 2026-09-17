import {
  BookNotFoundError,
  ChapterConflictError,
  ChapterRunnerError,
  FoundationGenerateError,
  FoundationIncompleteError,
  SessionBusyError,
  SessionClosedError,
  SessionLlmRequiredError,
  WorkspaceClosedError,
} from "./errors.js";
import { CHAPTER_WRITE_MODES, type FoundationGap } from "./types.js";
import type { Progress } from "../domain/progress.js";
import type {
  AutoWriteResult,
  ChapterView,
  ChapterWriteInput,
  ChapterWriteResult,
  FoundationMeta,
  FoundationPatch,
  GenerateFoundationOptions,
  InspectResult,
  SessionEvent,
  StartAutoWriteOptions,
} from "./types.js";

/** Protocol version on every session host ↔ worker message. Distinct `ns` from Engine. */
export const SESSION_PROTOCOL = 1 as const;
export const SESSION_NS = "session" as const;

export type { MessagePortLike } from "../host/client.js";

export type SessionCommandType =
  | "inspectFoundation"
  | "getFoundation"
  | "getProgress"
  | "assertReadyToWrite"
  | "listArtifacts"
  | "exportSnapshot"
  | "importSnapshot"
  | "upsertFoundation"
  | "generateFoundation"
  | "startAutoWrite"
  | "chapterGet"
  | "chapterSaveFinal"
  | "chapterWrite"
  | "close";

export type SessionNoticeType = "result" | "event" | "error";

interface SessionEnvelope {
  v: typeof SESSION_PROTOCOL;
  ns: typeof SESSION_NS;
  id: string;
}

export type SessionInspectCommand = SessionEnvelope & {
  type: "inspectFoundation";
  prompt?: string;
};
export type SessionGetFoundationCommand = SessionEnvelope & { type: "getFoundation" };
export type SessionGetProgressCommand = SessionEnvelope & { type: "getProgress" };
export type SessionAssertReadyCommand = SessionEnvelope & {
  type: "assertReadyToWrite";
  prompt?: string;
};
export type SessionListArtifactsCommand = SessionEnvelope & {
  type: "listArtifacts";
  prefix?: string;
};
export type SessionExportSnapshotCommand = SessionEnvelope & { type: "exportSnapshot" };
export type SessionImportSnapshotCommand = SessionEnvelope & {
  type: "importSnapshot";
  bytes: Uint8Array;
};
export type SessionUpsertCommand = SessionEnvelope & {
  type: "upsertFoundation";
  patch: FoundationPatch;
};
export type SessionGenerateCommand = SessionEnvelope & {
  type: "generateFoundation";
  options: GenerateFoundationOptions;
};
export type SessionAutoWriteCommand = SessionEnvelope & {
  type: "startAutoWrite";
  options: StartAutoWriteOptions;
};
export type SessionChapterGetCommand = SessionEnvelope & {
  type: "chapterGet";
  chapter: number;
};
export type SessionChapterSaveFinalCommand = SessionEnvelope & {
  type: "chapterSaveFinal";
  chapter: number;
  markdown: string;
};
export type SessionChapterWriteCommand = SessionEnvelope & {
  type: "chapterWrite";
  input: ChapterWriteInput;
};
export type SessionCloseCommand = SessionEnvelope & { type: "close" };

export type SessionCommand =
  | SessionInspectCommand
  | SessionGetFoundationCommand
  | SessionGetProgressCommand
  | SessionAssertReadyCommand
  | SessionListArtifactsCommand
  | SessionExportSnapshotCommand
  | SessionImportSnapshotCommand
  | SessionUpsertCommand
  | SessionGenerateCommand
  | SessionAutoWriteCommand
  | SessionChapterGetCommand
  | SessionChapterSaveFinalCommand
  | SessionChapterWriteCommand
  | SessionCloseCommand;

export type SessionResultNotice = {
  v: typeof SESSION_PROTOCOL;
  ns: typeof SESSION_NS;
  type: "result";
  id: string;
  result: unknown;
};

export type SessionEventNotice = {
  v: typeof SESSION_PROTOCOL;
  ns: typeof SESSION_NS;
  type: "event";
  event: SessionEvent;
};

export type SessionErrorNotice = {
  v: typeof SESSION_PROTOCOL;
  ns: typeof SESSION_NS;
  type: "error";
  id?: string;
  name: string;
  message: string;
  gaps?: FoundationGap[];
  chapter?: number;
  bookId?: string;
};

export type SessionNotice = SessionResultNotice | SessionEventNotice | SessionErrorNotice;

export type SessionRpcResult = {
  inspectFoundation: InspectResult;
  getFoundation: FoundationMeta;
  getProgress: Progress | null;
  assertReadyToWrite: null;
  listArtifacts: string[];
  exportSnapshot: Uint8Array;
  importSnapshot: null;
  upsertFoundation: FoundationMeta;
  generateFoundation: FoundationMeta;
  startAutoWrite: AutoWriteResult;
  chapterGet: ChapterView | null;
  chapterSaveFinal: null;
  chapterWrite: ChapterWriteResult;
  close: null;
};

export function isSessionCommand(value: unknown): value is SessionCommand {
  if (!isEnvelope(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "inspectFoundation":
    case "assertReadyToWrite":
      return value.prompt === undefined || typeof value.prompt === "string";
    case "getFoundation":
    case "getProgress":
    case "exportSnapshot":
    case "close":
      return true;
    case "listArtifacts":
      return value.prefix === undefined || typeof value.prefix === "string";
    case "importSnapshot":
      return value.bytes instanceof Uint8Array;
    case "upsertFoundation":
      return isRecord(value.patch);
    case "generateFoundation":
      return isGenerateOptions(value.options);
    case "startAutoWrite":
      return isAutoWriteOptions(value.options);
    case "chapterGet":
      return typeof value.chapter === "number";
    case "chapterSaveFinal":
      return typeof value.chapter === "number" && typeof value.markdown === "string";
    case "chapterWrite":
      return isChapterWriteInput(value.input);
    default:
      return false;
  }
}

export function isSessionNotice(value: unknown): value is SessionNotice {
  if (!isRecord(value) || value.v !== SESSION_PROTOCOL || value.ns !== SESSION_NS) {
    return false;
  }
  if (value.id !== undefined && typeof value.id !== "string") {
    return false;
  }
  switch (value.type) {
    case "result":
      return typeof value.id === "string";
    case "event":
      return isRecord(value.event) && typeof value.event.type === "string";
    case "error":
      return typeof value.name === "string" && typeof value.message === "string";
    default:
      return false;
  }
}

export function serializeSessionError(err: unknown): {
  name: string;
  message: string;
  gaps?: FoundationGap[];
  chapter?: number;
  bookId?: string;
} {
  if (err instanceof FoundationIncompleteError) {
    return { name: err.name, message: err.message, gaps: err.gaps };
  }
  if (err instanceof ChapterConflictError) {
    return { name: err.name, message: err.message, chapter: err.chapter };
  }
  if (err instanceof BookNotFoundError) {
    return { name: err.name, message: err.message, bookId: err.bookId };
  }
  if (err instanceof Error) {
    return { name: err.name === "" ? "Error" : err.name, message: err.message };
  }
  return { name: "Error", message: String(err) };
}

export function restoreSessionError(payload: {
  name: string;
  message: string;
  gaps?: FoundationGap[];
  chapter?: number;
  bookId?: string;
}): Error {
  switch (payload.name) {
    case "FoundationIncompleteError":
      return new FoundationIncompleteError(payload.gaps ?? []);
    case "SessionBusyError":
      return new SessionBusyError(payload.message);
    case "SessionClosedError":
      return new SessionClosedError(payload.message);
    case "SessionLlmRequiredError":
      return new SessionLlmRequiredError(payload.message);
    case "FoundationGenerateError":
      return new FoundationGenerateError(payload.message);
    case "ChapterConflictError":
      return new ChapterConflictError(payload.chapter ?? 0, payload.message);
    case "ChapterRunnerError":
      return new ChapterRunnerError(payload.message);
    case "WorkspaceClosedError":
      return new WorkspaceClosedError(payload.message);
    case "BookNotFoundError":
      return new BookNotFoundError(payload.bookId ?? payload.message);
    default: {
      const err = new Error(payload.message);
      err.name = payload.name;
      return err;
    }
  }
}

function isEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.v === SESSION_PROTOCOL &&
    value.ns === SESSION_NS &&
    typeof value.id === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGenerateOptions(value: unknown): value is GenerateFoundationOptions {
  if (!isRecord(value) || typeof value.prompt !== "string" || !Array.isArray(value.keys)) {
    return false;
  }
  if (!value.keys.every((key) => typeof key === "string")) {
    return false;
  }
  return value.mode === undefined || value.mode === "fill_missing" || value.mode === "overwrite";
}

function isAutoWriteOptions(value: unknown): value is StartAutoWriteOptions {
  if (!isRecord(value) || typeof value.prompt !== "string") {
    return false;
  }
  if (value.foundation !== undefined && !isRecord(value.foundation)) {
    return false;
  }
  if (value.generateMissing !== undefined && typeof value.generateMissing !== "boolean") {
    return false;
  }
  if (value.requireConfirmGaps !== undefined && typeof value.requireConfirmGaps !== "boolean") {
    return false;
  }
  if (value.maxSteps !== undefined && typeof value.maxSteps !== "number") {
    return false;
  }
  return true;
}

function isChapterWriteInput(value: unknown): value is ChapterWriteInput {
  if (!isRecord(value) || typeof value.chapter !== "number" || typeof value.mode !== "string") {
    return false;
  }
  if (!(CHAPTER_WRITE_MODES as readonly string[]).includes(value.mode)) {
    return false;
  }
  if (value.instruction !== undefined && typeof value.instruction !== "string") {
    return false;
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    return false;
  }
  if (value.force !== undefined && typeof value.force !== "boolean") {
    return false;
  }
  return true;
}
