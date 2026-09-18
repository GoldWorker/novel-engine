import { LlmError } from "../ports/llm.js";
import type { LlmPort, LlmToolCall } from "../ports/llm.js";

type FetchRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

type FetchResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

type FetchLike = (input: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;

/**
 * Worker-side `LlmPort`: POST the completion request JSON to a host BFF.
 * No API keys here — the endpoint holds credentials.
 * Failures throw `LlmError` (same shape as vendor `LlmAdapterError`).
 */
export function createEndpointLlm(llmEndpoint: string): LlmPort {
  const endpoint = llmEndpoint.trim();
  if (endpoint === "") {
    throw new LlmError("llmEndpoint must be a non-empty string");
  }
  return {
    async complete(request) {
      const fetchFn = (globalThis as { fetch?: FetchLike }).fetch;
      if (typeof fetchFn !== "function") {
        throw new LlmError("fetch is not available in the kit worker");
      }
      const { signal, ...payload } = request;
      const init: FetchRequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      };
      if (signal !== undefined) {
        init.signal = signal;
      }
      let response: FetchResponseLike;
      try {
        response = await fetchFn(endpoint, init);
      } catch (err) {
        if (isAbortLike(err)) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new LlmError(`kit llm fetch failed: ${message}`);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new LlmError(`kit llm ${response.status}`, {
          status: response.status,
          ...(text !== "" ? { body: text } : {}),
        });
      }
      const text = await response.text();
      if (text.trim() === "") {
        throw new LlmError("kit llm response was empty");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new LlmError("kit llm response was not JSON", { body: text });
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new LlmError("kit llm response must be a JSON object");
      }
      const rec = parsed as { text?: unknown; toolCalls?: unknown };
      if (typeof rec.text !== "string") {
        throw new LlmError("kit llm response.text must be a string");
      }
      if (Array.isArray(rec.toolCalls)) {
        return { text: rec.text, toolCalls: rec.toolCalls as readonly LlmToolCall[] };
      }
      return { text: rec.text };
    },
  };
}

function isAbortLike(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && (err as { name: unknown }).name === "AbortError";
}
