/**
 * Optional vendor LLM adapters (`novel-engine/llm`).
 *
 * Not part of the default `novel-engine` / `novel-engine/worker` bundles.
 * Fetch-based: no `openai` / `@anthropic-ai/sdk` dependency.
 */
export type {
  LlmPort,
  LlmRole,
  LlmMessage,
  LlmToolSpec,
  LlmToolCall,
  LlmCompletionRequest,
  LlmCompletionResult,
} from "../../ports/llm.js";

export { LlmAdapterError } from "./error.js";
export { LlmError } from "../../ports/llm.js";
export { createOpenAiLlm, createDashScopeLlm } from "./openai.js";
export { createAnthropicLlm } from "./anthropic.js";
export { createVendorLlm } from "./vendor.js";
export type {
  FetchLike,
  FetchRequestInit,
  FetchResponseLike,
  LlmAdapterOptions,
  OpenAiLlmOptions,
  AnthropicLlmOptions,
  DashScopeLlmOptions,
  LlmVendor,
  VendorLlmOptions,
} from "./types.js";
export {
  OPENAI_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_BASE_URL,
  DASHSCOPE_COMPAT_BASE_URL,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_VERSION,
} from "./types.js";
