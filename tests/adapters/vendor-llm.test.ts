import { describe, expect, it } from "vitest";
import * as main from "../../src/index.js";
import {
  createAnthropicLlm,
  createDashScopeLlm,
  createOpenAiLlm,
  createVendorLlm,
  LlmAdapterError,
} from "../../src/adapters/llm/index.js";
import { createMockFetch } from "../helpers/fake-fetch.js";

describe("createVendorLlm", () => {
  it("routes openai / anthropic / dashscope to the matching factory", async () => {
    const openaiFetch = createMockFetch({
      json: { choices: [{ message: { content: "o" } }] },
    });
    const anthropicFetch = createMockFetch({
      json: { content: [{ type: "text", text: "a" }] },
    });
    const dashFetch = createMockFetch({
      json: { choices: [{ message: { content: "d" } }] },
    });

    const openai = createVendorLlm({
      provider: "openai",
      apiKey: "sk",
      model: "gpt-4o-mini",
      fetch: openaiFetch.fetch,
    });
    const anthropic = createVendorLlm({
      provider: "anthropic",
      apiKey: "sk-ant",
      model: "claude-sonnet-4-20250514",
      fetch: anthropicFetch.fetch,
    });
    const dash = createVendorLlm({
      provider: "dashscope",
      apiKey: "sk-dash",
      model: "qwen-plus",
      fetch: dashFetch.fetch,
    });

    expect((await openai.complete({ messages: [{ role: "user", content: "hi" }] })).text).toBe("o");
    expect((await anthropic.complete({ messages: [{ role: "user", content: "hi" }] })).text).toBe(
      "a",
    );
    expect((await dash.complete({ messages: [{ role: "user", content: "hi" }] })).text).toBe("d");

    expect(openaiFetch.calls[0]?.url).toContain("api.openai.com");
    expect(anthropicFetch.calls[0]?.url).toContain("api.anthropic.com");
    expect(dashFetch.calls[0]?.url).toContain("compatible-mode/v1");
  });

  it("throws on an unknown provider at runtime", () => {
    const { fetch } = createMockFetch({ json: {} });
    expect(() =>
      createVendorLlm({
        provider: "webllm",
        apiKey: "x",
        model: "m",
        fetch,
      } as never),
    ).toThrow(LlmAdapterError);
  });
});

describe("bundle isolation", () => {
  it("does not export vendor factories from the default novel-engine entry", () => {
    expect(main).not.toHaveProperty("createOpenAiLlm");
    expect(main).not.toHaveProperty("createAnthropicLlm");
    expect(main).not.toHaveProperty("createDashScopeLlm");
    expect(main).not.toHaveProperty("createVendorLlm");
    expect(typeof createOpenAiLlm).toBe("function");
    expect(typeof createAnthropicLlm).toBe("function");
    expect(typeof createDashScopeLlm).toBe("function");
  });
});
