import type { LlmMessage, LlmToolCall } from "../../ports/llm.js";
import { LlmAdapterError } from "./error.js";

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    return {};
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw new LlmAdapterError("tool call arguments were not valid JSON");
    }
    return asArgumentObject(parsed);
  }
  return asArgumentObject(raw);
}

function asArgumentObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new LlmAdapterError("tool call arguments must be a JSON object");
}

export function followingToolMessages(
  messages: readonly LlmMessage[],
  assistantIndex: number,
): readonly LlmMessage[] {
  const tools: LlmMessage[] = [];
  for (let i = assistantIndex + 1; i < messages.length; i++) {
    const next = messages[i];
    if (!next || next.role !== "tool") {
      break;
    }
    tools.push(next);
  }
  return tools;
}

export function toolCallId(message: LlmMessage, fallback: string): string {
  return message.toolCallId && message.toolCallId.trim() !== "" ? message.toolCallId : fallback;
}

export function toolCallName(message: LlmMessage, fallback = "unknown"): string {
  return message.name && message.name.trim() !== "" ? message.name : fallback;
}

export function asToolCalls(calls: LlmToolCall[]): LlmToolCall[] | undefined {
  return calls.length > 0 ? calls : undefined;
}
