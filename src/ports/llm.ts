import type { AgentId } from "../domain/agents.js";

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** Tool name when `role` is `"tool"`. */
  name?: string;
  /** Correlates a tool result with a prior `LlmToolCall.id`. */
  toolCallId?: string;
}

export interface LlmToolSpec {
  name: string;
  description: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmCompletionRequest {
  messages: readonly LlmMessage[];
  /** Optional agent identity for logging / prompt selection. */
  agent?: AgentId;
  /** Tools the worker may invoke this turn. */
  tools?: readonly LlmToolSpec[];
  /**
   * Optional abort. Adapters that `fetch` should forward it; unknown
   * implementations may ignore it — Engine/Session still race the wait.
   */
  signal?: AbortSignal;
}

export interface LlmCompletionResult {
  text: string;
  /** Structured tool calls. Empty / omitted means the worker turn is finished. */
  toolCalls?: readonly LlmToolCall[];
}

/**
 * LLM completion port.
 *
 * Hosts inject a browser-safe or Node adapter. Default entries never ship a
 * provider client (`MockLlm` / `ReplayLlm` only). Optional fetch adapters live
 * behind `novel-engine/llm`.
 */
export interface LlmPort {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

/**
 * Failure from `LlmPort.complete` (vendor adapters and kit `llmEndpoint` fetch).
 * Serializable across the Session Worker bridge.
 */
export class LlmError extends Error {
  readonly status?: number;
  readonly body?: string;

  constructor(message: string, options?: { status?: number; body?: string }) {
    super(message);
    this.name = "LlmError";
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.body !== undefined) {
      this.body = options.body;
    }
  }
}
