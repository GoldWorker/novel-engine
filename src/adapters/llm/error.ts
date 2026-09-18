import { LlmError } from "../../ports/llm.js";

/**
 * HTTP / mapping failure from an optional vendor adapter (`novel-engine/llm`).
 * Subclass of portable `LlmError` so Worker restore and `instanceof LlmError` align.
 */
export class LlmAdapterError extends LlmError {
  constructor(message: string, options?: { status?: number; body?: string }) {
    super(message, options);
    this.name = "LlmAdapterError";
  }
}
