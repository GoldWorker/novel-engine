import { describe, expect, it } from "vitest";
import {
  createOpenAiLlm,
  LlmAdapterError,
  OPENAI_DEFAULT_BASE_URL,
  type LlmCompletionRequest,
} from "../../src/adapters/llm/index.js";
import { createMockFetch, requestJson } from "../helpers/fake-fetch.js";

const tools: LlmCompletionRequest["tools"] = [
  { name: "draft_chapter", description: "write a draft" },
];

const firstTurn: LlmCompletionRequest = {
  messages: [
    { role: "system", content: "you are the writer" },
    { role: "user", content: "write chapter 1" },
  ],
  agent: "writer",
  tools,
};

describe("createOpenAiLlm", () => {
  it("POSTs chat/completions with Bearer auth, mapped tools, and normalized text", async () => {
    const { fetch, calls } = createMockFetch({
      json: {
        choices: [{ message: { role: "assistant", content: "hello from gpt" } }],
      },
    });
    const llm = createOpenAiLlm({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetch,
    });

    const result = await llm.complete(firstTurn);

    expect(result).toEqual({ text: "hello from gpt" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${OPENAI_DEFAULT_BASE_URL}/chat/completions`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer sk-test",
    });
    const body = requestJson(calls[0]!);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "you are the writer" },
      { role: "user", content: "write chapter 1" },
    ]);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "draft_chapter",
          description: "write a draft",
          parameters: { type: "object", properties: {}, additionalProperties: true },
        },
      },
    ]);
  });

  it("parses tool_calls and JSON-string arguments into LlmToolCall objects", async () => {
    const { fetch } = createMockFetch({
      json: {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_abc",
                  type: "function",
                  function: {
                    name: "draft_chapter",
                    arguments: "{\"chapter\":1,\"content\":\"灯塔\"}",
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const llm = createOpenAiLlm({ apiKey: "sk-test", model: "gpt-4o-mini", fetch });
    const result = await llm.complete(firstTurn);
    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([
      {
        id: "call_abc",
        name: "draft_chapter",
        arguments: { chapter: 1, content: "灯塔" },
      },
    ]);
  });

  it("reconstructs assistant tool_calls from Engine tool-result rounds", async () => {
    const { fetch, calls } = createMockFetch({
      json: { choices: [{ message: { content: "done" } }] },
    });
    const llm = createOpenAiLlm({ apiKey: "sk-test", model: "gpt-4o-mini", fetch });
    await llm.complete({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "go" },
        { role: "assistant", content: "" },
        {
          role: "tool",
          name: "draft_chapter",
          toolCallId: "call_abc",
          content: "{\"saved\":true}",
        },
      ],
      tools,
    });
    const body = requestJson(calls[0]!);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_abc",
            type: "function",
            function: { name: "draft_chapter", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_abc",
        name: "draft_chapter",
        content: "{\"saved\":true}",
      },
    ]);
  });

  it("uses a custom baseUrl and extra headers", async () => {
    const { fetch, calls } = createMockFetch({
      json: { choices: [{ message: { content: "ok" } }] },
    });
    const llm = createOpenAiLlm({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://gateway.example/v1/",
      headers: { "x-host": "novel-engine" },
      fetch,
    });
    await llm.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(calls[0]?.url).toBe("https://gateway.example/v1/chat/completions");
    expect(calls[0]?.init?.headers?.["x-host"]).toBe("novel-engine");
  });

  it("throws LlmAdapterError on HTTP errors without calling a real network", async () => {
    const { fetch } = createMockFetch({
      status: 401,
      statusText: "Unauthorized",
      text: "{\"error\":{\"message\":\"bad key\"}}",
    });
    const llm = createOpenAiLlm({ apiKey: "sk-bad", model: "gpt-4o-mini", fetch });
    await expect(llm.complete(firstTurn)).rejects.toMatchObject({
      name: "LlmAdapterError",
      status: 401,
    });
    await expect(llm.complete(firstTurn)).rejects.toThrow(/401/);
  });

  it("throws when tool call arguments are not a JSON object", async () => {
    const { fetch } = createMockFetch({
      json: {
        choices: [
          {
            message: {
              tool_calls: [
                { id: "c1", function: { name: "draft_chapter", arguments: "[1]" } },
              ],
            },
          },
        ],
      },
    });
    const llm = createOpenAiLlm({ apiKey: "sk-test", model: "gpt-4o-mini", fetch });
    await expect(llm.complete(firstTurn)).rejects.toBeInstanceOf(LlmAdapterError);
  });

  it("requires apiKey and model", () => {
    const { fetch } = createMockFetch({ json: {} });
    expect(() => createOpenAiLlm({ apiKey: "  ", model: "gpt", fetch })).toThrow(/apiKey/);
    expect(() => createOpenAiLlm({ apiKey: "sk", model: "", fetch })).toThrow(/model/);
  });
});
