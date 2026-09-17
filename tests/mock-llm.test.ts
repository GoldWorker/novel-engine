import { describe, expect, it } from "vitest";
import { MockLlm, ReplayLlm, type LlmCompletionRequest } from "../src/index.js";

const hello: LlmCompletionRequest = {
  messages: [{ role: "user", content: "hi" }],
};

describe("MockLlm", () => {
  it("returns scripted completions in order", async () => {
    const llm = new MockLlm([{ text: "one" }, { text: "two", toolCalls: [] }]);
    expect(await llm.complete(hello)).toEqual({ text: "one" });
    expect(await llm.complete(hello)).toEqual({ text: "two", toolCalls: [] });
    expect(llm.callCount).toBe(2);
  });

  it("throws when the script is exhausted", async () => {
    const llm = new MockLlm([{ text: "only" }]);
    await llm.complete(hello);
    await expect(llm.complete(hello)).rejects.toThrow(/script exhausted at call 2/);
  });

  it("uses a handler fallback and records calls", async () => {
    const llm = MockLlm.fromHandler((request) => ({
      text: `echo:${request.messages[0]?.content ?? ""}`,
    }));
    const result = await llm.complete({
      messages: [{ role: "user", content: "ping" }],
      agent: "writer",
    });
    expect(result.text).toBe("echo:ping");
    expect(llm.calls[0]?.agent).toBe("writer");
  });

  it("runs function steps inside the script", async () => {
    const llm = new MockLlm([
      (request) => ({ text: String(request.messages.length) }),
      { text: "next" },
    ]);
    expect((await llm.complete(hello)).text).toBe("1");
    expect((await llm.complete(hello)).text).toBe("next");
  });
});

describe("ReplayLlm", () => {
  it("replays fixtures deterministically and then exhausts", async () => {
    const llm = new ReplayLlm([
      { text: "a" },
      {
        text: "",
        toolCalls: [{ id: "1", name: "save_book", arguments: { title: "T" } }],
      },
    ]);
    expect((await llm.complete(hello)).text).toBe("a");
    const second = await llm.complete(hello);
    expect(second.toolCalls?.[0]?.name).toBe("save_book");
    await expect(llm.complete(hello)).rejects.toThrow(/no fixture for call 3/);
  });
});
