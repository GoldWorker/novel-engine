# 可选 LLM 适配器（`novel-engine/llm`）

[English](llm-adapters.md) | [中文文档](llm-adapters.zh-CN.md)

基于 `fetch` 的 `LlmPort` 实现，覆盖 **OpenAI**、**Anthropic**、**DashScope**（阿里云，OpenAI 兼容模式）。请从**可选**子路径导入，这样供应商 HTTP 客户端不会进入默认的 `novel-engine` / `novel-engine/worker` 包。

```ts
import { createEngine, MemoryStore } from "novel-engine";
import { createOpenAiLlm } from "novel-engine/llm";
```

**没有** `openai` / `@anthropic-ai/sdk` 依赖。适配器调用 `fetch`（可注入）。Node ≥18 与现代浏览器已自带。

## 安全

**不要把供应商 API Key 放进公开 Web 应用。** 浏览器包如果直连 OpenAI / Anthropic / DashScope，任何人打开开发者工具都能看到密钥。

生产环境（包括 Next.js 小说工作台）请把密钥放在 **BFF / Route Handler**，注入一个只访问该网关的 `LlmPort`；或只在 Node 测试、Electron、其它受信任的本地宿主里使用这些适配器。

适配器仍然有用：它们把各家接口归一成 Engine 的 `{ text, toolCalls? }`，宿主不必自己做映射。

## 安装 / 导入

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

`package.json` 的 `exports` 把 `novel-engine/llm` 映射到 `dist/llm.js`。发布的 `files` 仍是 `dist/`、`README.md`、`LICENSE`。

## 工厂函数

公共选项：`apiKey`、`model`，可选 `baseUrl`、`fetch`、`headers`。

| 工厂 | 默认 `baseUrl` | 鉴权 | HTTP |
| --- | --- | --- | --- |
| `createOpenAiLlm` | `https://api.openai.com/v1` | `Authorization: Bearer` | `POST {baseUrl}/chat/completions` |
| `createAnthropicLlm` | `https://api.anthropic.com` | `x-api-key` + `anthropic-version` | `POST {baseUrl}/v1/messages` |
| `createDashScopeLlm` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 与 OpenAI 相同 | 与 OpenAI 相同 |
| `createVendorLlm({ provider, ... })` | 见上 | 见上 | 见上 |

`createDashScopeLlm` **复用** OpenAI 形态的客户端。新加坡 / 美国等区域请传 `baseUrl`（必须包含 `/compatible-mode/v1`）。例如：`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`。

Anthropic 额外选项：`maxTokens`（默认 `4096`）、`anthropicVersion`（默认 `2023-06-01`）。

HTTP 失败抛 `LlmAdapterError`（`status?`、`body?`）。

## 映射

`LlmCompletionRequest` → 供应商 chat/tools：

- **消息** — `system` / `user` / `assistant` / `tool`（`toolCallId`、`name`）
- **工具** — Engine 的 spec 只有 `{ name, description }`。适配器发送宽松的 JSON object schema（`additionalProperties: true`）
- **`agent`** — Engine 用来路由/打日志；**不会**作为供应商请求体字段转发（多余字段可能 400）

供应商响应 → `LlmCompletionResult`：

- 助手文本（模型只发 tool call 时为空字符串）
- `toolCalls[]`：`id`、`name`，以及解析成**对象**的 `arguments`（OpenAI 的 JSON 字符串与 Anthropic 的 `input` 对象都会归一）

Engine 的工具轮次会发送**不带**内嵌 `tool_calls` 的 assistant 消息，再跟 `role: "tool"` 结果。适配器会根据后续 tool 消息重建供应商要求的 assistant `tool_calls` / `tool_use`，好让下一轮合法。

示意：[examples/llm-openai.ts](../examples/llm-openai.ts)。

## 同线程宿主

```ts
import { createEngine, MemoryStore } from "novel-engine";
import { createVendorLlm } from "novel-engine/llm";

const llm = createVendorLlm({
  provider: "openai", // 或 "anthropic" | "dashscope"
  apiKey: "sk-replace-me", // BFF / 受信任宿主的环境变量 — 不要放进公开 SPA
  model: "gpt-4o-mini",
});

const engine = createEngine({ store: new MemoryStore(), llm });
await engine.run({ prompt: "写一本三章短篇：……" });
```

## Worker 宿主

公开 UI 时不要让 Worker 包携带密钥。优先走同源 BFF：

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

BFF 再用服务端密钥调用 `createOpenAiLlm` / `createDashScopeLlm` / `createAnthropicLlm`。

## 不包含

流式输出、视觉、供应商 SDK 包、把密钥放进本仓库、在 novel-engine 内接线 Next.js 应用。
