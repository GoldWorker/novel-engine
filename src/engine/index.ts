import type { Flow } from "../domain/flow.js";
import { validateFlowTransition } from "../domain/flow.js";
import type { Phase } from "../domain/phase.js";
import type { Instruction } from "../flow/instruction.js";
import type { State } from "../flow/state.js";
import { route } from "../flow/route.js";
import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
import type { RunMeta } from "../store/artifacts.js";
import { appendDecision } from "../store/audit.js";
import { readJson, writeJson } from "../store/io.js";
import { PATHS } from "../store/paths.js";
import { runWorker } from "../workers/loop.js";
import { bootstrap } from "./bootstrap.js";
import { planStartFallback } from "./plan-start.js";

export interface EngineDeps {
  store: StorePort;
  llm: LlmPort;
  /** Hard cap on Engine loop iterations (default 40). */
  maxSteps?: number;
  /** Hard cap on tool turns inside one Worker (default 16). */
  maxWorkerTurns?: number;
  /** Cooperative loop notifications (step / pause / resume / steer / stopped). */
  onEvent?: (event: EngineLoopEvent) => void;
}

export type EngineStopReason = "complete" | "max_steps" | "paused" | "idle";

export interface EngineResult {
  phase: Phase | null;
  steps: number;
  stoppedReason: EngineStopReason;
  lastInstruction: Instruction | null;
  error?: string;
}

export type EngineLoopEvent =
  | { type: "step"; step: number; instruction: Instruction }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "steered"; note: string }
  | { type: "stopped"; result: EngineResult };

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

const DEADLOCK_ABORT_AT = 5;

/**
 * Serial Engine: load state → route → run worker → repeat until complete or max steps.
 *
 * No ChapterAdvanceGate (auto only). plan_start is a deterministic stub
 * (`architect_short` for short books). Worker failures retry once, then pause.
 *
 * `pause` / `resume` / `steer` are cooperative: they take effect at the next
 * loop boundary (after the current Worker instruction finishes).
 */
export class Engine {
  private readonly store: StorePort;
  private readonly llm: LlmPort;
  private readonly maxSteps: number;
  private readonly maxWorkerTurns: number;
  private readonly onEvent?: (event: EngineLoopEvent) => void;
  private failedKey = "";
  private lastKey = "";
  private repeats = 0;
  private pauseRequested = false;
  private resumeWaiter: (() => void) | null = null;
  private running = false;
  private lastResult: EngineResult | null = null;

