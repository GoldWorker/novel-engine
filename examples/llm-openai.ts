/**
 * Scenario 6 — inject a real LlmPort via novel-engine/llm.
 * 场景 6：通过 novel-engine/llm 注入真实 LlmPort。
 *
 * Fetch adapters (OpenAI / Anthropic / DashScope). No vendor SDK packages.
 * 基于 fetch 的适配器。无 openai / @anthropic-ai/sdk 依赖。
 *
 * Do not embed API keys in a public browser bundle. Prefer a Next.js BFF
 * in production; this sketch is for Node tests, Electron, or trusted hosts.
 * 不要把 API Key 放进公开浏览器包。生产请走 BFF；本文件仅示意。
 */

import { createEngine, MemoryStore } from "novel-engine";
import {
  createAnthropicLlm,
  createDashScopeLlm,
  createOpenAiLlm,
  createVendorLlm,
} from "novel-engine/llm";

const PROMPT = "写一本三章短篇：灯塔看守人在风暴后捡到一封没有寄信人的信。";

/** Replace with a server env / BFF. Never commit a real key. */
const apiKey = "sk-replace-me";

export function openAiLlm() {
  return createOpenAiLlm({
    apiKey,
    model: "gpt-4o-mini",
    // baseUrl: "https://api.openai.com/v1",
    // fetch: globalThis.fetch,
    // headers: { "x-host": "novel-workbench" },
  });
}

export function anthropicLlm() {
  return createAnthropicLlm({
    apiKey,
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
  });
}

export function dashScopeLlm() {
  return createDashScopeLlm({
    apiKey,
    model: "qwen-plus",
    // International / other regions — must keep compatible-mode/v1:
    // baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  });
}

export async function runWithOpenAi(): Promise<void> {
  const engine = createEngine({
    store: new MemoryStore(),
    llm: createVendorLlm({
      provider: "openai",
      apiKey,
      model: "gpt-4o-mini",
    }),
  });
  await engine.run({ prompt: PROMPT });
}
