import { raceAbort, throwIfAborted } from "../abort.js";
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmPort,
} from "../ports/llm.js";

export type MockLlmHandler = (
  request: LlmCompletionRequest,
) => LlmCompletionResult | Promise<LlmCompletionResult>;

export type MockLlmStep = LlmCompletionResult | MockLlmHandler;

/**
 * Scripted LLM adapter. Each `complete` consumes the next script step, or the
 * optional fallback handler. Exhaustion throws — tests must be deterministic.
 */
export class MockLlm implements LlmPort {
  readonly calls: LlmCompletionRequest[] = [];
  private index = 0;

  constructor(
    private readonly script: readonly MockLlmStep[] = [],
    private readonly fallback?: MockLlmHandler,
  ) {}

  static fromHandler(handler: MockLlmHandler): MockLlm {
    return new MockLlm([], handler);
  }

  get callCount(): number {
    return this.calls.length;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    throwIfAborted(request.signal);
    this.calls.push(request);
    const step = this.script[this.index];
    this.index += 1;
    if (typeof step === "function") {
      return raceAbort(Promise.resolve(step(request)), request.signal);
    }
    if (step) {
      return step;
    }
    if (this.fallback) {
      return raceAbort(Promise.resolve(this.fallback(request)), request.signal);
    }
    throw new Error(`MockLlm: script exhausted at call ${this.index}`);
  }
}

/**
 * Fixture replay adapter. Same contract as `MockLlm` with a pure result list.
 */
export class ReplayLlm implements LlmPort {
  readonly calls: LlmCompletionRequest[] = [];
  private index = 0;

  constructor(private readonly fixtures: readonly LlmCompletionResult[]) {}

  get callCount(): number {
    return this.calls.length;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    throwIfAborted(request.signal);
    this.calls.push(request);
    const next = this.fixtures[this.index];
    this.index += 1;
    if (!next) {
      throw new Error(`ReplayLlm: no fixture for call ${this.index}`);
    }
    return next;
  }
}
