import type { FetchLike, FetchRequestInit } from "../../src/adapters/llm/types.js";

export interface MockFetchCall {
  url: string;
  init?: FetchRequestInit;
}

export interface MockFetchResponse {
  status?: number;
  statusText?: string;
  json?: unknown;
  text?: string;
}

export function createMockFetch(
  respond: MockFetchResponse | ((call: MockFetchCall, index: number) => MockFetchResponse),
): { fetch: FetchLike; calls: MockFetchCall[] } {
  const calls: MockFetchCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: MockFetchCall = init ? { url, init } : { url };
    const index = calls.length;
    calls.push(call);
    const response = typeof respond === "function" ? respond(call, index) : respond;
    const status = response.status ?? 200;
    const statusText = response.statusText ?? (status >= 200 && status < 300 ? "OK" : "Error");
    const text =
      response.text ?? (response.json !== undefined ? JSON.stringify(response.json) : "");
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      async text() {
        return text;
      },
    };
  };
  return { fetch, calls };
}

export function requestJson(call: MockFetchCall): Record<string, unknown> {
  const body = call.init?.body;
  if (body === undefined) {
    throw new Error("missing request body");
  }
  return JSON.parse(body) as Record<string, unknown>;
}
