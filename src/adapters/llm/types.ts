/**
 * Minimal `fetch` subset so adapters stay free of the DOM lib.
 * Matches `globalThis.fetch` in browsers and Node ≥18.
 */
export type FetchRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
};

export type FetchLike = (input: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;

export interface LlmAdapterOptions {
  apiKey: string;
  model: string;
  /** Provider API root. See each factory's default. */
  baseUrl?: string;
  /** Injected `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Extra headers merged on top of provider defaults (can override). */
  headers?: Record<string, string>;
}

export type OpenAiLlmOptions = LlmAdapterOptions;

export type DashScopeLlmOptions = LlmAdapterOptions;

export interface AnthropicLlmOptions extends LlmAdapterOptions {
  /** Required by Anthropic Messages. Default 4096. */
  maxTokens?: number;
  /** Default `2023-06-01`. */
  anthropicVersion?: string;
}

export type LlmVendor = "openai" | "anthropic" | "dashscope";

export type VendorLlmOptions =
  | (OpenAiLlmOptions & { provider: "openai" })
  | (AnthropicLlmOptions & { provider: "anthropic" })
  | (DashScopeLlmOptions & { provider: "dashscope" });

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
export const DASHSCOPE_COMPAT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
export const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

/** Permissive object schema: Engine `LlmToolSpec` has name + description only. */
export const PERMISSIVE_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const;
