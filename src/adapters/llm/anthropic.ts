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
  parseToolArguments,
  toolCallId,
  toolCallName,
} from "./arguments.js";
import { LlmAdapterError } from "./error.js";
import { joinUrl, mergeHeaders, postJson, requireNonEmpty, resolveFetch } from "./http.js";
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_VERSION,
  PERMISSIVE_OBJECT_SCHEMA,
  type AnthropicLlmOptions,
  type FetchLike,
} from "./types.js";

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type AnthropicToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type AnthropicContent = string | Array<AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock>;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: AnthropicContent;
};

type AnthropicResponse = {
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  error?: { message?: string };
};

function mapTools(tools: readonly LlmToolSpec[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: PERMISSIVE_OBJECT_SCHEMA,
  }));
}

function mapRequest(messages: readonly LlmMessage[]): {
  messages: AnthropicMessage[];
  system?: string;
} {
  const systemParts: string[] = [];
  const rest: LlmMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
    } else {
      rest.push(message);
    }
  }

  const out: AnthropicMessage[] = [];
  for (let i = 0; i < rest.length; i++) {
    const message = rest[i]!;
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const tools: LlmMessage[] = [];
      while (i + 1 < rest.length && rest[i + 1]?.role === "tool") {
        i += 1;
        tools.push(rest[i]!);
      }
      const blocks: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];
      if (message.content.trim() !== "") {
        blocks.push({ type: "text", text: message.content });
      }
      for (const [toolIndex, tool] of tools.entries()) {
        blocks.push({
          type: "tool_use",
          id: toolCallId(tool, `toolu-${i}-${toolIndex}`),
          name: toolCallName(tool),
          input: {},
        });
      }
      if (blocks.length === 0) {
        blocks.push({ type: "text", text: message.content });
      }
      out.push({ role: "assistant", content: blocks });
      if (tools.length > 0) {
        out.push({
          role: "user",
          content: tools.map((tool, toolIndex) => ({
            type: "tool_result" as const,
            tool_use_id: toolCallId(tool, `toolu-${i}-${toolIndex}`),
            content: tool.content,
          })),
        });
      }
      continue;
    }
    const tools: LlmMessage[] = [message];
    while (i + 1 < rest.length && rest[i + 1]?.role === "tool") {
      i += 1;
      tools.push(rest[i]!);
    }
    out.push({
      role: "user",
      content: tools.map((tool, toolIndex) => ({
        type: "tool_result" as const,
        tool_use_id: toolCallId(tool, `toolu-${i}-${toolIndex}`),
        content: tool.content,
      })),
    });
  }

  const mapped: { messages: AnthropicMessage[]; system?: string } = { messages: out };
  const system = systemParts.join("\n\n");
  if (system !== "") {
    mapped.system = system;
  }
  return mapped;
}

function parseAnthropicResult(payload: unknown): LlmCompletionResult {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LlmAdapterError("Anthropic response was not a JSON object");
  }
  const body = payload as AnthropicResponse;
  if (body.error?.message) {
    throw new LlmAdapterError(body.error.message);
  }
  if (!Array.isArray(body.content)) {
    throw new LlmAdapterError("Anthropic response missing content array");
  }
  const textParts: string[] = [];
  const toolCalls: LlmToolCall[] = [];
  for (const [index, block] of body.content.entries()) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
      continue;
    }
    if (block.type === "tool_use") {
      const name = block.name?.trim();
      if (!name) {
        throw new LlmAdapterError(`Anthropic tool_use ${index} missing name`);
      }
      toolCalls.push({
        id: block.id && block.id.trim() !== "" ? block.id : `toolu-${index}`,
        name,
        arguments: parseToolArguments(block.input),
      });
    }
  }
  const result: LlmCompletionResult = { text: textParts.join("") };
  const mapped = asToolCalls(toolCalls);
  if (mapped) {
    result.toolCalls = mapped;
  }
  return result;
}

/** Anthropic Messages (`POST {baseUrl}/v1/messages`). */
export function createAnthropicLlm(options: AnthropicLlmOptions): LlmPort {
  const apiKey = requireNonEmpty(options.apiKey, "apiKey");
  const model = requireNonEmpty(options.model, "model");
  const baseUrl = requireNonEmpty(options.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL, "baseUrl");
  const fetchImpl: FetchLike = resolveFetch(options.fetch);
  const url = joinUrl(baseUrl, "v1/messages");
  const maxTokens = options.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new LlmAdapterError("maxTokens must be a positive number");
  }
  const headers = mergeHeaders(
    {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION,
    },
    options.headers,
  );

  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      const mapped = mapRequest(request.messages);
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        messages: mapped.messages,
      };
      if (mapped.system !== undefined) {
        body.system = mapped.system;
      }
      if (request.tools && request.tools.length > 0) {
        body.tools = mapTools(request.tools);
      }
      const payload = await postJson({
        fetch: fetchImpl,
        url,
        headers,
        body,
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
      });
      return parseAnthropicResult(payload);
    },
  };
}
