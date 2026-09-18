# novel-engine API（0.5.0）

[English](api.md) | [中文文档](api.zh-CN.md)

宿主应用的稳定面。除非另有说明，一律从 `novel-engine` 导入。发布包只包含 `dist/`、`README.md` 和 `LICENSE`。拷进宿主的副本用相对路径导入 `dist/*.js`，或构建后 `"novel-engine": "file:./vendor/novel-engine"` —— [指南 — 安装](guide.zh-CN.md#install)。

本库是**纯前端 ESM SDK**。不包含 UI、React 绑定、Demo SPA、Arbiter（仲裁器）完整场景，或 ChapterAdvanceGate 审阅 UI。默认入口（`.` / `./worker`）不打包供应商 LLM 客户端。可选 fetch 适配器：[`novel-engine/llm`](guide.zh-CN.md#scenario-llm)。可选开箱宿主：[`novel-engine/kit`](guide.zh-CN.md#scenario-kit)。可选宿主 Session（参考实现）：[`novel-engine/session`](#optional-host-session-novel-enginesession)。`src/` 从不导入 `node:fs` / `node:path`。

宿主怎么用：[指南](guide.zh-CN.md)（[English](guide.md)）。实现：[架构](architecture.zh-CN.md)。文档索引：[README](README.zh-CN.md)。可跑通的源码在 [`examples/`](../examples/)。

## 包入口

| 子路径 | 模块 | 用途 |
| --- | --- | --- |
| `.` | `dist/index.js` | Engine、`route`、领域类型、stores、mocks、主线程 client、书籍快照 |
| `./worker` | `dist/worker.js` | `attachEngineWorker`，以及供专用 Worker 使用的 Engine / stores / snapshot |
| `./llm` | `dist/llm.js` | 可选 fetch `LlmPort` 适配器（OpenAI、Anthropic、DashScope）。不会打进 `.` 或 `./worker`。 |
| `./session` | `dist/session.js` | 可选同线程宿主 Session（S0–S6 检查、生成、自动写作、ChapterRunner、基础设定影响、Worker 桥、工作区）。不会打进 `.` / `./worker` / `./llm`。 |
| `./kit` | `dist/kit.js` | 开箱 `NovelKit.create`（默认 OPFS + Worker）。不会打进 `.` / `./worker` / `./llm` / `./session`。 |
| `./kit/worker` | `dist/novel-kit.worker.js` | 随包装箱发布的 Kit Dedicated Worker。Init 握手后接 Session 桥。 |

```ts
import { createEngine, createEngineClient } from "novel-engine";
import { attachEngineWorker } from "novel-engine/worker";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
import { NovelKit } from "novel-engine/kit";
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

同线程 mock：[指南 §1（短篇完结）](guide.zh-CN.md#scenario-short-book) 与 [指南 §2（分层中长篇）](guide.zh-CN.md#scenario-layered-book)。`route` 实现：[架构](architecture.zh-CN.md#engine-循环-vs-route)。

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

宿主针对网关或 WebLLM 实现 `LlmPort`，或从 [`novel-engine/llm`](guide.zh-CN.md#scenario-llm) 导入可选 fetch 适配器。默认入口从不附带供应商客户端。**不要把原始 API Key 放进公开浏览器应用。**

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

见 [指南 §3（浏览器持久化）](guide.zh-CN.md#scenario-opfs)。写入策略：[架构](architecture.zh-CN.md#opfs-写入策略)。

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

见 [指南 §5（书稿快照）](guide.zh-CN.md#scenario-snapshot)。格式：[架构](architecture.zh-CN.md#快照格式)。

## Mock LLM

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `MockLlm` | class | 脚本化 `LlmPort`。耗尽会抛错。`MockLlm.fromHandler(fn)` 用于夹具回放。 |
| `ReplayLlm` | class | 纯结果列表回放。 |
| `MockLlmStep` / `MockLlmHandler` | types | 脚本条目。 |

测试以及短篇/分层 mock 书只用这些——没有在线供应商。

<a id="optional-vendor-llm-novel-enginellm"></a>

## 可选供应商 LLM（`novel-engine/llm`）

不属于 `.` 或 `./worker`。基于 fetch；无 `openai` / `@anthropic-ai/sdk` 依赖。怎么用（工厂、映射、BFF）：[指南](guide.zh-CN.md#scenario-llm)（[English](guide.md#scenario-llm)）。

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

<a id="optional-host-session-novel-enginesession"></a>

## 可选宿主 Session（`novel-engine/session`）

不属于 `.`、`./worker` 或 `./llm`。同线程检查、S2 生成/upsert/自动写作、S3 ChapterRunner、S4 Worker 桥、S5/S6 基础设定影响，以及多书工作区。本节是 **Session 契约**（方法、错误、S0–S6、协议）。怎么用：[指南 §7](guide.zh-CN.md#scenario-session)（[只评估](guide.zh-CN.md#scenario-session-impact-assess) · [仅元信息](guide.zh-CN.md#scenario-session-impact-meta) · [只影响后续](guide.zh-CN.md#scenario-session-impact-forward) · [确认闸门](guide.zh-CN.md#scenario-session-impact-confirm) · [批量改写](guide.zh-CN.md#scenario-session-impact-batch)）· [指南 §8.1](guide.zh-CN.md#scenario-session-worker-impact)。实现：[架构](architecture.zh-CN.md#session-桥session_protocol)。Kit 名称一一对应：[指南](guide.zh-CN.md#scenario-kit)。

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

S1–S3 仍在**同线程** `NovelSession`（事实来源）。**S4** 是对该对象的 `postMessage` 适配器——不是第二份业务规则。**S5/S6** 也在同一对象上（以及 Worker 桥）。

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `createNovelSession({ store, llm?, bookId })` | fn | 同线程 session。S2 的 generate / auto-write、S3 的 `chapter.write`、以及 S6 的 `rewriteChapters` 需要 `llm`。 |
| `NovelSession` | type | 检查 + `upsertFoundation` / `generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` / `startAutoWrite` / `chapter` / `subscribe` / 快照封装 / `close`。 |
| `createNovelWorkspace({ createStore, llm?, indexStore? })` | fn | 每个 `bookId` 一个 store。可选 `indexStore` 持久化 `_index.json`。 |
| `NovelWorkspace` | type | `createBook` / `open` / `switchTo` / `listBooks` / `close` / `currentBookId`。 |
| `createSessionClient(port, { bookId })` | fn | S4 主线程 `NovelSession`（消息 RPC）。 |
| `attachSessionWorker(port, { createSession })` | fn | S4 Worker 适配器；`createSession` 返回同线程 `NovelSession`。 |
| `SESSION_PROTOCOL` / `SESSION_NS` / `isSessionCommand` / `isSessionNotice` | const / fn | Session 协议（`v: 1`，`ns: "session"`）。 |
| `FoundationMeta` / `FoundationGap` / `InspectResult` / `PlanningInfo` | types | 检查载荷。缺口含中英短提示。 |
| `FoundationPatch` / `FoundationKey` / `FOUNDATION_KEYS` / `GenerateFoundationOptions` / `StartAutoWriteOptions` / `AutoWriteResult` / `SessionEvent` | types | S2 生成 / 自动写作。 |
| `FoundationImpactAssessment` / `FoundationImpactSeverity` / `FoundationImpactMode` / `FOUNDATION_IMPACT_SEVERITIES` / `FOUNDATION_IMPACT_MODES` / `AssessFoundationImpactOptions` / `ApplyFoundationChangeOptions` / `ApplyFoundationChangeResult` | types / const | S5 评估 + S6 应用。严重度：`meta_only` / `forward_only` / `rewrite_needed`。模式：`none` / `polish` / `rewrite`。 |
| `ChapterRunner` / `ChapterView` / `ChapterWriteInput` / `ChapterWriteResult` / `ChapterWriteMode` / `CHAPTER_WRITE_MODES` | type / const | S3 ChapterRunner。模式：`create` / `continue` / `rewrite` / `polish`。 |
| `FoundationIncompleteError` | class | `assertReadyToWrite` — `.gaps`。 |
| `SessionLlmRequiredError` / `FoundationGenerateError` | class | 缺少 `llm`；非法 generate JSON / keys。 |
| `SessionBusyError` | class | `startAutoWrite` / `chapter.write` / `applyFoundationChange` 已在进行中（含跨 Worker 桥）。 |
| `ChapterConflictError` / `ChapterRunnerError` | class | 章节模式前置失败；作者循环 / `saveFinal` 失败。 |
| `SessionClosedError` / `WorkspaceClosedError` / `BookNotFoundError` | class | 已关闭的 session/工作区；未知 `bookId`。 |
| `WORKSPACE_INDEX_PATH` | const | `"_index.json"`。 |

`generateFoundation` 要求 `LlmPort.complete` 在 **`text` 里返回 JSON**（不新增 tools）。走 Worker 桥时它在 **Worker 里**跑。`assessFoundationImpact(patch)` 评估的是**拟议**补丁——必须在 apply/upsert **之前**调用。`applyFoundationChange` 对 `rewrite_needed` 是两步确认闸门（已传 `confirmRewrite: true` 时不会再返回 `needs_confirm`）。提供的数组会整文件替换。只有 `rewriteChapters: true` 且 mode 为 `"rewrite"` | `"polish"` 才会重写章节。`chapter.write` 是专用作者循环（不是 `Engine.run` / 不是 `pendingRewrites`）。Worker 里的 `LlmPort` 应 `fetch` 宿主 BFF。

示意：[`examples/session-workspace.ts`](../examples/session-workspace.ts)（同线程）· [`examples/session-host.ts`](../examples/session-host.ts)（Worker）。

### 状态（S0–S6）

| 阶段 | 内容 | 本发行 |
| --- | --- | --- |
| **S0** | 类型、缺口表、`foundationMissing` 分层大纲修复 | 已完成 |
| **S1** | `createNovelSession` 读取/检查 + `createNovelWorkspace` | 已完成 |
| **S2** | `generateFoundation` / upsert / 自动写作（结构化 LLM） | 已完成 |
| **S3** | ChapterRunner / `chapter.get` / `saveFinal` / `write` | 已完成 |
| **S4** | Worker session 桥（`createSessionClient` / `attachSessionWorker`） | 已完成 |
| **S5** | `assessFoundationImpact`（规则优先，可选 LLM 精炼） | 已完成 |
| **S6** | `applyFoundationChange`（评估 → 确认 → upsert → 可选写章） | 已完成 |

### S0 — `foundationMissing`

中长篇只要有有效的非空 `layered_outline.json`，**不再需要**扁平 `outline.json`。短篇仍然需要。共享助手：`src/store/foundation.ts` 里的 `foundationMissing(store, tier?)`（Engine / `route` / Session 共用）。

推断顺序、指纹跳过、审查报告：[架构](architecture.zh-CN.md#foundationmissing--指纹--审查)。宿主缺口 UI：[指南 §7.1](guide.zh-CN.md#scenario-session-gaps)。

### S1 — `NovelSession`

S1 里 `llm` 对只读检查 / S5 启发式可选。**S2** 的 `generateFoundation` / `startAutoWrite`、**S3** 的 `chapter.write`、以及 **S6** 的 `rewriteChapters` 必须提供（缺失则 `SessionLlmRequiredError`）。每次读取都是 **store 直读**（Session 不缓存产物）。

| 方法 | 说明 |
| --- | --- |
| `bookId` | 宿主分配的 id。 |
| `getFoundation()` | `{ book, premise, outline, layeredOutline, characters, worldRules, audit, progress }` — 缺文件对应字段为 `null`。 |
| `getProgress()` | `store.loadProgress()`。可能为 `null`（还没有 `meta/progress.json`）。 |
| `inspectFoundation({ prompt? })` | `{ meta, gaps, readyToWrite, planning }`。`prompt`（或 `run_meta` / progress）决定缺口表的规划档。 |
| `assertReadyToWrite({ prompt? })` | 未就绪时抛 `FoundationIncompleteError`（带 `.gaps`）。 |
| `listArtifacts(prefix?)` | `listStorePaths`。 |
| `exportSnapshot()` / `importSnapshot(bytes)` | 现有书稿快照 API 的薄封装。 |
| `upsertFoundation(patch)` | 部分写入 `book` / `premise` / `outline` / `layeredOutline` / `characters` / `worldRules`（省略的键不变；提供的数组整文件替换）。指纹文件变化时作废 `meta/foundation_audit.json`。 |
| `generateFoundation({ prompt, keys, mode? })` | 结构化一次性 `LlmPort.complete`；从 `text` 解析 JSON；再 `upsertFoundation`。**不是** Engine 循环。 |
| `assessFoundationImpact(patch, { refineWithLlm? })` | S5：对**拟议**补丁做规则优先影响评估。可选 LLM JSON 精炼。**不写盘**。 |
| `applyFoundationChange({ patch, confirmRewrite?, rewriteChapters?, … })` | S6：评估 → 确认闸门 → upsert → 可选顺序 `chapter.write`。 |
| `startAutoWrite({ prompt, foundation?, generateMissing?, requireConfirmGaps?, maxSteps? })` | 可选 upsert/generate，然后要么 `{ status: "needs_foundation" }`，要么 `createEngine(...).run`。与 `chapter.write` / `applyFoundationChange` 互斥（`SessionBusyError`）。 |
| `chapter` | S3 ChapterRunner：`get` / `saveFinal` / `write`。同线程；不是 Engine 全书 Route。 |
| `subscribe(listener)` | `foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`。返回取消订阅函数。 |
| `close()` | 再调会抛 `SessionClosedError`。 |

**S4 不含：** Worker 上的 `NovelWorkspace`（工作区留在 UI 线程，每本书一个 session Worker）。

`readyToWrite` 为 `true` 当且仅当 `foundationMissing` 为空（与 Engine 相同的审查 / 写作阶段规则）。

#### 缺口

```ts
interface FoundationGap {
  key: string;          // foundationMissing 键：book | premise | outline | characters | world_rules | foundation_audit
  path: string;         // 逻辑 store 路径
  requiredFor: string;  // "write" | "short" | "mid" | "long"
  hint: string;         // 中文 + 短英文
}
```

中长篇缺大纲时，缺口指向 `layered_outline.json`，并说明扁平 `outline.json` 也能满足要求。

### S2 — 生成 / upsert / 自动写作

`generateFoundation` 是**结构化的一次性 LLM 调用 + `upsertFoundation`**。它不跑受限的 Engine 循环，也不写章节或草稿。宿主怎么用：[指南 §7.2](guide.zh-CN.md#scenario-session-foundation)。

<a id="upsertfoundationpatch"></a>

#### `upsertFoundation(patch)`

轻度形状校验后，按现有 `PATHS` 调用 `writeJson` / `writeText`。**省略的补丁键保持原样。** 一旦提供 `characters`、`worldRules`、`outline` 或 `layeredOutline` 数组，就是**整文件替换**（未出现的名字/章节会被删除，不是合并，也不是就地改名）。提供 `book` / `premise` 时同样整份替换对应产物。任何指纹文件（`book`、`premise`、`outline`、`characters`、`world_rules`、`layered_outline`）的写入都会**作废** `meta/foundation_audit.json`（若实现了 `StorePort.remove` 则删除；否则写入已清空的审查记录）。返回最新的 `getFoundation()`。

#### `generateFoundation({ prompt, keys, mode? })`

- `keys`：`book | premise | outline | layered_outline | characters | world_rules` 的子集
- `mode`：`fill_missing`（默认，只填 `inspectFoundation` 仍缺的键）或 `overwrite`
- `createNovelSession` 必须带 `llm`
- 一次 `LlmPort.complete`，**不带 tools**。模型必须在 **`text` 里返回 JSON 对象**（允许包一层 ` ```json `）。解析后交给 `upsertFoundation`。
- MockLlm：`{ text: JSON.stringify({ premise: "…", outline: [/* … */] }) }`

#### `startAutoWrite`

1. 可选 `foundation` → `upsertFoundation`
2. 可选 `generateMissing: true` → `generateFoundation({ prompt, keys: missing, mode: "fill_missing" })`
3. `inspectFoundation({ prompt })`
4. 若 `requireConfirmGaps !== false`（默认 **true**）且 `gaps.length > 0` → `{ status: "needs_foundation", gaps, meta }`，**不**跑 `Engine.run`
5. 若已就绪（或关掉确认）→ `createEngine({ store, llm }).run({ prompt, maxSteps })` → `{ status: "completed" | "stopped", result, meta }`（`stoppedReason === "complete"` 时为 `completed`）

`subscribe` 在 upsert 后发 `foundation_updated`，Engine 每步发 `auto_write_step`，`chapter.write` 期间发 `chapter_step`，needs-foundation 与 Engine 结束都发 `stopped`。

`startAutoWrite`、`chapter.write` 与 `applyFoundationChange` 共用 busy 标志：其中一个进行中再调用另一个（或自己）会抛 `SessionBusyError`。见 [架构](architecture.zh-CN.md#busy--session-生命周期)。

### S1 — `NovelWorkspace`

一书一个 `StorePort`，由宿主注入。怎么用：[指南 §7.6](guide.zh-CN.md#scenario-session-workspace)。

| 方法 | 说明 |
| --- | --- |
| `createBook({ bookId?, title? })` | 省略时分配 id。打开新书（关闭上一份 session）。 |
| `open(bookId)` / `switchTo(bookId)` | 返回 session。上一份 session 已关闭（再用不行，`SessionClosedError`）。未知 id → `BookNotFoundError`。 |
| `listBooks()` | 内存索引；设了 `indexStore` 时持久化到 `_index.json`。 |
| `close()` | 关闭当前 session 和工作区。 |
| `currentBookId` | 当前书，或 `null`。 |

工作区会**缓存**每个 `bookId` 第一次返回的 store。Memory 测试仍应一书一个 `MemoryStore`（Map 或工厂缓存）。不支持在同一个 store 里用路径前缀隔离。

### S3 — ChapterRunner

同线程 session 上的单章创建 / 续写 / 改写 / 打磨。复用 `src/workers/tools.ts` 里的作者工具（`plan_chapter` / `draft_chapter` / `commit_chapter` / `novel_context` / `read_chapter`）。**不**跑 `Engine.run`，**不**驱动 `pendingRewrites`，也**不是**全书 Route。区别：[架构](architecture.zh-CN.md#chapterrunner-vs-enginerun-vs-pendingrewrites)。怎么用：[指南 §7.3](guide.zh-CN.md#scenario-session-chapter)。

| 方法 | 说明 |
| --- | --- |
| `chapter.get(n)` | 从 `drafts/NN.*`、`chapters/NN.md`、`summaries/NN.json` 读 `{ chapter, plan, draft, final, summary }`。全无则 `null`。 |
| `chapter.saveFinal(n, markdown)` | 写 `chapters/NN.md`，更新 `progress.completedChapters` / checkpoint。不调 LLM。 |
| `chapter.write({ chapter, mode, instruction?, title?, force? })` | 在 `LlmPort` + 现有作者工具上的专用循环。需要 `llm`。 |

#### 模式

| 模式 | 前置条件 | 行为 |
| --- | --- | --- |
| `create` | 无终稿（除非 `force: true`） | `plan_chapter` → `draft_chapter(write)` → `commit_chapter`。已有终稿 → `ChapterConflictError`。 |
| `continue` | 有草稿、无终稿 | `draft_chapter(append)` 后续写再 commit。 |
| `rewrite` | 有终稿 | 带 `instruction` 重新 plan/draft/commit。覆盖已完成章（session override；**不是** `pendingRewrites`）。 |
| `polish` | 有终稿 | 对现有终稿做较轻改写（同一工具路径，polish 向提示）。 |

`chapter.write` 只在 `plan_chapter` / `commit_chapter` 上注入内部 `sessionOverride`，以便覆盖已完成章。没有该标志时，Engine 顺序 saga 不变。

MockLlm：脚本 `toolCalls`（与 S2 的 `generateFoundation` 用 `text` 里的 JSON 不同）。

<a id="s4--worker-桥"></a>

### S4 — Worker 桥

工作台怎么用：[指南 §8](guide.zh-CN.md#scenario-session-worker)。线路细节：[架构](architecture.zh-CN.md#session-桥session_protocol)。

同线程 `NovelSession` 仍是实现。`attachSessionWorker` 在 Worker 里构造一份；`createSessionClient` 是形状相同的 RPC 客户端。**不要从 `novel-engine/worker` 导入这些。**

| 部件 | 说明 |
| --- | --- |
| `attachSessionWorker(port, { createSession })` | Worker 适配器。`createSession` 注入 `StorePort` + `LlmPort` 并返回 `createNovelSession(...)`。 |
| `createSessionClient(port, { bookId })` | 主线程 `NovelSession`。`bookId` 必须与 Worker session 一致。 |
| 协议 | `SESSION_PROTOCOL === 1`，`ns: "session"`。命令：`inspectFoundation` / `getFoundation` / `getProgress` / `assertReadyToWrite` / `listArtifacts` / `exportSnapshot` / `importSnapshot` / `upsertFoundation` / `generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` / `startAutoWrite` / `chapterGet` / `chapterSaveFinal` / `chapterWrite` / `close`。通知：`result` / `event` / `error`。 |
| Busy | Worker 侧 `SessionBusyError`：`startAutoWrite` / `applyFoundationChange` 进行中会挡住跨桥的 `chapter.write`。 |
| `generateFoundation` / S5–S6 | **在 Worker 里跑**（书的 `StorePort` 在那边）。 |
| `LlmPort` | `fetch` 宿主 BFF。**不要把供应商 API Key 打进公开 Worker 包**。 |
| 事件 | Worker 转发 `subscribe` 事件（`foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`）。 |

### S5 — `assessFoundationImpact`

对**拟议**的 `FoundationPatch` 对照当前 store 调用，且必须在 `applyFoundationChange` / `upsertFoundation` **之前**。不要等同一补丁已经写入再评估——再调一次通常会看起来像「没有变更」。**规则优先**的启发式是确定性的。当 `refineWithLlm: true` 且提供了 `LlmPort` 时，可用一次性 JSON 精炼结果——**不能把启发式 `severity` 降级**。

宿主怎么用：[指南 §7.2a](guide.zh-CN.md#scenario-session-impact-assess)。

| 字段 | 含义 |
| --- | --- |
| `severity` | `meta_only` — 标题/标签/简介类 `meta/book.json`。`forward_only` — 主要影响未写的后续章节。`rewrite_needed` — 角色 / 世界 / 已写情节与终稿矛盾。 |
| `suggestedChapters` | 可能需要 rewrite/polish 的已写章节（有 `chapters/NN.md`，排序去重）。 |
| `suggestedRanges` | 由 `suggestedChapters` 压缩的闭区间（如 `{ start: 1, end: 3 }`）。 |
| `suggestedMode` | `none` \| `polish` \| `rewrite`。 |
| `reasons` / `notes` | 给宿主 UI 的中英短句。 |
| `changedKeys` | 实际内容发生变化的基础设定键。 |
| `source` | `"heuristics"` 或 `"llm"`。 |

启发式查看 `meta/*`、`premise.md`、`outline.json`、`layered_outline.json`、`characters.json`、`world_rules.json`，以及已写的 `chapters/`（`drafts/` 只会写进 notes）。本 API **不得**改 store，也不得重写章节。宿主顺序：`assess(patch)` → 可选 UI → `applyFoundationChange({ patch, … })`。

### S6 — `applyFoundationChange`

编排：评估 → `rewrite_needed` 确认闸门 → `upsertFoundation` → 对 `suggestedChapters` 可选顺序 `chapter.write`。章节**不会自动重写**——宿主必须传 `rewriteChapters: true`。

已传 `confirmRewrite: true` 时**不会**再返回 `needs_confirm`。两步宿主怎么用：[指南 §7.2d](guide.zh-CN.md#scenario-session-impact-confirm)。Kit：`applyFoundation`（[指南](guide.zh-CN.md#scenario-kit)）。

| 选项 | 说明 |
| --- | --- |
| `patch` | 与 `upsertFoundation` 相同的 `FoundationPatch`。提供的 `characters` / `worldRules` / `outline` / `layeredOutline` 数组会整文件替换。 |
| `requireConfirmRewrite` | 默认 **true**。severity 为 `rewrite_needed` 且未 `confirmRewrite` → `{ status: "needs_confirm" }`，**不写盘**。已传 `confirmRewrite: true` 时不会再返回 `needs_confirm`。 |
| `confirmRewrite` | 宿主确认接受需要改写的补丁。只放在 `needs_confirm` 之后的重试上。 |
| `rewriteChapters` | 默认 **false**。为 true 时对建议（或 `chapters` 覆盖）终稿顺序 `chapter.write`（`rewrite` 或 `polish`）。`suggestedMode` 为 `"none"` 时无操作，除非宿主再传 `mode`。 |
| `mode` | 可选覆盖 `suggestedMode`（`rewrite` \| `polish`）。 |
| `refineWithLlm` | 转给 S5。 |

`meta_only` / `forward_only` 无需确认即可 apply。指纹文件仍会经 `upsertFoundation` 作废 `foundation_audit`。与 `startAutoWrite` / `chapter.write` 共用 busy 标志。

宿主场景：[§7.2a](guide.zh-CN.md#scenario-session-impact-assess) · [§7.2b](guide.zh-CN.md#scenario-session-impact-meta) · [§7.2c](guide.zh-CN.md#scenario-session-impact-forward) · [§7.2d](guide.zh-CN.md#scenario-session-impact-confirm) · [§7.2e](guide.zh-CN.md#scenario-session-impact-batch) · [§8.1](guide.zh-CN.md#scenario-session-worker-impact) · [常见坑](guide.zh-CN.md#pitfalls)。

### 错误

| 错误 | 何时 |
| --- | --- |
| `FoundationIncompleteError` | `assertReadyToWrite` — `.gaps` 即检查表。 |
| `SessionLlmRequiredError` | `generateFoundation` / Engine 版 `startAutoWrite` / `chapter.write` / `applyFoundationChange({ rewriteChapters: true })` 未提供 `llm`。 |
| `FoundationGenerateError` | 非法 `keys`，或 `complete().text` 不是 JSON 对象。 |
| `SessionBusyError` | `startAutoWrite`、`chapter.write` 或 `applyFoundationChange` 进行中再调用另一个（同线程与 Worker 桥均如此）。 |
| `ChapterConflictError` | 模式前置失败（已有终稿还 create、没有草稿却 continue、没有终稿却 rewrite/polish）。 |
| `ChapterRunnerError` | 非法章号、空的 `saveFinal`、或作者循环没有产出终稿。 |
| `SessionClosedError` | 在已关闭的 session 上调用（包括 `switchTo` 之后）。 |
| `WorkspaceClosedError` | `close()` 后再调工作区方法。 |
| `BookNotFoundError` | `open` / `switchTo` 未知 `bookId`。 |

不提供 Workspace-over-Worker：把 `createNovelWorkspace` 留在 UI 线程，每本书开一个 session Worker。

<a id="optional-novelkit-novel-enginekit"></a>

## 可选 NovelKit（`novel-engine/kit`）

不属于 `.`、`./worker`、`./llm` 或 `./session`。开箱门面：**只有 `NovelKit.create`**。默认 `store: "opfs"` + `runtime: "worker"`。宿主从包装箱拿到现成 Worker（`dist/novel-kit.worker.js`）。怎么用：[指南](guide.zh-CN.md#scenario-kit)（[English](guide.md#scenario-kit)）。Init 握手：[架构](architecture.zh-CN.md#kit-worker-init)。Session 仍是参考 API。

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `NovelKit.create(options?)` | fn | 异步工厂。没有公开构造函数。 |
| `NovelKit` | class | 场景方法包装 Session。只读 `bookId`、`storeKind`、`runtime`。 |
| `NovelKitOptions` | type | `runtime`、`store`、`llm`、`llmEndpoint`、`bookId`、`workerUrl`、`workspace`、`fallbackToMemory`、`opfs`。 |
| `KitStoreKind` / `KitRuntime` | type | `"opfs" \| "memory" \| "custom"` / `"worker" \| "main"`。 |
| `defaultKitWorkerUrl()` | fn | `new URL("./novel-kit.worker.js", import.meta.url)`，相对 `dist/kit.js`。 |
| `KIT_PROTOCOL` / `KIT_NS` / `isKitInitCommand` / `isKitNotice` | const / fn | Kit init 握手（`v: 1`，`ns: "kit"`）。与 Session 分开。 |
| `attachKitWorker(port)` | fn | Worker 侧 init + 挂上 session（也是随包装箱发布的 Worker 入口）。 |
| `KitLlmRequiredError` | class | `runtime: "main"` 却没传 `llm`。 |
| `KitWorkerError` | class | 没有 `Worker`、Worker 模式用了自定义 store、init 超时。 |
| `KitWorkspaceDisabledError` | class | `workspace: false` 或自定义 `StorePort` 时调用多书方法。 |
| `KitClosedError` | class | `dispose()` 之后再调用。 |

`runtime: "main"` 必须传 `llm`；Worker 模式下可选（Worker 用 `llmEndpoint`；两个都传时 Worker 仍用 `llmEndpoint`）。`bookId` 默认 `"default"`。没有 OPFS 且 `fallbackToMemory` 为 true（默认）时回落到 `MemoryStore`。

示意：[`examples/kit-host.ts`](../examples/kit-host.ts)。

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

见 [指南 §4（Web Worker）](guide.zh-CN.md#scenario-worker)。协议：[架构](architecture.zh-CN.md#engine-worker-协议engine_protocol)。

## 高级 store 辅助

这些导出给需要装配或检查产物的宿主，但运行 Engine 并不要求使用它们：

`readJson`、`writeJson`、`readText`、`writeText`、`readJsonl`、`flattenOutline`、`estimatedChapterCapacity`、`checkArcBoundary`、`completedArcBoundaries`、`assembleNovelContext`、`SLIDING_SUMMARY_WINDOW`、`chapterSummaryPath`、`arcSummaryPath`、`volumeSummaryPath`、`arcReviewPath`、`globalReviewPath`，以及产物类型（`BookMetadata`、`OutlineEntry`、`VolumeOutline`、`Checkpoint`、`DecisionRecord` 等）。
