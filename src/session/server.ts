import type { MessagePortLike } from "../host/client.js";
import {
  isSessionCommand,
  serializeSessionError,
  SESSION_NS,
  SESSION_PROTOCOL,
  type SessionErrorNotice,
  type SessionNotice,
} from "./protocol.js";
import type { NovelSession } from "./types.js";

export interface SessionWorkerOptions {
  /**
   * Build the same-thread `NovelSession` inside the worker (`StorePort` + `LlmPort`).
   * `LlmPort` should `fetch` a host BFF — do not embed vendor API keys in the worker.
   */
  createSession: () => NovelSession | Promise<NovelSession>;
}

/**
 * Worker-side adapter: one `NovelSession` (source of truth) answers the session
 * message protocol. Busy flags / ChapterRunner live on that session, not here.
 */
export function attachSessionWorker(
  port: MessagePortLike,
  options: SessionWorkerOptions,
): { detach: () => void } {
  let session: NovelSession | null = null;
  let unsubscribe: (() => void) | null = null;

  const onMessage = (event: { data: unknown }): void => {
    void handle(event.data);
  };
  port.addEventListener("message", onMessage);

  async function ensureSession(): Promise<NovelSession> {
    if (session) {
      return session;
    }
    const created = await options.createSession();
    session = created;
    unsubscribe = created.subscribe((sessionEvent) => {
      post({
        v: SESSION_PROTOCOL,
        ns: SESSION_NS,
        type: "event",
        event: sessionEvent,
      });
    });
    return created;
  }

  function post(notice: SessionNotice): void {
    port.postMessage(notice);
  }

  function postResult(id: string, result: unknown): void {
    post({ v: SESSION_PROTOCOL, ns: SESSION_NS, type: "result", id, result });
  }

  function postError(id: string | undefined, err: unknown): void {
    const payload = serializeSessionError(err);
    const notice: SessionErrorNotice = {
      v: SESSION_PROTOCOL,
      ns: SESSION_NS,
      type: "error",
      name: payload.name,
      message: payload.message,
    };
    if (id !== undefined) {
      notice.id = id;
    }
    if (payload.gaps !== undefined) {
      notice.gaps = payload.gaps;
    }
    if (payload.chapter !== undefined) {
      notice.chapter = payload.chapter;
    }
    if (payload.bookId !== undefined) {
      notice.bookId = payload.bookId;
    }
    post(notice);
  }

  async function handle(data: unknown): Promise<void> {
    if (!isSessionCommand(data)) {
      postError(undefined, new Error("invalid session command"));
      return;
    }
    try {
      if (data.type === "close") {
        session?.close();
        unsubscribe?.();
        unsubscribe = null;
        session = null;
        postResult(data.id, null);
        return;
      }
      const current = await ensureSession();
      switch (data.type) {
        case "inspectFoundation": {
          const inspectOpts = data.prompt !== undefined ? { prompt: data.prompt } : {};
          postResult(data.id, await current.inspectFoundation(inspectOpts));
          return;
        }
        case "getFoundation":
          postResult(data.id, await current.getFoundation());
          return;
        case "getProgress":
          postResult(data.id, await current.getProgress());
          return;
        case "assertReadyToWrite": {
          const assertOpts = data.prompt !== undefined ? { prompt: data.prompt } : {};
          await current.assertReadyToWrite(assertOpts);
          postResult(data.id, null);
          return;
        }
        case "listArtifacts":
          postResult(
            data.id,
            data.prefix !== undefined
              ? await current.listArtifacts(data.prefix)
              : await current.listArtifacts(),
          );
          return;
        case "exportSnapshot":
          postResult(data.id, await current.exportSnapshot());
          return;
        case "importSnapshot":
          await current.importSnapshot(data.bytes);
          postResult(data.id, null);
          return;
        case "upsertFoundation":
          postResult(data.id, await current.upsertFoundation(data.patch));
          return;
        case "generateFoundation":
          postResult(data.id, await current.generateFoundation(data.options));
          return;
        case "assessFoundationImpact":
          postResult(
            data.id,
            await current.assessFoundationImpact(data.patch, data.options ?? {}),
          );
          return;
        case "applyFoundationChange":
          postResult(data.id, await current.applyFoundationChange(data.options));
          return;
        case "startAutoWrite":
          postResult(data.id, await current.startAutoWrite(data.options));
          return;
        case "chapterGet":
          postResult(data.id, await current.chapter.get(data.chapter));
          return;
        case "chapterSaveFinal":
          await current.chapter.saveFinal(data.chapter, data.markdown);
          postResult(data.id, null);
          return;
        case "chapterWrite":
          postResult(data.id, await current.chapter.write(data.input));
          return;
      }
    } catch (err) {
      postError(data.id, err);
    }
  }

  return {
    detach() {
      port.removeEventListener("message", onMessage);
      unsubscribe?.();
      unsubscribe = null;
      session?.close();
      session = null;
    },
  };
}
