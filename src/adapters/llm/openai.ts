import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmMessage,
  LlmPort,
  LlmToolCall,
  LlmToolSpec,
} from "../../ports/llm.js";
import {
  asToolCalls,
  followingToolMessages,
  parseToolArguments,
  toolCallId,
  toolCallName,
} from "./arguments.js";
import { LlmAdapterError } from "./error.js";
import { joinUrl, mergeHeaders, postJson, requireNonEmpty, resolveFetch } from "./http.js";
import {
  DASHSCOPE_COMPAT_BASE_URL,
  OPENAI_DEFAULT_BASE_URL,
  PERMISSIVE_OBJECT_SCHEMA,
  type DashScopeLlmOptions,
  type FetchLike,
  type OpenAiLlmOptions,
} from "./types.js";

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string; name?: string };

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: unknown };
      }>;
    };
  }>;
  error?: { message?: string };
};

function mapTools(tools: readonly LlmToolSpec[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: PERMISSIVE_OBJECT_SCHEMA,
    },
  }));
}

function mapMessages(messages: readonly LlmMessage[]): OpenAiMessage[] {
  return messages.map((message, index) => {
    if (message.role === "tool") {
      const mapped: Extract<OpenAiMessage, { role: "tool" }> = {
        role: "tool",
        tool_call_id: toolCallId(message, `call-${index}`),
        content: message.content,
      };
      const name = message.name?.trim();
      if (name) {
        mapped.name = name;
      }
      return mapped;
    }
    if (message.role === "assistant") {
      const trailing = followingToolMessages(messages, index);
      const toolCalls: OpenAiToolCall[] = trailing.map((tool, toolIndex) => ({
        id: toolCallId(tool, `call-${index}-${toolIndex}`),
        type: "function",
        function: {
          name: toolCallName(tool),
          arguments: "{}",
        },
      }));
      const mapped: OpenAiMessage = {
        role: "assistant",
        content: message.content === "" && toolCalls.length > 0 ? null : message.content,
      };
      if (toolCalls.length > 0) {
        mapped.tool_calls = toolCalls;
      }
      return mapped;
    }
    return { role: message.role, content: message.content };
  });
}

function parseOpenAiResult(payload: unknown): LlmCompletionResult {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LlmAdapterError("OpenAI response was not a JSON object");
  }
  const body = payload as OpenAiChatResponse;
  if (body.error?.message) {
    throw new LlmAdapterError(body.error.message);
  }
  const message = body.choices?.[0]?.message;
  if (!message) {
    throw new LlmAdapterError("OpenAI response missing choices[0].message");
  }
  const text = typeof message.content === "string" ? message.content : "";
  const toolCalls: LlmToolCall[] = [];
  for (const [index, call] of (message.tool_calls ?? []).entries()) {
    const name = call.function?.name?.trim();
    if (!name) {
      throw new LlmAdapterError(`OpenAI tool call ${index} missing function.name`);
    }
    toolCalls.push({
      id: call.id && call.id.trim() !== "" ? call.id : `call-${index}`,
      name,
      arguments: parseToolArguments(call.function?.arguments),
    });
  }
  const result: LlmCompletionResult = { text };
  const mapped = asToolCalls(toolCalls);
  if (mapped) {
    result.toolCalls = mapped;
  }
  return result;
}

function createOpenAiCompatibleLlm(
  options: OpenAiLlmOptions,
  defaultBaseUrl: string,
): LlmPort {
  const apiKey = requireNonEmpty(options.apiKey, "apiKey");
  const model = requireNonEmpty(options.model, "model");
  const baseUrl = requireNonEmpty(options.baseUrl ?? defaultBaseUrl, "baseUrl");
  const fetchImpl: FetchLike = resolveFetch(options.fetch);
  const url = joinUrl(baseUrl, "chat/completions");
  const headers = mergeHeaders(
    {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    options.headers,
  );

  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      const body: Record<string, unknown> = {
        model,
        messages: mapMessages(request.messages),
      };
      if (request.tools && request.tools.length > 0) {
        body.tools = mapTools(request.tools);
      }
      const payload = await postJson({ fetch: fetchImpl, url, headers, body });
      return parseOpenAiResult(payload);
    },
  };
}

/** OpenAI Chat Completions (`POST {baseUrl}/chat/completions`). */
export function createOpenAiLlm(options: OpenAiLlmOptions): LlmPort {
  return createOpenAiCompatibleLlm(options, OPENAI_DEFAULT_BASE_URL);
}

/**
 * DashScope OpenAI-compatible mode (`compatible-mode/v1`).
 * Same wire format as `createOpenAiLlm`; default base URL is Beijing compatible-mode.
 * International / other regions: pass `baseUrl` (must end with `/compatible-mode/v1`).
 */
export function createDashScopeLlm(options: DashScopeLlmOptions): LlmPort {
  return createOpenAiCompatibleLlm(options, DASHSCOPE_COMPAT_BASE_URL);
}
