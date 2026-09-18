# Session API（`novel-engine/session`）— S0–S6

[English](session.md) | [中文文档](session.zh-CN.md)

可选宿主 Session 的参考与实现说明。**可复制的宿主流程：** [指南 §7–8](guide.zh-CN.md#scenario-session)（[English](guide.md#scenario-session)）。实现（busy、指纹、协议）：[架构](architecture.zh-CN.md)。导出表：[api](api.zh-CN.md)。

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

包版本 **0.4.0**。本文覆盖 **S0–S6**。

## 状态

| 阶段 | 内容 | 本发行 |
| --- | --- | --- |
| **S0** | 类型、缺口表、`foundationMissing` 分层大纲修复 | 已完成 |
| **S1** | `createNovelSession` 读取/检查 + `createNovelWorkspace` | 已完成 |
| **S2** | `generateFoundation` / upsert / 自动写作（结构化 LLM） | 已完成 |
| **S3** | ChapterRunner / `chapter.get` / `saveFinal` / `write` | 已完成 |
| **S4** | Worker session 桥（`createSessionClient` / `attachSessionWorker`） | 已完成 |
| **S5** | `assessFoundationImpact`（规则优先，可选 LLM 精炼） | 已完成 |
| **S6** | `applyFoundationChange`（评估 → 确认 → upsert → 可选写章） | 已完成 |

S1–S3 仍在**同线程** `NovelSession`（事实来源）。**S4** 是对该对象的 `postMessage` 适配器——不是第二份业务规则。**S5/S6** 也在同一对象上（以及 Worker 桥）。

## S0 — `foundationMissing`

中长篇只要有有效的非空 `layered_outline.json`，**不再需要**扁平 `outline.json`。短篇仍然需要。共享助手：`src/store/foundation.ts` 里的 `foundationMissing(store, tier?)`（Engine / `route` / Session 共用）。

推断顺序、指纹跳过、审查报告：[架构](architecture.zh-CN.md#foundationmissing--指纹--审查)。宿主缺口 UI：[指南 §7.1](guide.zh-CN.md#scenario-session-gaps)。

## S1 — `NovelSession`

```ts
import { MemoryStore } from "novel-engine";
import { createNovelSession } from "novel-engine/session";

const store = new MemoryStore();
const session = await createNovelSession({ store, llm, bookId: "letter" });

await session.getFoundation();
await session.inspectFoundation({ prompt: "写一本分层中篇：……" });
await session.assertReadyToWrite();
```

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

### 缺口

```ts
interface FoundationGap {
  key: string;          // foundationMissing 键：book | premise | outline | characters | world_rules | foundation_audit
  path: string;         // 逻辑 store 路径
  requiredFor: string;  // "write" | "short" | "mid" | "long"
  hint: string;         // 中文 + 短英文
}
```

中长篇缺大纲时，缺口指向 `layered_outline.json`，并说明扁平 `outline.json` 也能满足要求。

## S2 — 生成 / upsert / 自动写作

`generateFoundation` 是**结构化的一次性 LLM 调用 + `upsertFoundation`**。它不跑受限的 Engine 循环，也不写章节或草稿。宿主怎么用：[指南 §7.2](guide.zh-CN.md#scenario-session-foundation)。

### `upsertFoundation(patch)`

```ts
await session.upsertFoundation({
  book: { title: "无主的信", synopsis: "……" },
  premise: "……",
  outline: [{ chapter: 1, title: "风暴之后", summary: "……" }], // 整文件替换
  characters: [{ name: "林守" }], // 整表替换；未出现的名字会被删除
  worldRules: [{ name: "信与潮", description: "……" }], // 整文件替换
});
```

轻度形状校验后，按现有 `PATHS` 调用 `writeJson` / `writeText`。**省略的补丁键保持原样。** 一旦提供 `characters`、`worldRules`、`outline` 或 `layeredOutline` 数组，就是**整文件替换**（未出现的名字/章节会被删除，不是合并，也不是就地改名）。提供 `book` / `premise` 时同样整份替换对应产物。任何指纹文件（`book`、`premise`、`outline`、`characters`、`world_rules`、`layered_outline`）的写入都会**作废** `meta/foundation_audit.json`（若实现了 `StorePort.remove` 则删除；否则写入已清空的审查记录）。返回最新的 `getFoundation()`。

### `generateFoundation({ prompt, keys, mode? })`

- `keys`：`book | premise | outline | layered_outline | characters | world_rules` 的子集
- `mode`：`fill_missing`（默认，只填 `inspectFoundation` 仍缺的键）或 `overwrite`
- `createNovelSession` 必须带 `llm`
- 一次 `LlmPort.complete`，**不带 tools**。模型必须在 **`text` 里返回 JSON 对象**（允许包一层 ` ```json `）。解析后交给 `upsertFoundation`。
- MockLlm：`{ text: JSON.stringify({ premise: "…", outline: [/* … */] }) }`

### `startAutoWrite`

```ts
const outcome = await session.startAutoWrite({
  prompt: "写一本三章短篇：……",
  foundation: { book: { title: "无主的信", synopsis: "……" } },
  generateMissing: true,
  requireConfirmGaps: true, // 默认
  maxSteps: 20,
});
```

1. 可选 `foundation` → `upsertFoundation`
2. 可选 `generateMissing: true` → `generateFoundation({ prompt, keys: missing, mode: "fill_missing" })`
3. `inspectFoundation({ prompt })`
4. 若 `requireConfirmGaps !== false`（默认 **true**）且 `gaps.length > 0` → `{ status: "needs_foundation", gaps, meta }`，**不**跑 `Engine.run`
5. 若已就绪（或关掉确认）→ `createEngine({ store, llm }).run({ prompt, maxSteps })` → `{ status: "completed" | "stopped", result, meta }`（`stoppedReason === "complete"` 时为 `completed`）

`subscribe` 在 upsert 后发 `foundation_updated`，Engine 每步发 `auto_write_step`，`chapter.write` 期间发 `chapter_step`，needs-foundation 与 Engine 结束都发 `stopped`。

`startAutoWrite`、`chapter.write` 与 `applyFoundationChange` 共用 busy 标志：其中一个进行中再调用另一个（或自己）会抛 `SessionBusyError`。见 [架构](architecture.zh-CN.md#busy--session-生命周期)。

## S1 — `NovelWorkspace`

一书一个 `StorePort`，由宿主注入。怎么用：[指南 §7.6](guide.zh-CN.md#scenario-session-workspace)。

```ts
const stores = new Map<string, MemoryStore>();
const ws = createNovelWorkspace({
  createStore(bookId) {
    const existing = stores.get(bookId);
    if (existing) return existing;
    const store = new MemoryStore();
    stores.set(bookId, store);
    return store;
  },
  // indexStore: 可选 StorePort，持久化 `_index.json`
});

await ws.createBook({ bookId: "a", title: "无主的信" });
await ws.open("a");
await ws.switchTo("b");
await ws.listBooks();
await ws.close();
```

| 方法 | 说明 |
| --- | --- |
| `createBook({ bookId?, title? })` | 省略时分配 id。打开新书（关闭上一份 session）。 |
| `open(bookId)` / `switchTo(bookId)` | 返回 session。上一份 session 已关闭（再用不行，`SessionClosedError`）。未知 id → `BookNotFoundError`。 |
| `listBooks()` | 内存索引；设了 `indexStore` 时持久化到 `_index.json`。 |
| `close()` | 关闭当前 session 和工作区。 |
| `currentBookId` | 当前书，或 `null`。 |

工作区会**缓存**每个 `bookId` 第一次返回的 store。Memory 测试仍应一书一个 `MemoryStore`（Map 或工厂缓存）。不支持在同一个 store 里用路径前缀隔离。

## S3 — ChapterRunner

同线程 session 上的单章创建 / 续写 / 改写 / 打磨。复用 `src/workers/tools.ts` 里的作者工具（`plan_chapter` / `draft_chapter` / `commit_chapter` / `novel_context` / `read_chapter`）。**不**跑 `Engine.run`，**不**驱动 `pendingRewrites`，也**不是**全书 Route。区别：[架构](architecture.zh-CN.md#chapterrunner-vs-enginerun-vs-pendingrewrites)。怎么用：[指南 §7.3](guide.zh-CN.md#scenario-session-chapter)。

```ts
const view = await session.chapter.get(1);
await session.chapter.saveFinal(1, "# 风暴之后\n\n……");
const written = await session.chapter.write({
  chapter: 1,
  mode: "create", // 或 continue | rewrite | polish
  title: "风暴之后",
  instruction: "灯塔视角",
});
```

| 方法 | 说明 |
| --- | --- |
| `chapter.get(n)` | 从 `drafts/NN.*`、`chapters/NN.md`、`summaries/NN.json` 读 `{ chapter, plan, draft, final, summary }`。全无则 `null`。 |
| `chapter.saveFinal(n, markdown)` | 写 `chapters/NN.md`，更新 `progress.completedChapters` / checkpoint。不调 LLM。 |
| `chapter.write({ chapter, mode, instruction?, title?, force? })` | 在 `LlmPort` + 现有作者工具上的专用循环。需要 `llm`。 |

### 模式

| 模式 | 前置条件 | 行为 |
| --- | --- | --- |
| `create` | 无终稿（除非 `force: true`） | `plan_chapter` → `draft_chapter(write)` → `commit_chapter`。已有终稿 → `ChapterConflictError`。 |
| `continue` | 有草稿、无终稿 | `draft_chapter(append)` 后续写再 commit。 |
| `rewrite` | 有终稿 | 带 `instruction` 重新 plan/draft/commit。覆盖已完成章（session override；**不是** `pendingRewrites`）。 |
| `polish` | 有终稿 | 对现有终稿做较轻改写（同一工具路径，polish 向提示）。 |

`chapter.write` 只在 `plan_chapter` / `commit_chapter` 上注入内部 `sessionOverride`，以便覆盖已完成章。没有该标志时，Engine 顺序 saga 不变。

MockLlm：脚本 `toolCalls`（与 S2 的 `generateFoundation` 用 `text` 里的 JSON 不同）。

## S4 — Worker 桥

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

示意：[`examples/session.worker.ts`](../examples/session.worker.ts) + [`examples/session-host.ts`](../examples/session-host.ts)。

## S5 — `assessFoundationImpact`

对**拟议**的 `FoundationPatch` 对照当前 store 调用，且必须在 `applyFoundationChange` / `upsertFoundation` **之前**。不要等同一补丁已经写入再评估——再调一次通常会看起来像「没有变更」。**规则优先**的启发式是确定性的。当 `refineWithLlm: true` 且提供了 `LlmPort` 时，可用一次性 JSON 精炼结果——**不能把启发式 `severity` 降级**。

宿主怎么用：[指南 §7.2a](guide.zh-CN.md#scenario-session-impact-assess)。

```ts
const assessment = await session.assessFoundationImpact({
  book: { title: "无主的信（修订）", synopsis: "……" },
  characters: [{ name: "林深", role: "主角" }], // 整表替换；林守会被删掉
});
// assessment.severity: "meta_only" | "forward_only" | "rewrite_needed"
```

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

## S6 — `applyFoundationChange`

编排：评估 → `rewrite_needed` 确认闸门 → `upsertFoundation` → 对 `suggestedChapters` 可选顺序 `chapter.write`。章节**不会自动重写**——宿主必须传 `rewriteChapters: true`。

已传 `confirmRewrite: true` 时**不会**再返回 `needs_confirm`。两步宿主怎么用：[指南 §7.2d](guide.zh-CN.md#scenario-session-impact-confirm)。

```ts
let outcome = await session.applyFoundationChange({
  patch: { premise: "……", characters: [{ name: "林深" }] }, // 整表替换
});
if (outcome.status === "needs_confirm") {
  // 用 outcome.assessment.reasons 提示 UI — store 未改
  outcome = await session.applyFoundationChange({
    patch: { premise: "……", characters: [{ name: "林深" }] },
    confirmRewrite: true,
    // rewriteChapters: true 仅当宿主选择同步章节
  });
}
// outcome.status === "applied"
// outcome.assessment / outcome.meta / outcome.writes
```

| 选项 | 说明 |
| --- | --- |
| `patch` | 与 `upsertFoundation` 相同的 `FoundationPatch`。提供的 `characters` / `worldRules` / `outline` / `layeredOutline` 数组会整文件替换。 |
| `requireConfirmRewrite` | 默认 **true**。severity 为 `rewrite_needed` 且未 `confirmRewrite` → `{ status: "needs_confirm" }`，**不写盘**。已传 `confirmRewrite: true` 时不会再返回 `needs_confirm`。 |
| `confirmRewrite` | 宿主确认接受需要改写的补丁。只放在 `needs_confirm` 之后的重试上。 |
| `rewriteChapters` | 默认 **false**。为 true 时对建议（或 `chapters` 覆盖）终稿顺序 `chapter.write`（`rewrite` 或 `polish`）。`suggestedMode` 为 `"none"` 时无操作，除非宿主再传 `mode`。 |
| `mode` | 可选覆盖 `suggestedMode`（`rewrite` \| `polish`）。 |
| `refineWithLlm` | 转给 S5。 |

`meta_only` / `forward_only` 无需确认即可 apply。指纹文件仍会经 `upsertFoundation` 作废 `foundation_audit`。与 `startAutoWrite` / `chapter.write` 共用 busy 标志。

### 宿主场景

| 任务 | 指南 |
| --- | --- |
| 只评估（不写盘） | [§7.2a](guide.zh-CN.md#scenario-session-impact-assess) |
| 仅元信息 apply | [§7.2b](guide.zh-CN.md#scenario-session-impact-meta) |
| 只影响后续 | [§7.2c](guide.zh-CN.md#scenario-session-impact-forward) |
| `rewrite_needed` + `needs_confirm` 闸门 | [§7.2d](guide.zh-CN.md#scenario-session-impact-confirm) |
| 确认后批量 `chapter.write` | [§7.2e](guide.zh-CN.md#scenario-session-impact-batch) |
| `createSessionClient` 上的同样流程 | [§8.1](guide.zh-CN.md#scenario-session-worker-impact) |
| 常见坑 | [指南：常见坑](guide.zh-CN.md#pitfalls) |

## 错误

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

## 后续

不提供 Workspace-over-Worker：把 `createNovelWorkspace` 留在 UI 线程，每本书开一个 session Worker。

示意：[`examples/session-workspace.ts`](../examples/session-workspace.ts)（同线程）· [`examples/session-host.ts`](../examples/session-host.ts)（Worker）。
