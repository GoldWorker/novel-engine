# NovelKit（`novel-engine/kit`）

[English](guide-kit.md) | [中文文档](guide-kit.zh-CN.md)

开箱即用的宿主门面。**只有 `NovelKit.create`**（没有 `new` + `init`）。包装箱**自带可用的 Worker**（`dist/novel-kit.worker.js`），宿主不必再维护一份 Worker 源码。

Session（`novel-engine/session`）仍是参考实现。Kit 只做组合 + 默认值 + 随包装箱发布的 Worker。业务规则（确认闸门、整表替换、`rewriteChapters` 默认 false、会话中途不换 LLM）仍在 Session 上。

契约：[api](api.zh-CN.md#optional-novelkit-novel-enginekit)。实现 / init 握手：[架构](architecture.zh-CN.md#kit-worker-init)。可复制的 Session 流程：[指南 §7–8](guide.zh-CN.md#scenario-session)。

包版本 **0.5.0**。

## 默认值

| 选项 | 默认 | 如何关掉 |
| --- | --- | --- |
| `store` | `"opfs"` | `"memory"`（Node/测试）或传入 `StorePort`（仅 `runtime: "main"`） |
| `runtime` | `"worker"` | `"main"`（Node/测试） |
| `workspace` | `true` | `false` — `createBook` / `switchBook` / `listBooks` 会抛错 |
| `bookId` | `"default"` | 传入非空字符串 |
| `llmEndpoint` | `"/api/llm"` | 你的 BFF 路由 |
| `fallbackToMemory` | `true` | `false`：没有 OPFS 时抛 `OpfsUnavailableError` |

实例只读：`bookId`、`storeKind`（`"opfs"` \| `"memory"` \| `"custom"`）、`runtime`。

## 安装

与 [宿主指南](guide.zh-CN.md#install) 相同的拷贝 / 登记处方式。额外子路径：

```ts
import { NovelKit } from "novel-engine/kit";
// 相对 dist：
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
```

TypeScript `paths`（仅打包器）：`"novel-engine/kit": ["./vendor/novel-engine/src/kit/index.ts"]`。

Worker 产物是 `dist/novel-kit.worker.js`（导出 `novel-engine/kit/worker`）。打包 `files` 包含整个 `dist/`。

## 浏览器（默认 OPFS + Worker）

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  llmEndpoint: "/api/llm", // worker 的 LlmPort.complete → fetch(llmEndpoint)。Worker 里不要放 API Key。
  // 省略 bookId → "default"
});

const { gaps, readyToWrite } = await kit.inspect({ prompt: "写一本三章短篇" });
await kit.fillFoundation({ book: { title: "无主的信", synopsis: "灯塔与潮" } });
const outcome = await kit.startBook({
  prompt: "写一本三章短篇：……",
  generateMissing: true, // 可能返回 { status: "needs_foundation", gaps }
});

kit.subscribe((event) => {
  console.log(event.type);
});
kit.dispose(); // 关闭 session 并 terminate Worker
```

Worker 模式下即使传入 `llm` **也会被忽略**——Worker 始终使用 `llmEndpoint`。只在 `runtime: "main"` 时传 `llm`。

规范示意：[`examples/kit-host.ts`](../examples/kit-host.ts)。

## Node / 测试（main + memory）

`runtime: "main"` **必须**传 `llm`。

```ts
import { MockLlm } from "novel-engine";
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  runtime: "main",
  store: "memory",
  llm: new MockLlm([{ text: JSON.stringify({ premise: "……" }) }]),
  bookId: "letter",
});
```

## 随包装箱发布的 Worker URL

`NovelKit.create` 的解析方式：

```ts
new URL("./novel-kit.worker.js", import.meta.url); // 相对 dist/kit.js
```

把 `dist/` 整目录 vendoring / `file:` 拷贝时这样就能工作。如果打包器改写了 `import.meta.url` 导致 Worker 404，把 `node_modules/novel-engine/dist/novel-kit.worker.js`（或 `vendor/.../dist/novel-kit.worker.js`）拷进宿主的 **`public/`**（或等价目录），再传 `workerUrl`：

```ts
await NovelKit.create({
  workerUrl: "/novel-kit.worker.js",
  llmEndpoint: "/api/llm",
});
```

**不必**为 Kit 手写 session Worker。发布文件已经在 **init** 握手之后运行 `attachSessionWorker` + `createNovelSession` + OPFS/memory。

## Worker 上的 LLM

create 时，主线程先发 **init**（`ns: "kit"`），带上 `llmEndpoint`、`bookId`、OPFS 选项，等到 **ready**，再挂上现有的 Session 桥（`ns: "session"`）。Worker 的 `LlmPort.complete` 就是 `fetch(llmEndpoint)`，body 为 completion 请求 JSON。供应商密钥放在 BFF，不要放进 Worker。

Init 协议：[架构](architecture.zh-CN.md#kit-worker-init)。

## 场景方法

名称一一对应 Session（不重写业务规则）：

| Kit | Session |
| --- | --- |
| `inspect` | `inspectFoundation` |
| `assertReady` | `assertReadyToWrite` |
| `fillFoundation` | `upsertFoundation` |
| `generateFoundation` | `generateFoundation` |
| `startBook` | `startAutoWrite` |
| `assessFoundation` | `assessFoundationImpact` |
| `applyFoundation` | `applyFoundationChange` |
| `getChapter` / `writeChapter` / `saveChapter` | `chapter.get` / `write` / `saveFinal` |
| `getMeta` / `getProgress` / `listArtifacts` | `getFoundation` / `getProgress` / `listArtifacts` |
| `createBook` / `switchBook` / `listBooks` | 工作区 API |
| `exportBook` / `importBook` | `exportSnapshot` / `importSnapshot` |
| `subscribe` / `dispose` | `subscribe` / `close`（外加 `worker.terminate`） |

保持不变的 Session 行为：

- 对**拟议**补丁先 `assessFoundation`，再 apply/upsert。
- `applyFoundation` 不带 `confirmRewrite` 时，若严重度为 `rewrite_needed` 则返回 `{ status: "needs_confirm" }`。`confirmRewrite: true` 不会得到 `needs_confirm`。
- `characters` / `worldRules` / `outline` / `layeredOutline` 是**整文件替换**。
- `rewriteChapters` 默认 **false**——章节不会自动改写。
- 会话中途不换 LLM（Worker 的 endpoint 在 init 时定死）。

`startBook` 在默认 `requireConfirmGaps: true` 时，可能返回 `{ status: "needs_foundation" }` 而不跑 `Engine.run`。

`workspace: false`（或自定义 `StorePort`）时，多书方法会抛出明确的 `KitWorkspaceDisabledError`。

## Kit 不是什么

- 不是第二份 Engine，也不是第二份 Session。底层 Session / Engine / Session Worker 协议保持现状。
- 不是 `novel-engine/worker`（那是 Engine Worker）。Kit 的 Worker 是 `novel-engine/kit/worker`。
- CI 不需要真实 OPFS——测试走 `runtime: "main"` + `store: "memory"`，以及假 port 上的 init 接线。

常见坑（先评估拟议补丁、整表替换、`getProgress()` 为 null）：[指南](guide.zh-CN.md#pitfalls)。
