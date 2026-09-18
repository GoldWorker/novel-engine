import type { Progress } from "../domain/progress.js";
import type { MessageListener, MessagePortLike } from "../host/client.js";
import { SessionClosedError } from "./errors.js";
import {
  isSessionNotice,
  restoreSessionError,
  SESSION_NS,
  SESSION_PROTOCOL,
  type SessionCommand,
  type SessionNotice,
} from "./protocol.js";
import type {
  ApplyFoundationChangeOptions,
  ApplyFoundationChangeResult,
  AssessFoundationImpactOptions,
  AutoWriteResult,
  BookControlResult,
  ChapterDeleteOptions,
  ChapterDeleteResult,
  ChapterRunner,
  ChapterView,
  ChapterWriteInput,
  ChapterWriteResult,
  FoundationImpactAssessment,
  FoundationMeta,
  FoundationPatch,
  GenerateFoundationOptions,
  InspectResult,
  NovelSession,
  SessionEvent,
  SessionRunState,
  SessionUnsubscribe,
  StartAutoWriteOptions,
} from "./types.js";
import { AbortedError, attachAbort } from "../abort.js";

export interface CreateSessionClientOptions {
  /** Must match the `bookId` of the worker-side `createNovelSession`. */
  bookId: string;
}

export interface SessionClient extends NovelSession {
  onNotice(handler: (notice: SessionNotice) => void): SessionUnsubscribe;
}

interface Pending {
  resolve: (notice: SessionNotice) => void;
  reject: (err: Error) => void;
}

/**
 * Main-thread adapter over `attachSessionWorker`. Implements `NovelSession` by
 * RPC; business rules stay in the worker's same-thread session.
 */
