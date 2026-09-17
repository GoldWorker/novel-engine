import { LlmAdapterError } from "./error.js";
import type { FetchLike, FetchRequestInit } from "./types.js";

export function requireNonEmpty(value: string, name: string): string {
  if (value.trim() === "") {
    throw new LlmAdapterError(`${name} is required`);
  }
  return value;
}

export function resolveFetch(custom?: FetchLike): FetchLike {
  if (custom) {
    return custom;
  }
  const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
  if (typeof globalFetch !== "function") {
    throw new LlmAdapterError("fetch is not available; pass options.fetch");
  }
  return (input, init) => globalFetch(input, init);
}

export function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

export function mergeHeaders(
  defaults: Record<string, string>,
  extra?: Record<string, string>,
): Record<string, string> {
  return extra ? { ...defaults, ...extra } : { ...defaults };
}

export async function postJson(options: {
  fetch: FetchLike;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}): Promise<unknown> {
  const init: FetchRequestInit = {
    method: "POST",
    headers: options.headers,
    body: JSON.stringify(options.body),
  };
  const response = await options.fetch(options.url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new LlmAdapterError(
      `LLM HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
      { status: response.status, body: text },
    );
  }
  if (text.trim() === "") {
    throw new LlmAdapterError("LLM HTTP response was empty");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LlmAdapterError("LLM HTTP response was not JSON", { body: text });
  }
}
