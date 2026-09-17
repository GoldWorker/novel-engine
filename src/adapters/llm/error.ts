/**
 * HTTP / mapping failure from an optional vendor adapter (`novel-engine/llm`).
 */
export class LlmAdapterError extends Error {
  readonly status?: number;
  readonly body?: string;

  constructor(message: string, options?: { status?: number; body?: string }) {
    super(message);
    this.name = "LlmAdapterError";
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.body !== undefined) {
      this.body = options.body;
    }
  }
}
