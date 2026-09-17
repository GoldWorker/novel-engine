import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  createAnthropicLlm,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_VERSION,
  LlmAdapterError,
  type LlmCompletionRequest,
} from "../../src/adapters/llm/index.js";
import { createMockFetch, requestJson } from "../helpers/fake-fetch.js";

const tools: LlmCompletionRequest["tools"] = [
  { name: "save_book", description: "save title" },
];

const firstTurn: LlmCompletionRequest = {
  messages: [
    { role: "system", content: "you are the architect" },
    { role: "user", content: "plan the book" },
  ],
  agent: "architect_short",
  tools,
};

describe("createAnthropicLlm", () => {
  it("POSTs /v1/messages with x-api-key, system, tools, and max_tokens", async () => {
    const { fetch, calls } = createMockFetch({
      json: {
        content: [{ type: "text", text: "hello from claude" }],
      },
    });
    const llm = createAnthropicLlm({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
      fetch,
    });

    const result = await llm.complete(firstTurn);

    expect(result).toEqual({ text: "hello from claude" });
    expect(calls[0]?.url).toBe(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`);
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "sk-ant-test",
      "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
    });
    const body = requestJson(calls[0]!);
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.max_tokens).toBe(DEFAULT_ANTHROPIC_MAX_TOKENS);
    expect(body.system).toBe("you are the architect");
    expect(body.messages).toEqual([{ role: "user", content: "plan the book" }]);
    expect(body.tools).toEqual([
      {
        name: "save_book",
        description: "save title",
        input_schema: { type: "object", properties: {}, additionalProperties: true },
      },
    ]);
  });

  it("normalizes tool_use blocks (object input) into LlmToolCall[]", async () => {
    const { fetch } = createMockFetch({
      json: {
        content: [
          { type: "text", text: "saving" },
          {
            type: "tool_use",
            id: "toolu_abc",
            name: "save_book",
            input: { title: "无主的信", synopsis: "灯塔" },
          },
        ],
      },
    });
    const llm = createAnthropicLlm({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
      fetch,
    });
    const result = await llm.complete(firstTurn);
    expect(result.text).toBe("saving");
    expect(result.toolCalls).toEqual([
      {
        id: "toolu_abc",
        name: "save_book",
        arguments: { title: "无主的信", synopsis: "灯塔" },
      },
    ]);
  });

  it("maps Engine tool rounds to assistant tool_use + user tool_result", async () => {
    const { fetch, calls } = createMockFetch({
      json: { content: [{ type: "text", text: "ok" }] },
    });
    const llm = createAnthropicLlm({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
      fetch,
    });
    await llm.complete({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "go" },
        { role: "assistant", content: "calling" },
        {
          role: "tool",
          name: "save_book",
          toolCallId: "toolu_abc",
          content: "{\"saved\":true}",
        },
      ],
      tools,
    });
    const body = requestJson(calls[0]!);
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "tool_use", id: "toolu_abc", name: "save_book", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_abc",
            content: "{\"saved\":true}",
          },
        ],
      },
    ]);
  });

  it("joins multiple system messages and concatenates text blocks", async () => {
    const { fetch, calls } = createMockFetch({
      json: {
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      },
    });
    const llm = createAnthropicLlm({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
      maxTokens: 2048,
      anthropicVersion: "2023-06-01",
      fetch,
    });
    const result = await llm.complete({
      messages: [
        { role: "system", content: "one" },
        { role: "system", content: "two" },
        { role: "user", content: "hi" },
      ],
    });
    expect(result.text).toBe("ab");
    expect(requestJson(calls[0]!).system).toBe("one\n\ntwo");
    expect(requestJson(calls[0]!).max_tokens).toBe(2048);
  });

  it("throws LlmAdapterError on HTTP 429", async () => {
    const { fetch } = createMockFetch({
      status: 429,
      statusText: "Too Many Requests",
      text: "{\"error\":{\"message\":\"rate\"}}",
    });
    const llm = createAnthropicLlm({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
      fetch,
    });
    await expect(llm.complete(firstTurn)).rejects.toBeInstanceOf(LlmAdapterError);
    await expect(llm.complete(firstTurn)).rejects.toThrow(/429/);
  });

  it("rejects non-positive maxTokens", () => {
    const { fetch } = createMockFetch({ json: {} });
    expect(() =>
      createAnthropicLlm({
        apiKey: "sk-ant-test",
        model: "claude-sonnet-4-20250514",
        maxTokens: 0,
        fetch,
      }),
    ).toThrow(/maxTokens/);
  });
});
