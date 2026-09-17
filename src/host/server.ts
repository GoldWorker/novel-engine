import { createEngine, type Engine, type EngineDeps } from "../engine/index.js";
import type { MessagePortLike } from "./client.js";
import {
  ENGINE_PROTOCOL,
  isEngineCommand,
  loopEventToHost,
  type EngineErrorNotice,
  type EngineEventNotice,
  type EngineNotice,
} from "./protocol.js";

export type EngineWorkerPorts = EngineDeps;

export interface EngineWorkerOptions {
  /**
   * Build StorePort + LlmPort (and optional Engine deps) inside the worker.
   * Called once, the first time a command needs an Engine.
   */
  createPorts: () => EngineWorkerPorts | Promise<EngineWorkerPorts>;
}

/**
 * Worker-side host: constructs `Engine` with injected ports and answers the
 * typed command protocol. Pass `self` from a Dedicated Worker module.
 */
export function attachEngineWorker(
  port: MessagePortLike,
  options: EngineWorkerOptions,
): { detach: () => void } {
  let engine: Engine | null = null;
  let starting = false;

  const onMessage = (event: { data: unknown }): void => {
    void handle(event.data);
  };
  port.addEventListener("message", onMessage);

  async function ensureEngine(): Promise<Engine> {
    if (engine) {
      return engine;
    }
    const deps = await options.createPorts();
    const userOnEvent = deps.onEvent;
    const nextDeps: EngineDeps = {
      store: deps.store,
      llm: deps.llm,
      onEvent: (event) => {
        userOnEvent?.(event);
        post({
          v: ENGINE_PROTOCOL,
          type: "event",
          event: loopEventToHost(event),
        });
      },
    };
    if (deps.maxSteps !== undefined) {
      nextDeps.maxSteps = deps.maxSteps;
    }
    if (deps.maxWorkerTurns !== undefined) {
      nextDeps.maxWorkerTurns = deps.maxWorkerTurns;
    }
    engine = createEngine(nextDeps);
    return engine;
  }

  function post(notice: EngineNotice): void {
    port.postMessage(notice);
  }

  function postError(id: string | undefined, message: string): void {
    const notice: EngineErrorNotice = { v: ENGINE_PROTOCOL, type: "error", message };
    if (id !== undefined) {
      notice.id = id;
    }
    post(notice);
  }

  async function handle(data: unknown): Promise<void> {
    if (!isEngineCommand(data)) {
      postError(undefined, "invalid engine command");
      return;
    }
    try {
      switch (data.type) {
        case "start": {
          const current = await ensureEngine();
          if (current.isRunning || starting) {
            postError(data.id, "engine is already running");
            return;
          }
          starting = true;
          const started: EngineEventNotice = {
            v: ENGINE_PROTOCOL,
            type: "event",
            event:
              data.prompt !== undefined
                ? { kind: "started", prompt: data.prompt }
                : { kind: "started" },
          };
          post(started);
          try {
            const input: { prompt?: string; maxSteps?: number } = {};
            if (data.prompt !== undefined) {
              input.prompt = data.prompt;
            }
            if (data.maxSteps !== undefined) {
              input.maxSteps = data.maxSteps;
            }
            const result = await current.run(input);
            const snap = await current.snapshot();
            post({
              v: ENGINE_PROTOCOL,
              type: "snapshot",
              id: data.id,
              state: snap.state,
              result,
              running: snap.running,
              paused: snap.paused,
            });
          } finally {
            starting = false;
          }
          return;
        }
        case "pause": {
          const current = await ensureEngine();
          current.pause();
          post({
            v: ENGINE_PROTOCOL,
            type: "event",
            id: data.id,
            event: { kind: "paused" },
          });
          return;
        }
        case "resume": {
          const current = await ensureEngine();
          await current.resume();
          post({
            v: ENGINE_PROTOCOL,
            type: "event",
            id: data.id,
            event: { kind: "resumed" },
          });
          return;
        }
        case "steer": {
          const current = await ensureEngine();
          await current.steer(data.note);
          post({
            v: ENGINE_PROTOCOL,
            type: "event",
            id: data.id,
            event: { kind: "steered", note: data.note },
          });
          return;
        }
        case "snapshot": {
          const current = await ensureEngine();
          const snap = await current.snapshot();
          post({
            v: ENGINE_PROTOCOL,
            type: "snapshot",
            id: data.id,
            state: snap.state,
            result: snap.result,
            running: snap.running,
            paused: snap.paused,
          });
        }
      }
    } catch (err) {
      postError(data.id, err instanceof Error ? err.message : String(err));
    }
  }

  return {
    detach() {
      port.removeEventListener("message", onMessage);
    },
  };
}
