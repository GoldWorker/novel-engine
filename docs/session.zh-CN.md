# 宿主 Session API（`novel-engine/session`）— S0–S4

[English](session.md) | [中文文档](session.zh-CN.md)

同线程宿主门面：检查一本书的基础设定，并在多本书之间切换。从**可选**子路径导入，这样默认的 `novel-engine` / `novel-engine/worker` / `novel-engine/llm` 包不会带上 session 代码。

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

包版本 **0.3.0**。本文覆盖 **S0–S4**。

## 状态

| 阶段 | 内容 | 本版本 |
| --- | --- | --- |
| **S0** | 类型、缺口表、`foundationMissing` 分层大纲修复 | 已完成 |
| **S1** | `createNovelSession` 只读/检查 + `createNovelWorkspace` | 已完成 |
| **S2** | `generateFoundation` / upsert / 自动写作（结构化 LLM） | 已完成 |
| **S3** | ChapterRunner / `chapter.get` / `saveFinal` / `write` | 已完成 |
| **S4** | Worker session 桥（`createSessionClient` / `attachSessionWorker`） | 已完成 |

S1–S3 使用**同线程** `NovelSession`（业务真相源）。**S4** 是通过 `postMessage` 适配同一对象，不是第二套业务实现。

## S0 — `foundationMissing`

中长篇只要有一份有效、非空的 `layered_outline.json`（卷/弧形状能通过 `parseLayeredVolumes`），**不再**要求扁平的 `outline.json`。短篇仍然需要 `outline.json`。

实现位于 `src/store/foundation.ts`（Engine / `route` / Session 共用）：

```ts
foundationMissing(store: StorePort, tier?: PlanningTier): Promise<string[]>
```

- 宿主已经知道规划档位时传入 `tier`（`inspectFoundation({ prompt })` 会用 `inferPlanningStub` 这样做）。
- 省略 `tier` 时按此推断：`meta/run_meta.json` 的 `planningTier` → `progress.planningTier` → `progress.layered` → 有效分层大纲（视为 mid）→ **short**。
- 空的或形状无效的 `layered_outline.json` **不能**代替大纲。
- `world_rules` / `characters` / `book` / `premise` / `foundation_audit` 规则不变。只有其它产物都齐、且 `progress.phase` 不是 `writing` / `complete` 时，才会报 `foundation_audit`。

指纹：存在有效分层大纲时，缺失的 `outline.json` 会被跳过，因此分层-only 的 store 仍可走 `audit_foundation` / `novel_context`。

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

S1 里 `llm` 对只读检查可选。**S2** 的 `generateFoundation` / `startAutoWrite` 以及 **S3** 的 `chapter.write` 必须提供（缺失则 `SessionLlmRequiredError`）。每次读取都是 **store 直读**（Session 不缓存产物）。

| 方法 | 说明 |
| --- | --- |
| `bookId` | 宿主指定的书 id。 |
| `getFoundation()` | `{ book, premise, outline, layeredOutline, characters, worldRules, audit, progress }` — 缺失则为 `null`。 |
| `getProgress()` | `store.loadProgress()`。 |
| `inspectFoundation({ prompt? })` | `{ meta, gaps, readyToWrite, planning }`。用 `prompt`（或 `run_meta` / progress）决定缺口表的规划档位。 |
| `assertReadyToWrite({ prompt? })` | 未就绪时抛出带 `gaps` 的 `FoundationIncompleteError`。 |
| `listArtifacts(prefix?)` | `listStorePaths`。 |
| `exportSnapshot()` / `importSnapshot(bytes)` | 现有书稿快照 API 的薄封装。 |
| `upsertFoundation(patch)` | 部分写入 `book` / `premise` / `outline` / `layeredOutline` / `characters` / `worldRules`。指纹文件变化时作废 `meta/foundation_audit.json`。 |
| `generateFoundation({ prompt, keys, mode? })` | 结构化一次性 `LlmPort.complete`；从 `text` 解析 JSON；再 `upsertFoundation`。**不是** Engine 循环。 |
| `startAutoWrite({ prompt, foundation?, generateMissing?, requireConfirmGaps?, maxSteps? })` | 可选 upsert/generate，然后要么 `{ status: "needs_foundation" }`，要么 `createEngine(...).run`。与 `chapter.write` 互斥（`SessionBusyError`）。 |
| `chapter` | S3 ChapterRunner：`get` / `saveFinal` / `write`。同线程；不是 Engine 全书 Route。 |
| `subscribe(listener)` | `foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`。返回取消订阅函数。 |
| `close()` | 之后的调用抛 `SessionClosedError`。 |

**不在 S4：** Worker 上的 `NovelWorkspace`（工作区留在 UI 线程；每个 Worker 一份书 session）。

