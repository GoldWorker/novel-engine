import type {
  LlmCompletionResult,
  LlmMessage,
  LlmPort,
  LlmToolCall,
} from "../ports/llm.js";
import type { Instruction } from "../flow/instruction.js";
import type { StorePort } from "../ports/store.js";
import type { Tool } from "./tools.js";
import { architectTools, editorTools, writerTools } from "./tools.js";

const DEFAULT_MAX_TURNS = 16;

export class WorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerError";
  }
}

const SYSTEM: Record<Instruction["agent"], string> = {
  architect_short:
    "你是短篇规划师。使用 save_book、save_foundation、novel_context、audit_foundation 落盘基础设定并进入写作。完结时调用 save_foundation(type=complete_book)。",
  architect_long:
    "你是长篇规划师。使用 save_book、save_foundation、novel_context、audit_foundation 落盘基础设定。完结时调用 save_foundation(type=complete_book)。",
  writer:
    "你是章节作者。按 plan_chapter → draft_chapter → commit_chapter 完成当前章。",
  editor:
    "你是编辑。阅读 novel_context / read_chapter 后调用 save_review。",
};

export async function runWorker(
  store: StorePort,
  llm: LlmPort,
  instruction: Instruction,
  maxTurns = DEFAULT_MAX_TURNS,
): Promise<void> {
  await runToolLoop(store, llm, instruction, toolsFor(instruction.agent), maxTurns);
}

function toolsFor(agent: Instruction["agent"]): (store: StorePort) => Tool[] {
  switch (agent) {
    case "architect_short":
    case "architect_long":
      return architectTools;
    case "writer":
      return writerTools;
    case "editor":
      return editorTools;
  }
}

async function runToolLoop(
  store: StorePort,
  llm: LlmPort,
  instruction: Instruction,
  factory: (store: StorePort) => Tool[],
  maxTurns: number,
): Promise<void> {
  const tools = factory(store);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM[instruction.agent] },
    { role: "user", content: instruction.task },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await llm.complete({
      messages,
      agent: instruction.agent,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
    });
    const calls = extractToolCalls(result);
    if (calls.length === 0) {
      return;
    }

    const assistant: LlmMessage = { role: "assistant", content: result.text };
    messages.push(assistant);

    for (const call of calls) {
      const tool = byName.get(call.name);
      if (!tool) {
        throw new WorkerError(`unknown tool: ${call.name}`);
      }
      const output = await tool.execute(asArgs(call.arguments));
      const toolMessage: LlmMessage = {
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: JSON.stringify(output),
      };
      messages.push(toolMessage);
    }
  }

  throw new WorkerError(`worker ${instruction.agent} exceeded ${maxTurns} tool turns`);
}

function extractToolCalls(result: LlmCompletionResult): readonly LlmToolCall[] {
  if (result.toolCalls && result.toolCalls.length > 0) {
    return result.toolCalls;
  }
  const text = result.text.trim();
  if (!text.startsWith("{")) {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as {
      name?: string;
      arguments?: Record<string, unknown>;
      id?: string;
    };
    if (typeof parsed.name === "string" && parsed.arguments && typeof parsed.arguments === "object") {
      return [
        {
          id: typeof parsed.id === "string" ? parsed.id : "call-1",
          name: parsed.name,
          arguments: parsed.arguments,
        },
      ];
    }
  } catch {
    return [];
  }
  return [];
}

function asArgs(raw: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof raw === "string") {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new WorkerError("tool arguments JSON must be an object");
  }
  return raw;
}
