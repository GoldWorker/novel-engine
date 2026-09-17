import type { AgentId } from "../domain/agents.js";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmCompletionRequest {
  messages: readonly LlmMessage[];
  /** Optional agent identity for logging / future prompt selection. */
  agent?: AgentId;
}

export interface LlmCompletionResult {
  text: string;
}

/**
 * LLM completion port. Phase 0 exports the contract only.
 *
 * Future Engine will inject a browser-safe or Node adapter (fetch to a gateway,
 * WebLLM, etc.). This library never ships a real provider client.
 */
export interface LlmPort {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
