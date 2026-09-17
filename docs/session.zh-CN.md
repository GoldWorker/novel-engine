# 宿主 Session API（`novel-engine/session`）— S0 / S1 / S2

[English](session.md) | [中文文档](session.zh-CN.md)

同线程宿主门面：检查一本书的基础设定，并在多本书之间切换。从**可选**子路径导入，这样默认的 `novel-engine` / `novel-engine/worker` / `novel-engine/llm` 包不会带上 session 代码。

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

包版本 **0.3.0**。本文覆盖 **S0 + S1 + S2**。

## 状态

| 阶段 | 内容 | 本版本 |
| --- | --- | --- |
| **S0** | 类型、缺口表、`foundationMissing` 分层大纲修复 | 已完成 |
| **S1** | `createNovelSession` 只读/检查 + `createNovelWorkspace` | 已完成 |
| **S2** | `generateFoundation` / upsert / 自动写作（结构化 LLM） | 已完成 |
| **S3** | ChapterRunner / 章节写作 API | 尚未 |
| **S4** | Worker session 桥 | 尚未 |

S1–S3 使用**同线程** `NovelSession`。这里没有 Worker 版 session。

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

S1 里 `llm` 对只读检查可选。**S2** 的 `generateFoundation` / `startAutoWrite` 必须提供（缺失则 `SessionLlmRequiredError`）。每次读取都是 **store 直读**（Session 不缓存产物）。

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
| `startAutoWrite({ prompt, foundation?, generateMissing?, requireConfirmGaps?, maxSteps? })` | 可选 upsert/generate，然后要么 `{ status: "needs_foundation" }`，要么 `createEngine(...).run`。 |
| `subscribe(listener)` | `foundation_updated` / `auto_write_step` / `stopped`。返回取消订阅函数。 |
| `close()` | 之后的调用抛 `SessionClosedError`。 |

**不在 S2：** ChapterRunner / `chapter.*`（S3），Worker session 桥（S4）。

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

`subscribe` 在 upsert 后发出 `foundation_updated`，每个 Engine `step` 发出 `auto_write_step`，needs-foundation 与 Engine 结束都发出 `stopped`。

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

## 错误

| 错误 | 何时 |
| --- | --- |
| `FoundationIncompleteError` | `assertReadyToWrite` — `.gaps` 即检查表。 |
| `SessionLlmRequiredError` | `generateFoundation` / Engine 版 `startAutoWrite` 未提供 `llm`。 |
| `FoundationGenerateError` | 非法 `keys`，或 `complete().text` 不是 JSON 对象。 |
| `SessionClosedError` | 对已关闭 session 调用（包括 `switchTo` 之后）。 |
| `WorkspaceClosedError` | 工作区 `close()` 之后。 |
| `BookNotFoundError` | `open` / `switchTo` 未知 `bookId`。 |

## 后续

- **S3** — ChapterRunner
- **S4** — Worker session 桥

示意：[`examples/session-workspace.ts`](../examples/session-workspace.ts)。
