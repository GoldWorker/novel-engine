import { describe, expect, it } from "vitest";
import {
  createDashScopeLlm,
  createOpenAiLlm,
  DASHSCOPE_COMPAT_BASE_URL,
} from "../../src/adapters/llm/index.js";
import { createMockFetch, requestJson } from "../helpers/fake-fetch.js";

describe("createDashScopeLlm", () => {
  it("reuses the OpenAI-shaped client against compatible-mode/v1", async () => {
    const { fetch, calls } = createMockFetch({
      json: {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call_qwen",
                  type: "function",
                  function: {
                    name: "save_book",
                    arguments: "{\"title\":\"灯塔\",\"synopsis\":\"信\"}",
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const llm = createDashScopeLlm({
      apiKey: "sk-dashscope",
      model: "qwen-plus",
      fetch,
    });
    const result = await llm.complete({
      messages: [{ role: "user", content: "开始" }],
      tools: [{ name: "save_book", description: "save title" }],
      agent: "architect_short",
    });

    expect(calls[0]?.url).toBe(`${DASHSCOPE_COMPAT_BASE_URL}/chat/completions`);
    expect(calls[0]?.init?.headers?.authorization).toBe("Bearer sk-dashscope");
    expect(requestJson(calls[0]!).model).toBe("qwen-plus");
    expect(result.toolCalls).toEqual([
      { id: "call_qwen", name: "save_book", arguments: { title: "灯塔", synopsis: "信" } },
    ]);
  });

  it("accepts a regional compatible-mode baseUrl", async () => {
    const { fetch, calls } = createMockFetch({
      json: { choices: [{ message: { content: "ok" } }] },
    });
    const llm = createDashScopeLlm({
      apiKey: "sk-dashscope",
      model: "qwen-plus",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      fetch,
    });
    await llm.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(calls[0]?.url).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
  });

  it("shares request mapping with createOpenAiLlm (tool round reconstruction)", async () => {
    const { fetch, calls } = createMockFetch({
      json: { choices: [{ message: { content: "done" } }] },
    });
    const options = {
      apiKey: "sk-dashscope",
      model: "qwen-plus",
      fetch,
      baseUrl: "https://example.test/compatible-mode/v1",
    };
    const dash = createDashScopeLlm(options);
    const openai = createOpenAiLlm({ ...options, baseUrl: "https://example.test/v1" });
    const request = {
      messages: [
        { role: "user" as const, content: "go" },
        { role: "assistant" as const, content: "" },
        {
          role: "tool" as const,
          name: "save_book",
          toolCallId: "call_1",
          content: "{}",
        },
      ],
    };
    await dash.complete(request);
    await openai.complete(request);
    expect(requestJson(calls[0]!).messages).toEqual(requestJson(calls[1]!).messages);
    expect(requestJson(calls[0]!).tools).toBeUndefined();
  });
});
