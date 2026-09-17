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
}

export interface LlmCompletionResult {
  text: string;
  /** Structured tool calls. Empty / omitted means the worker turn is finished. */
  toolCalls?: readonly LlmToolCall[];
}

/**
 * LLM completion port.
 *
 * Hosts inject a browser-safe or Node adapter. This library never ships a real
 * provider client — tests use `MockLlm` / `ReplayLlm`.
 */
export interface LlmPort {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