`readyToWrite === true` 当且仅当 `foundationMissing` 为空（与 Engine 的审查 / writing 阶段规则一致）。

### 缺口（gaps）

```ts
interface FoundationGap {
  key: string;          // foundationMissing 键：book | premise | outline | characters | world_rules | foundation_audit
  path: string;         // 逻辑 store 路径
  requiredFor: string;  // "write" | "short" | "mid" | "long"
  hint: string;         // 中文 + 短英文
}
```

中长篇若缺大纲，缺口指向 `layered_outline.json`，并说明扁平 `outline.json` 也可以满足要求。

## S2 — 生成 / upsert / 自动写作

`generateFoundation` 是**结构化的一次性 LLM 调用 + `upsertFoundation`**。它不跑受限的 Engine 循环，也不写章节或草稿。

### `upsertFoundation(patch)`

```ts
await session.upsertFoundation({
  book: { title: "无主的信", synopsis: "……" },
  premise: "……",
  outline: [{ chapter: 1, title: "风暴之后", summary: "……" }],
  characters: [{ name: "林守" }],
  worldRules: [{ name: "信与潮", description: "……" }],
});
```

轻度形状校验后，按现有 `PATHS` 调用 `writeJson` / `writeText`。任何指纹文件（`book`、`premise`、`outline`、`characters`、`world_rules`、`layered_outline`）的写入都会**作废** `meta/foundation_audit.json`（若实现了 `StorePort.remove` 则删除；否则写入已清空的审查记录）。返回最新的 `getFoundation()`。

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
2. 可选 `generateMissing: true` → `generateFoundation({ prompt, keys: 缺项, mode: "fill_missing" })`
3. `inspectFoundation({ prompt })`
4. 若 `requireConfirmGaps !== false`（默认 **true**）且 `gaps.length > 0` → `{ status: "needs_foundation", gaps, meta }`，**不**调用 `Engine.run`
5. 若已就绪（或关闭了确认）→ `createEngine({ store, llm }).run({ prompt, maxSteps })` → `{ status: "completed" | "stopped", result, meta }`（`stoppedReason === "complete"` 时为 `completed`）

`subscribe` 在 upsert 后发出 `foundation_updated`，每个 Engine `step` 发出 `auto_write_step`，`chapter.write` 过程中发出 `chapter_step`，needs-foundation 与 Engine 结束都发出 `stopped`。

`startAutoWrite` 与 `chapter.write` 共用 busy 标志：其中一个进行中再调用另一个（或自己）会抛 `SessionBusyError`。

## S1 — `NovelWorkspace`

每种 `bookId` 一个 `StorePort`，由宿主工厂注入：

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
  // indexStore: 可选，用来持久化 `_index.json`
});

await ws.createBook({ bookId: "a", title: "无主的信" });
await ws.open("a");
await ws.switchTo("b");
await ws.listBooks();
await ws.close();
```

| 方法 | 说明 |
| --- | --- |
| `createBook({ bookId?, title? })` | 未传 id 则分配一个。打开新书（关闭上一份 session）。 |
| `open(bookId)` / `switchTo(bookId)` | 返回 session。上一份 session 被关闭（再调用会 `SessionClosedError`）。未知 id → `BookNotFoundError`。 |
| `listBooks()` | 内存索引；若提供了 `indexStore` 则写入 `_index.json`。 |
| `close()` | 关闭当前 session 与工作区。 |
| `currentBookId` | 当前书，或 `null`。 |

工作区会**缓存**每个 `bookId` 第一次拿到的 store。Memory 测试应继续「一书一 `MemoryStore`」（Map 或工厂缓存）。不支持在同一个 store 里用路径前缀区分书籍。

## S3 — ChapterRunner

同线程上的单章 create / continue / rewrite / polish。复用 `src/workers/tools.ts` 里的作者工具（`plan_chapter` / `draft_chapter` / `commit_chapter` / `novel_context` / `read_chapter`）。**不**跑 `Engine.run`，**不**驱动 `pendingRewrites`，也**不是**全书 Route。

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
| `chapter.get(n)` | 从 `drafts/NN.*`、`chapters/NN.md`、`summaries/NN.json` 读 `{ chapter, plan, draft, final, summary }`。都没有则为 `null`。 |
| `chapter.saveFinal(n, markdown)` | 写入 `chapters/NN.md`，并合理更新 `progress.completedChapters` / checkpoint。不调用 LLM。 |
| `chapter.write({ chapter, mode, instruction?, title?, force? })` | 专用作者循环：`LlmPort` + 现有 writer 工具。必须提供 `llm`。 |

### 模式

| 模式 | 前置条件 | 行为 |
| --- | --- | --- |
| `create` | 没有终稿（除非 `force: true`） | `plan_chapter` → `draft_chapter(write)` → `commit_chapter`。已有终稿 → `ChapterConflictError`。 |
| `continue` | 有草稿、无终稿 | 用 `draft_chapter(append)` 续写再提交。 |
| `rewrite` | 已有终稿 | 按 `instruction` 重新 plan/draft/commit。覆盖已完成章（session override；**不是** `pendingRewrites`）。 |
| `polish` | 已有终稿 | 轻度改写现有终稿（同一工具路径，打磨向提示）。 |

`chapter.write` 只在 `plan_chapter` / `commit_chapter` 上注入内部 `sessionOverride`，以便覆盖已完成章。没有该标志时，Engine 的顺序提交 saga 不变。

MockLlm：脚本 `toolCalls`（与 S2 `generateFoundation` 用 `text` 里的 JSON 不同）。

## S4 — Worker 桥

给工作台 UI：把 `startAutoWrite` / `chapter.write` 移出主线程，并且不要把供应商 API Key 放进 Worker。

同线程 `NovelSession` 仍是实现。`attachSessionWorker` 在 Worker 里构造一份；`createSessionClient` 是形状与 `NovelSession` 相同的 RPC 客户端（对标 `createEngineClient`）。**不要从 `novel-engine/worker` 导入这些符号**——那个入口只给 Engine，避免默认 Engine Worker 打进 session。

```ts
// session.worker.ts
import { createOpfsStore } from "novel-engine/worker";
import { attachSessionWorker, createNovelSession } from "novel-engine/session";

