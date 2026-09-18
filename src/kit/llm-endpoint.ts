import type { LlmPort, LlmToolCall } from "../ports/llm.js";

type FetchRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
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
 */
export function createEndpointLlm(llmEndpoint: string): LlmPort {
  const endpoint = llmEndpoint.trim();
  if (endpoint === "") {
    throw new Error("llmEndpoint must be a non-empty string");
  }
  return {
    async complete(request) {
      const fetchFn = (globalThis as { fetch?: FetchLike }).fetch;
      if (typeof fetchFn !== "function") {
        throw new Error("fetch is not available in the kit worker");
      }
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error(`kit llm ${response.status}`);
      }
      const text = await response.text();
      if (text.trim() === "") {
        throw new Error("kit llm response was empty");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new Error("kit llm response was not JSON");
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("kit llm response must be a JSON object");
      }
      const rec = parsed as { text?: unknown; toolCalls?: unknown };
      if (typeof rec.text !== "string") {
        throw new Error("kit llm response.text must be a string");
      }
      if (Array.isArray(rec.toolCalls)) {
        return { text: rec.text, toolCalls: rec.toolCalls as readonly LlmToolCall[] };
      }
      return { text: rec.text };
    },
  };
}
