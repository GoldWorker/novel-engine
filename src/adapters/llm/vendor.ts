import type { LlmPort } from "../../ports/llm.js";
import { createAnthropicLlm } from "./anthropic.js";
import { LlmAdapterError } from "./error.js";
import { createDashScopeLlm, createOpenAiLlm } from "./openai.js";
import type { VendorLlmOptions } from "./types.js";

/** Dispatch to a vendor factory. Same options as the dedicated `create*Llm` helpers. */
export function createVendorLlm(options: VendorLlmOptions): LlmPort {
  switch (options.provider) {
    case "openai":
      return createOpenAiLlm(options);
    case "anthropic":
      return createAnthropicLlm(options);
    case "dashscope":
      return createDashScopeLlm(options);
    default: {
      const provider = (options as { provider: string }).provider;
      throw new LlmAdapterError(`unknown LLM provider: ${provider}`);
    }
  }
}
