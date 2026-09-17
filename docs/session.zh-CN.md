# 宿主 Session API（`novel-engine/session`）— S0 / S1

[English](session.md) | [中文文档](session.zh-CN.md)

同线程宿主门面：检查一本书的基础设定，并在多本书之间切换。从**可选**子路径导入，这样默认的 `novel-engine` / `novel-engine/worker` / `novel-engine/llm` 包不会带上 session 代码。

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

包版本 **0.3.0**。本文只覆盖 **S0 + S1**。

## 状态

| 阶段 | 内容 | 本版本 |
| --- | --- | --- |
| **S0** | 类型、缺口表、`foundationMissing` 分层大纲修复 | 已完成 |
| **S1** | `createNovelSession` 只读/检查 + `createNovelWorkspace` | 已完成 |
| **S2** | `generateFoundation` / upsert / 自动写作（结构化 LLM） | 尚未 |
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

S1 里 `llm` 可选（未使用，仅为 S2 预留）。每次读取都是 **store 直读**（Session 不缓存产物）。

| 方法 | 说明 |
| --- | --- |
| `bookId` | 宿主指定的书 id。 |
| `getFoundation()` | `{ book, premise, outline, layeredOutline, characters, worldRules, audit, progress }` — 缺失则为 `null`。 |
| `getProgress()` | `store.loadProgress()`。 |
| `inspectFoundation({ prompt? })` | `{ meta, gaps, readyToWrite, planning }`。用 `prompt`（或 `run_meta` / progress）决定缺口表的规划档位。 |
| `assertReadyToWrite({ prompt? })` | 未就绪时抛出带 `gaps` 的 `FoundationIncompleteError`。 |
| `listArtifacts(prefix?)` | `listStorePaths`。 |
| `exportSnapshot()` / `importSnapshot(bytes)` | 现有书稿快照 API 的薄封装。 |
| `close()` | 之后的调用抛 `SessionClosedError`。 |

**不在 S1：** `upsertFoundation`、`generateFoundation`、`startAutoWrite`、`chapter.*`。

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
| `SessionClosedError` | 对已关闭 session 调用（包括 `switchTo` 之后）。 |
| `WorkspaceClosedError` | 工作区 `close()` 之后。 |
| `BookNotFoundError` | `open` / `switchTo` 未知 `bookId`。 |

## 后续

- **S2** — 结构化 LLM 的 `generateFoundation` / upsert / 自动写作
- **S3** — ChapterRunner
- **S4** — Worker session 桥

示意：[`examples/session-workspace.ts`](../examples/session-workspace.ts)。