export function createSessionClient(
  port: MessagePortLike,
  options: CreateSessionClientOptions,
): SessionClient {
  const bookId = options.bookId.trim();
  if (bookId === "") {
    throw new Error("bookId must be a non-empty string");
  }

  const pending = new Map<string, Pending>();
  const noticeHandlers = new Set<(notice: SessionNotice) => void>();
  const eventHandlers = new Set<(event: SessionEvent) => void>();
  let seq = 0;
  let closed = false;

  const onMessage: MessageListener = (event) => {
    if (!isSessionNotice(event.data)) {
      return;
    }
    const data = event.data;
    for (const handler of noticeHandlers) {
      handler(data);
    }
    if (data.type === "event") {
      for (const handler of eventHandlers) {
        handler(data.event);
      }
      return;
    }
    if (data.type === "error" && data.id) {
      const waiter = pending.get(data.id);
      if (waiter) {
        pending.delete(data.id);
        waiter.reject(restoreSessionError(data));
      }
      return;
    }
    if (data.id) {
      const waiter = pending.get(data.id);
      if (waiter) {
        pending.delete(data.id);
        waiter.resolve(data);
      }
    }
  };

  port.addEventListener("message", onMessage);

  function nextId(): string {
    seq += 1;
    return `s-${seq}`;
  }

  function send(command: SessionCommand): Promise<SessionNotice> {
    if (closed) {
      return Promise.reject(new SessionClosedError());
    }
    return new Promise((resolve, reject) => {
      pending.set(command.id, { resolve, reject });
      port.postMessage(command);
    });
  }

  async function rpc<T>(command: SessionCommand): Promise<T> {
    const notice = await send(command);
    if (notice.type === "error") {
      throw restoreSessionError(notice);
    }
    if (notice.type !== "result") {
      throw new Error(`session rpc expected result, got ${notice.type}`);
    }
    return notice.result as T;
  }

  function envelope(): { v: typeof SESSION_PROTOCOL; ns: typeof SESSION_NS; id: string } {
    return { v: SESSION_PROTOCOL, ns: SESSION_NS, id: nextId() };
  }

  function cancelRpc(): Promise<BookControlResult> {
    return rpc({ ...envelope(), type: "cancel" });
  }

  async function withClientAbort<T>(
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) {
      throw new AbortedError();
    }
    const pending = run();
    const detach = attachAbort(signal, () => {
      void cancelRpc();
    });
    try {
      return await pending;
    } finally {
      detach();
    }
  }

  const chapter: ChapterRunner = {
    get(chapterNumber: number): Promise<ChapterView | null> {
      return rpc({ ...envelope(), type: "chapterGet", chapter: chapterNumber });
    },
    saveFinal(chapterNumber: number, markdown: string): Promise<void> {
      return rpc({
        ...envelope(),
        type: "chapterSaveFinal",
        chapter: chapterNumber,
        markdown,
      });
    },
    write(input: ChapterWriteInput): Promise<ChapterWriteResult> {
      return withClientAbort(input.signal, () =>
        rpc({ ...envelope(), type: "chapterWrite", input: stripSignal(input) }),
      );
    },
    delete(chapterNumber: number, options: ChapterDeleteOptions = {}): Promise<ChapterDeleteResult> {
      const command = { ...envelope(), type: "chapterDelete" as const, chapter: chapterNumber };
      if (options.syncOutline !== undefined) {
        return rpc({ ...command, options: { syncOutline: options.syncOutline } });
      }
      return rpc(command);
    },
  };

  const client: SessionClient = {
    bookId,
    chapter,
    getFoundation(): Promise<FoundationMeta> {
      return rpc({ ...envelope(), type: "getFoundation" });
    },
    getProgress(): Promise<Progress | null> {
      return rpc({ ...envelope(), type: "getProgress" });
    },
    inspectFoundation(inspectOpts: { prompt?: string } = {}): Promise<InspectResult> {
      const command = { ...envelope(), type: "inspectFoundation" as const };
      if (inspectOpts.prompt !== undefined) {
        return rpc({ ...command, prompt: inspectOpts.prompt });
      }
      return rpc(command);
    },
    assertReadyToWrite(assertOpts: { prompt?: string } = {}): Promise<void> {
      const command = { ...envelope(), type: "assertReadyToWrite" as const };
      if (assertOpts.prompt !== undefined) {
        return rpc({ ...command, prompt: assertOpts.prompt });
      }
      return rpc(command);
    },
    listArtifacts(prefix?: string): Promise<string[]> {
      const command = { ...envelope(), type: "listArtifacts" as const };
      if (prefix !== undefined) {
        return rpc({ ...command, prefix });
      }
      return rpc(command);
    },
    exportSnapshot(): Promise<Uint8Array> {
      return rpc({ ...envelope(), type: "exportSnapshot" });
    },
    importSnapshot(bytes: Uint8Array): Promise<void> {
      return rpc({ ...envelope(), type: "importSnapshot", bytes });
    },
    upsertFoundation(patch: FoundationPatch): Promise<FoundationMeta> {
      return rpc({ ...envelope(), type: "upsertFoundation", patch });
    },
    generateFoundation(generateOpts: GenerateFoundationOptions): Promise<FoundationMeta> {
      return withClientAbort(generateOpts.signal, () =>
        rpc({ ...envelope(), type: "generateFoundation", options: stripSignal(generateOpts) }),
      );
    },
    assessFoundationImpact(
      patch: FoundationPatch,
      assessOpts: AssessFoundationImpactOptions = {},
    ): Promise<FoundationImpactAssessment> {
      const command = { ...envelope(), type: "assessFoundationImpact" as const, patch };
      if (assessOpts.refineWithLlm !== undefined) {
        return rpc({ ...command, options: { refineWithLlm: assessOpts.refineWithLlm } });
      }
      return rpc(command);
    },
    applyFoundationChange(
      applyOpts: ApplyFoundationChangeOptions,
    ): Promise<ApplyFoundationChangeResult> {
      return rpc({ ...envelope(), type: "applyFoundationChange", options: applyOpts });
    },
    startAutoWrite(writeOpts: StartAutoWriteOptions): Promise<AutoWriteResult> {
      return withClientAbort(writeOpts.signal, () =>
        rpc({ ...envelope(), type: "startAutoWrite", options: stripSignal(writeOpts) }),
      );
    },
    pause(): Promise<BookControlResult> {
      return rpc({ ...envelope(), type: "pause" });
    },
    resume(): Promise<BookControlResult> {
      return rpc({ ...envelope(), type: "resume" });
    },
    steer(note: string): Promise<BookControlResult> {
      return rpc({ ...envelope(), type: "steer", note });
    },
    cancel(): Promise<BookControlResult> {
      return cancelRpc();
    },
    getRunState(): Promise<SessionRunState> {
      return rpc({ ...envelope(), type: "getRunState" });
    },
    subscribe(listener: (event: SessionEvent) => void): SessionUnsubscribe {
      if (closed) {
        throw new SessionClosedError();
      }
      eventHandlers.add(listener);
      return () => {
        eventHandlers.delete(listener);
      };
    },
    onNotice(handler: (notice: SessionNotice) => void): SessionUnsubscribe {
      if (closed) {
        throw new SessionClosedError();
      }
      noticeHandlers.add(handler);
      return () => {
        noticeHandlers.delete(handler);
      };
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      try {
        port.postMessage({ ...envelope(), type: "close" });
      } catch {
        // Port may already be gone.
      }
      port.removeEventListener("message", onMessage);
      for (const waiter of pending.values()) {
        waiter.reject(new SessionClosedError());
      }
      pending.clear();
      noticeHandlers.clear();
      eventHandlers.clear();
    },
  };

  return client;
}

function stripSignal<T extends { signal?: AbortSignal }>(value: T): Omit<T, "signal"> {
  const { signal: _signal, ...rest } = value;
  return rest;
}
