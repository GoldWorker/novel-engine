import type { Phase } from "../domain/phase.js";
import type { Instruction } from "../flow/instruction.js";
import { route } from "../flow/route.js";
import type { LlmPort } from "../ports/llm.js";
import type { StorePort } from "../ports/store.js";
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
}

export type EngineStopReason = "complete" | "max_steps" | "paused" | "idle";

export interface EngineResult {
  phase: Phase | null;
  steps: number;
  stoppedReason: EngineStopReason;
  lastInstruction: Instruction | null;
  error?: string;
}

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
 */
export class Engine {
  private readonly store: StorePort;
  private readonly llm: LlmPort;
  private readonly maxSteps: number;
  private readonly maxWorkerTurns: number;
  private failedKey = "";
  private lastKey = "";
  private repeats = 0;

  constructor(deps: EngineDeps) {
    this.store = deps.store;
    this.llm = deps.llm;
    this.maxSteps = deps.maxSteps ?? 40;
    this.maxWorkerTurns = deps.maxWorkerTurns ?? 16;
  }

  async run(input: { prompt?: string; maxSteps?: number } = {}): Promise<EngineResult> {
    await bootstrap(this.store, input.prompt);
    const limit = input.maxSteps ?? this.maxSteps;
    let steps = 0;
    let lastInstruction: Instruction | null = null;
    let lastError: string | undefined;

    while (steps < limit) {
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

  private finish(
    stoppedReason: EngineStopReason,
    phase: Phase | null,
    steps: number,
    lastInstruction: Instruction | null,
    error?: string,
  ): EngineResult {
    const result: EngineResult = { phase, steps, stoppedReason, lastInstruction };
    if (error !== undefined) {
      return { ...result, error };
    }
    return result;
  }
}

function instructionKey(inst: Instruction): string {
  return `${inst.agent}\0${inst.task}`;
}

export function createEngine(deps: EngineDeps): Engine {
  return new Engine(deps);
}