  constructor(deps: EngineDeps) {
    this.store = deps.store;
    this.llm = deps.llm;
    this.maxSteps = deps.maxSteps ?? 40;
    this.maxWorkerTurns = deps.maxWorkerTurns ?? 16;
    if (deps.onEvent) {
      this.onEvent = deps.onEvent;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.pauseRequested;
  }

  get result(): EngineResult | null {
    return this.lastResult;
  }

  async snapshot(): Promise<{
    state: State;
    result: EngineResult | null;
    running: boolean;
    paused: boolean;
  }> {
    return {
      state: await this.store.loadState(),
      result: this.lastResult,
      running: this.running,
      paused: this.pauseRequested,
    };
  }

  /** Request a yield at the next loop boundary. */
  pause(): void {
    this.pauseRequested = true;
  }

  /**
   * Clear a pending pause. If flow is `steering` from `steer()`, restore the
   * previous flow so `route` can continue.
   */
  async resume(): Promise<void> {
    const wasPaused = this.pauseRequested || this.resumeWaiter !== null;
    await this.clearPendingSteer();
    this.pauseRequested = false;
    const waiter = this.resumeWaiter;
    this.resumeWaiter = null;
    waiter?.();
    if (wasPaused) {
      this.emit({ type: "resumed" });
    }
  }

  /**
   * Persist a host steering note, set `flow=steering` (so `route` returns null),
   * and pause at the next loop boundary. `resume()` restores the previous flow.
   */
  async steer(note: string): Promise<void> {
    const trimmed = note.trim();
    if (trimmed === "") {
      throw new EngineError("steer note must be non-empty");
    }
    const progress = await this.store.loadProgress();
    if (progress == null) {
      throw new EngineError("steer requires bootstrapped progress (call run/start first)");
    }
    const previousFlow: Flow =
      progress.flow === "steering"
        ? ((await readJson<RunMeta>(this.store, PATHS.runMeta))?.pendingSteer?.previousFlow ??
          "writing")
        : progress.flow;
    if (progress.flow !== "steering") {
      validateFlowTransition(progress.flow, "steering");
      await this.store.saveProgress({ ...progress, flow: "steering" });
    }
    const meta = (await readJson<RunMeta>(this.store, PATHS.runMeta)) ?? {};
    const nextMeta: RunMeta = {
      ...meta,
      pendingSteer: { note: trimmed, previousFlow },
    };
    await writeJson(this.store, PATHS.runMeta, nextMeta);
    await appendDecision(this.store, {
      kind: "steer",
      decider: "host",
      input: trimmed,
      reason: "host steer",
    });
    this.emit({ type: "steered", note: trimmed });
    this.pause();
  }

  async run(input: { prompt?: string; maxSteps?: number } = {}): Promise<EngineResult> {
    if (this.running) {
      throw new EngineError("engine is already running");
    }
    this.running = true;
    this.failedKey = "";
    this.lastKey = "";
    this.repeats = 0;
    try {
      return await this.runLoop(input);
    } finally {
      this.running = false;
    }
  }

  private async runLoop(input: { prompt?: string; maxSteps?: number }): Promise<EngineResult> {
    await bootstrap(this.store, input.prompt);
    const limit = input.maxSteps ?? this.maxSteps;
    let steps = 0;
    let lastInstruction: Instruction | null = null;
    let lastError: string | undefined;

    while (steps < limit) {
      await this.waitIfPaused();
      const state = await this.store.loadState();
      if (state.progress?.phase === "complete") {
        return this.finish("complete", state.progress.phase, steps, lastInstruction);
      }

      let inst = route(state);
      if (inst == null) {
        inst = await planStartFallback(this.store);
      }
      if (inst == null) {
        return this.finish("idle", state.progress?.phase ?? null, steps, lastInstruction);
      }

      if (this.trackDeadlock(inst)) {
        return this.finish(
          "paused",
          state.progress?.phase ?? null,
          steps,
          inst,
          `deadlock: ${inst.agent} repeated ${this.repeats} times`,
        );
      }

      lastInstruction = inst;
      steps += 1;
      this.emit({ type: "step", step: steps, instruction: inst });
      try {
        await this.dispatch(inst);
        this.failedKey = "";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;
        const key = instructionKey(inst);
        if (this.failedKey !== key) {
          this.failedKey = key;
          continue;
        }
        const phase = (await this.store.loadProgress())?.phase ?? null;
        return this.finish("paused", phase, steps, inst, message);
      }
    }

    const progress = await this.store.loadProgress();
    return this.finish(
      progress?.phase === "complete" ? "complete" : "max_steps",
      progress?.phase ?? null,
      steps,
      lastInstruction,
      lastError,
    );
  }

  private async dispatch(inst: Instruction): Promise<void> {
    if (inst.agent === "writer") {
      const progress = await this.store.loadProgress();
      if (progress == null || progress.phase !== "writing") {
        throw new EngineError(
          `writer 仅能在 writing 阶段派发（当前 phase=${progress?.phase ?? "<nil>"}）`,
        );
      }
      if (inst.chapter !== undefined && inst.chapter > 0) {
        const current = Math.max(progress.currentChapter ?? 0, inst.chapter);
        await this.store.saveProgress({
          ...progress,
          currentChapter: current,
          flow:
            progress.flow === "rewriting" || progress.flow === "polishing"
              ? progress.flow
              : "writing",
        });
      }
    }
    await runWorker(this.store, this.llm, inst, this.maxWorkerTurns);
  }

  private async waitIfPaused(): Promise<void> {
    if (!this.pauseRequested) {
      return;
    }
    this.emit({ type: "paused" });
    await new Promise<void>((resolve) => {
      this.resumeWaiter = resolve;
    });
  }

  private async clearPendingSteer(): Promise<void> {
    const progress = await this.store.loadProgress();
    if (progress == null || progress.flow !== "steering") {
      return;
    }
    const meta = (await readJson<RunMeta>(this.store, PATHS.runMeta)) ?? {};
    const previous: Flow = meta.pendingSteer?.previousFlow ?? "writing";
    if (previous !== "steering") {
      validateFlowTransition("steering", previous);
      await this.store.saveProgress({ ...progress, flow: previous });
    }
    if (meta.pendingSteer !== undefined) {
      const next: RunMeta = { ...meta };
      delete next.pendingSteer;
      await writeJson(this.store, PATHS.runMeta, next);
    }
  }

  private trackDeadlock(inst: Instruction): boolean {
    const key = instructionKey(inst);
    if (key === this.lastKey) {
      this.repeats += 1;
    } else {
      this.lastKey = key;
      this.repeats = 1;
    }
    return this.repeats >= DEADLOCK_ABORT_AT;
  }

  private emit(event: EngineLoopEvent): void {
    this.onEvent?.(event);
  }

  private finish(
    stoppedReason: EngineStopReason,
    phase: Phase | null,
    steps: number,
    lastInstruction: Instruction | null,
    error?: string,
  ): EngineResult {
    const result: EngineResult = { phase, steps, stoppedReason, lastInstruction };
    const withError = error !== undefined ? { ...result, error } : result;
    this.lastResult = withError;
    this.emit({ type: "stopped", result: withError });
    return withError;
  }
}

function instructionKey(inst: Instruction): string {
  return `${inst.agent}\0${inst.task}`;
}

export function createEngine(deps: EngineDeps): Engine {
  return new Engine(deps);
}
