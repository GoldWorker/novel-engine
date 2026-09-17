# Optional LLM adapters (`novel-engine/llm`)

[English](llm-adapters.md) | [中文文档](llm-adapters.zh-CN.md)

Fetch-based `LlmPort` implementations for **OpenAI**, **Anthropic**, and **DashScope** (Alibaba, OpenAI-compatible mode). Import them from the **optional** subpath so vendor HTTP clients never land in the default `novel-engine` or `novel-engine/worker` bundles.

```ts
import { createEngine, MemoryStore } from "novel-engine";
import { createOpenAiLlm } from "novel-engine/llm";
```

There is **no** `openai` / `@anthropic-ai/sdk` dependency. Adapters call `fetch` (injectable). Node ≥18 and modern browsers already provide it.

## Security

**Do not put raw provider API keys in a public web app.** A browser bundle that calls OpenAI / Anthropic / DashScope directly exposes the key to anyone who opens DevTools.

For production (including the Next.js novel workbench), put keys on a **BFF / route handler** and inject an `LlmPort` that talks to that gateway — or run these adapters only in Node tests, Electron, or other trusted local hosts.

These adapters are still useful: they normalize each vendor into the Engine's `{ text, toolCalls? }` contract so a host does not re-implement mapping.

## Install / import

```bash
npm install novel-engine
```

```ts
import {
  createOpenAiLlm,
  createAnthropicLlm,
  createDashScopeLlm,
  createVendorLlm,
  LlmAdapterError,
} from "novel-engine/llm";
```

`package.json` `exports` maps `novel-engine/llm` → `dist/llm.js`. Published `files` remain `dist/`, `README.md`, `LICENSE`.

## Factories

Shared options: `apiKey`, `model`, optional `baseUrl`, `fetch`, `headers`.

| Factory | Default `baseUrl` | Auth | HTTP |
| --- | --- | --- | --- |
| `createOpenAiLlm` | `https://api.openai.com/v1` | `Authorization: Bearer` | `POST {baseUrl}/chat/completions` |
| `createAnthropicLlm` | `https://api.anthropic.com` | `x-api-key` + `anthropic-version` | `POST {baseUrl}/v1/messages` |
| `createDashScopeLlm` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | same as OpenAI | same as OpenAI |
| `createVendorLlm({ provider, ... })` | per provider above | per provider | per provider |

`createDashScopeLlm` **reuses** the OpenAI-shaped client. Pass `baseUrl` for Singapore / US / other regions (must include `/compatible-mode/v1`). Example: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`.

Anthropic extra options: `maxTokens` (default `4096`), `anthropicVersion` (default `2023-06-01`).

HTTP failures throw `LlmAdapterError` (`status?`, `body?`).

## Mapping

`LlmCompletionRequest` → vendor chat/tools:

- **Messages** — `system` / `user` / `assistant` / `tool` (`toolCallId`, `name`)
- **Tools** — Engine specs are `{ name, description }` only. Adapters send a permissive JSON object schema (`additionalProperties: true`)
- **`agent`** — used by the Engine for routing/logging; **not** forwarded as a vendor body field (unknown keys can 400)

Vendor response → `LlmCompletionResult`:

- Assistant text (empty string when the model only issued tool calls)
- `toolCalls[]` with `id`, `name`, and `arguments` as a **parsed object** (OpenAI's JSON string and Anthropic's `input` object are both normalized)

Engine tool rounds send an assistant message **without** embedded `tool_calls`, then `role: "tool"` results. Adapters reconstruct the vendor-required assistant `tool_calls` / `tool_use` blocks from those following tool messages so the next turn is valid.

Sketch: [`examples/llm-openai.ts`](../examples/llm-openai.ts).

## Same-thread host

```ts
import { createEngine, MemoryStore } from "novel-engine";
import { createVendorLlm } from "novel-engine/llm";

const llm = createVendorLlm({
  provider: "openai", // or "anthropic" | "dashscope"
  apiKey: "sk-replace-me", // BFF / env on a trusted host — never a public SPA
  model: "gpt-4o-mini",
});

const engine = createEngine({ store: new MemoryStore(), llm });
await engine.run({ prompt: "写一本三章短篇：……" });
```

## Worker host

Keep the worker bundle free of keys when the UI is public. Prefer a same-origin BFF:

```ts
import { attachEngineWorker } from "novel-engine/worker";
import type { LlmPort } from "novel-engine/worker";

const llm: LlmPort = {
  async complete(request) {
    const response = await fetch("/api/novel-llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return response.json();
  },
};

attachEngineWorker(self, {
  async createPorts() {
    return { store: /* OpfsStore */, llm };
  },
});
```

The BFF can call `createOpenAiLlm` / `createDashScopeLlm` / `createAnthropicLlm` with a server-side key.

## Out of scope

Streaming, vision, vendor SDK packages, putting keys in this repo, wiring a Next.js app inside novel-engine.
