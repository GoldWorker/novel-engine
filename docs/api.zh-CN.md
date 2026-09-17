# novel-engine API（0.3.0）

[English](api.md) | [中文文档](api.zh-CN.md)

宿主应用的稳定面。除非另有说明，一律从 `novel-engine` 导入。发布包只包含 `dist/`、`README.md` 和 `LICENSE`。

本库是**纯前端 ESM SDK**。不包含 UI、React 绑定、Demo SPA、Arbiter（仲裁器）完整场景，或 ChapterAdvanceGate 审阅 UI。默认入口（`.` / `./worker`）不打包供应商 LLM 客户端。可选 fetch 适配器：[`novel-engine/llm`](llm-adapters.zh-CN.md)。可选宿主 Session：[`novel-engine/session`](session.zh-CN.md)。`src/` 从不导入 `node:fs` / `node:path`。

宿主怎么用按场景写在 [根目录 README](../README.zh-CN.md#使用场景)（[English](../README.md#usage-by-scenario)）。可跑通的源码在 [`examples/`](../examples/)。

## 包入口

| 子路径 | 模块 | 用途 |
| --- | --- | --- |
| `.` | `dist/index.js` | Engine、`route`、领域类型、stores、mocks、主线程 client、书籍快照 |
| `./worker` | `dist/worker.js` | `attachEngineWorker`，以及供专用 Worker 使用的 Engine / stores / snapshot |
| `./llm` | `dist/llm.js` | 可选 fetch `LlmPort` 适配器（OpenAI、Anthropic、DashScope）。不会打进 `.` 或 `./worker`。 |
| `./session` | `dist/session.js` | 可选同线程宿主 Session（S0–S3 检查、生成、自动写作、ChapterRunner、工作区）。不会打进 `.` / `./worker` / `./llm`。 |

```ts
import { createEngine, createEngineClient } from "novel-engine";
import { attachEngineWorker } from "novel-engine/worker";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

## Engine（引擎）

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `createEngine(deps)` | fn | 构造 `Engine`。必填：`store`、`llm`。可选：`maxSteps`（40）、`maxWorkerTurns`（16）、`onEvent`。 |
| `Engine` | class | 串行循环：加载 state → `route` → Worker 工具 → 重复。 |
| `EngineError` | class | 非法 `steer` / 重复 `run`。 |
| `EngineDeps` | type | 构造输入。 |
| `EngineResult` | type | `{ phase, steps, stoppedReason, lastInstruction, error? }`。 |
| `EngineStopReason` | type | `"complete" \| "max_steps" \| "paused" \| "idle"`。 |
| `EngineLoopEvent` | type | `step` / `paused` / `resumed` / `steered` / `stopped`。 |
| `inferPlanningStub(prompt)` | fn | 关键词桩：`长篇` → long，`中篇`/`分层` → mid，否则 short。 |

`Engine.run({ prompt, maxSteps })` 会引导 Progress，然后循环直到 complete / idle / pause / 上限。`pause` / `resume` / `steer` 是协作式的（下一个循环边界才生效）。`steer` 会持久化一条决策并设置 `flow=steering`。

同线程宿主：

```ts
const engine = createEngine({ store, llm });
await engine.run({ prompt: "写一本三章短篇：……" });
```

同线程 mock：[场景 1（短篇完结）](../README.zh-CN.md#scenario-short-book) 与 [场景 2（分层中长篇）](../README.zh-CN.md#scenario-layered-book)。

## `route` 与领域类型

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `route(state)` | fn | 纯函数。返回 `Instruction \| null`。无 IO。 |
| `State` | type | `route` 消费的显式快照。 |
| `Instruction` | type | `{ agent, task, reason, chapter? }`。 |
| `Phase` / `PHASES` | type / const | `init` → `premise` → `outline` → `writing` → `complete`。 |
| `Flow` / `FLOWS` | type / const | `writing` / `reviewing` / `rewriting` / `polishing` / `steering`。 |
| `PlanningTier` / `PLANNING_TIERS` | type / const | `short` / `mid` / `long`。 |
| `Progress` | type | 游标 + 已完成章节 + `layered`。 |
| `AgentId` / `AGENTS` | type / const | `architect_short` / `architect_long` / `writer` / `editor`。 |
| `canTransitionPhase` / `validatePhaseTransition` / `PhaseTransitionError` | fn / class | 只允许向前的 Phase。 |
| `canTransitionFlow` / `validateFlowTransition` / `FlowTransitionError` | fn / class | 非法 Flow 跳转失败。 |
| `plannerForTier` | fn | short → `architect_short`；mid/long → `architect_long`。 |
| `isPlanningTier` | fn | `"short" \| "mid" \| "long"` 的类型守卫。 |
| `latestCompleted` / `nextChapter` / `isResumable` | fn | Progress 辅助函数。 |
| `REVIEW_INTERVAL` / `shouldReview` | const / fn | 非分层全局审阅每 5 章一次。 |
| `ArcBoundary` | type | 分层弧/卷末事实。 |

## Ports（端口）

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `StorePort` | type | `loadState`、`loadProgress`、`saveProgress`、`read`、`write`、`has`，可选 `list`。 |
| `LlmPort` | type | `complete(request) → { text, toolCalls? }`。 |
| `LlmCompletionRequest` / `LlmCompletionResult` / `LlmToolCall` / `LlmMessage` / `LlmToolSpec` / `LlmRole` | types | 补全线路类型。 |

宿主针对网关或 WebLLM 实现 `LlmPort`，或从 [`novel-engine/llm`](llm-adapters.zh-CN.md) 导入可选 fetch 适配器。默认入口从不附带供应商客户端。**不要把原始 API Key 放进公开浏览器应用。**

## Stores（存储）

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `MemoryStore` | class | 内存 `StorePort`（路径 → 字节）。`list()` 是同步的。 |
| `OpfsStore` | class | OPFS `StorePort`。`OpfsStore.open(options)` 在缺失时抛 `OpfsUnavailableError`。 |
| `createOpfsStore(options?)` | fn | 有 OPFS 则用 OPFS；否则 `MemoryStore`（设 `fallbackToMemory: false` 改为抛错）。 |
| `isOpfsAvailable(storage?)` | fn | `navigator.storage.getDirectory` 或注入的 fake。 |
| `OpfsUnavailableError` | class | 严格 open 时抛出。 |
| `PATHS` | const | 逻辑布局（`meta/progress.json`、`outline.json` 等）。 |

`MemoryStore` 和 `OpfsStore` 实现了 `list()`，因此快照导出会包含每个文件。自定义适配器可以省略 `list`；导出时会探测已知书籍布局。可选 `remove(path)` 删除路径（缺失则为空操作）；Session 用它作废过期的 foundation audit。

见 [场景 3（浏览器持久化）](../README.zh-CN.md#scenario-opfs)。

## 书籍快照

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `exportBookSnapshot(store)` | fn | `Promise<Uint8Array>`，把所有 store 路径打成 zip（外加一份清单）。 |
| `importBookSnapshot(store, bytes)` | fn | 还原进 `StorePort`（merge；不删除目标里多出来的文件）。 |
| `SnapshotError` | class | 非法 zip、缺失/未知清单、路径逃逸。 |
| `BOOK_SNAPSHOT_FORMAT` | const | `"novel-engine-book-snapshot"`。 |
| `BOOK_SNAPSHOT_VERSION` | const | `1`。 |
| `BOOK_SNAPSHOT_MANIFEST_PATH` | const | zip 内的 `.novel-engine-snapshot.json`（不会写入 store）。 |
| `BookSnapshotManifest` | type | `{ format, version, files }`。 |

Zip 由 [fflate](https://github.com/101arrowz/fflate)（浏览器构建）生成。匹配 `.*.tmp` 的临时文件会被跳过。

见 [场景 5（书稿快照）](../README.zh-CN.md#scenario-snapshot)。

## Mock LLM

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `MockLlm` | class | 脚本化 `LlmPort`。耗尽会抛错。`MockLlm.fromHandler(fn)` 用于夹具回放。 |
| `ReplayLlm` | class | 纯结果列表回放。 |
| `MockLlmStep` / `MockLlmHandler` | types | 脚本条目。 |

测试以及短篇/分层 mock 书只用这些——没有在线供应商。

## 可选供应商 LLM（`novel-engine/llm`）

不属于 `.` 或 `./worker`。基于 fetch；无 `openai` / `@anthropic-ai/sdk` 依赖。指南：[llm-adapters.zh-CN.md](llm-adapters.zh-CN.md)（[English](llm-adapters.md)）。场景：[README §6](../README.zh-CN.md#scenario-llm)。

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `createOpenAiLlm(options)` | fn | Chat Completions。默认 base `https://api.openai.com/v1`。 |
| `createAnthropicLlm(options)` | fn | Messages API。默认 base `https://api.anthropic.com`。`maxTokens` 默认 4096。 |
| `createDashScopeLlm(options)` | fn | DashScope 的 OpenAI 兼容模式（`compatible-mode/v1`）。复用 OpenAI 客户端。 |
| `createVendorLlm({ provider, ... })` | fn | `provider`：`"openai"` \| `"anthropic"` \| `"dashscope"`。 |
| `LlmAdapterError` | class | HTTP / 映射失败（`status?`、`body?`）。 |
| `OPENAI_DEFAULT_BASE_URL` / `ANTHROPIC_DEFAULT_BASE_URL` / `DASHSCOPE_COMPAT_BASE_URL` | const | 文档化的默认值。 |
| `LlmAdapterOptions` / `OpenAiLlmOptions` / `AnthropicLlmOptions` / `DashScopeLlmOptions` / `VendorLlmOptions` / `LlmVendor` / `FetchLike` | types | `apiKey`、`model`，可选 `baseUrl`、`fetch`、`headers`。 |

tool call 的 `arguments` 始终是解析后的对象。**不要把 API Key 放进公开浏览器包**——生产请走 BFF。

示意：[`examples/llm-openai.ts`](../examples/llm-openai.ts)。

## 可选宿主 Session（`novel-engine/session`）

不属于 `.`、`./worker` 或 `./llm`。同线程检查、S2 生成/upsert/自动写作、S3 ChapterRunner，以及多书工作区。指南：[session.zh-CN.md](session.zh-CN.md)（[English](session.md)）。场景：[README §7](../README.zh-CN.md#scenario-session)。

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `createNovelSession({ store, llm?, bookId })` | fn | 同线程 session。S2 的 generate / auto-write 以及 S3 的 `chapter.write` 需要 `llm`。 |
| `NovelSession` | type | 检查 + `upsertFoundation` / `generateFoundation` / `startAutoWrite` / `chapter` / `subscribe` / 快照封装 / `close`。 |
| `createNovelWorkspace({ createStore, llm?, indexStore? })` | fn | 每个 `bookId` 一个 store。可选 `indexStore` 持久化 `_index.json`。 |
| `NovelWorkspace` | type | `createBook` / `open` / `switchTo` / `listBooks` / `close` / `currentBookId`。 |
| `FoundationMeta` / `FoundationGap` / `InspectResult` / `PlanningInfo` | types | 检查载荷。缺口含中英短提示。 |
| `FoundationPatch` / `FoundationKey` / `FOUNDATION_KEYS` / `GenerateFoundationOptions` / `StartAutoWriteOptions` / `AutoWriteResult` / `SessionEvent` | types | S2 生成 / 自动写作。 |
| `ChapterRunner` / `ChapterView` / `ChapterWriteInput` / `ChapterWriteResult` / `ChapterWriteMode` / `CHAPTER_WRITE_MODES` | type / const | S3 ChapterRunner。模式：`create` / `continue` / `rewrite` / `polish`。 |
| `FoundationIncompleteError` | class | `assertReadyToWrite` — `.gaps`。 |
| `SessionLlmRequiredError` / `FoundationGenerateError` | class | 缺少 `llm`；非法 generate JSON / keys。 |
| `SessionBusyError` | class | `startAutoWrite` / `chapter.write` 已在进行中。 |
| `ChapterConflictError` / `ChapterRunnerError` | class | 章节模式前置失败；作者循环 / `saveFinal` 失败。 |
| `SessionClosedError` / `WorkspaceClosedError` / `BookNotFoundError` | class | 已关闭的 session/工作区；未知 `bookId`。 |
| `WORKSPACE_INDEX_PATH` | const | `"_index.json"`。 |

**不在 S3：** Worker session 桥（S4）。

`generateFoundation` 要求 `LlmPort.complete` 在 **`text` 里返回 JSON**（不新增 tools）。默认 `fill_missing` 只 upsert 仍缺的键。`chapter.write` 是专用作者循环（MockLlm 用 `toolCalls`）；不跑 `Engine.run`，也不驱动 `pendingRewrites`。

示意：[`examples/session-workspace.ts`](../examples/session-workspace.ts)。

## Worker 宿主

来自 `novel-engine`：

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `createEngineClient(port)` | fn | 主线程对 `Worker` / message port 的封装。 |
| `EngineClient` | type | `start` / `pause` / `resume` / `steer` / `snapshot` / `onEvent` / `close`。 |
| `ENGINE_PROTOCOL` | const | `1`。 |
| `isEngineCommand` / `isEngineNotice` / `loopEventToHost` | fn | 协议守卫 / 映射。 |
| `EngineCommand` / `EngineNotice` / `EngineHostEvent` / `EngineSnapshot` | types | 带类型的消息。 |

来自 `novel-engine/worker`：

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `attachEngineWorker(port, { createPorts })` | fn | Worker 入口。`createPorts` 注入 `StorePort` + `LlmPort`。 |
| `EngineWorkerOptions` / `EngineWorkerPorts` | types | Worker 装配。 |
| `createEngine`、stores、`MockLlm`、snapshot 辅助 | 再导出 | 让 Worker 包不必导入主线程 client。 |

命令：`start`、`steer`、`pause`、`resume`、`snapshot`。通知：`event`、`snapshot`、`error`。

见 [场景 4（Web Worker）](../README.zh-CN.md#scenario-worker)。

## 高级 store 辅助

这些导出给需要装配或检查产物的宿主，但运行 Engine 并不要求使用它们：

`readJson`、`writeJson`、`readText`、`writeText`、`readJsonl`、`flattenOutline`、`estimatedChapterCapacity`、`checkArcBoundary`、`completedArcBoundaries`、`assembleNovelContext`、`SLIDING_SUMMARY_WINDOW`、`chapterSummaryPath`、`arcSummaryPath`、`volumeSummaryPath`、`arcReviewPath`、`globalReviewPath`，以及产物类型（`BookMetadata`、`OutlineEntry`、`VolumeOutline`、`Checkpoint`、`DecisionRecord` 等）。