attachSessionWorker(self, {
  async createSession() {
    const store = await createOpfsStore();
    const llm = {
      complete: (request) =>
        fetch("/api/llm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }).then((res) => res.json()),
    };
    return createNovelSession({ store, llm, bookId: "letter" });
  },
});

// 主线程
import { createSessionClient } from "novel-engine/session";

const worker = new Worker(new URL("./session.worker.ts", import.meta.url), { type: "module" });
const session = createSessionClient(worker, { bookId: "letter" });
await session.inspectFoundation({ prompt: "写一本三章短篇" });
await session.startAutoWrite({ prompt: "……", generateMissing: true });
await session.chapter.write({ chapter: 1, mode: "create" });
```

| 部件 | 说明 |
| --- | --- |
| `attachSessionWorker(port, { createSession })` | Worker 适配器。`createSession` 注入 `StorePort` + `LlmPort`，返回 `createNovelSession(...)`。 |
| `createSessionClient(port, { bookId })` | 主线程 `NovelSession`。`bookId` 必须与 Worker 侧 session 一致。 |
| 协议 | `SESSION_PROTOCOL === 1`，`ns: "session"`（不与 Engine 的 `v: 1` 命令冲突）。命令 → `result` / `event` / `error`。 |
| Busy | Worker 侧 `SessionBusyError`：`startAutoWrite` 进行中会挡住跨桥的 `chapter.write`。 |
| `generateFoundation` | **在 Worker 里跑**（不在 UI 线程），因为书的 `StorePort` 在那边（通常是 OPFS）。主线程 generate 会写到另一份 store。 |
| `LlmPort` | `fetch` 宿主 BFF。**不要把供应商 API Key 打进公开 Worker 包**。本包不含 Next.js 代码。 |
| 事件 | Worker 转发 `subscribe` 事件（`foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`）。 |

示意：[`examples/session.worker.ts`](../examples/session.worker.ts) + [`examples/session-host.ts`](../examples/session-host.ts)。

## 错误

| 错误 | 何时 |
| --- | --- |
| `FoundationIncompleteError` | `assertReadyToWrite` — `.gaps` 即检查表。 |
| `SessionLlmRequiredError` | `generateFoundation` / Engine 版 `startAutoWrite` / `chapter.write` 未提供 `llm`。 |
| `FoundationGenerateError` | 非法 `keys`，或 `complete().text` 不是 JSON 对象。 |
| `SessionBusyError` | `startAutoWrite` 或 `chapter.write` 进行中再调用另一个（或自己）（同线程与 Worker 桥均如此）。 |
| `ChapterConflictError` | 模式前置失败（create 时已有终稿、continue 没有草稿、rewrite/polish 没有终稿）。 |
| `ChapterRunnerError` | 非法章节号、空的 `saveFinal`、或作者循环没有产出终稿。 |
| `SessionClosedError` | 对已关闭 session 调用（包括 `switchTo` 之后）。 |
| `WorkspaceClosedError` | 工作区 `close()` 之后。 |
| `BookNotFoundError` | `open` / `switchTo` 未知 `bookId`。 |

## 后续

不提供 Workspace-over-Worker：`createNovelWorkspace` 留在 UI 线程，每本书开一个 session Worker。

示意：[`examples/session-workspace.ts`](../examples/session-workspace.ts)（同线程）· [`examples/session-host.ts`](../examples/session-host.ts)（Worker）。
