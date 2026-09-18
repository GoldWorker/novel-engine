# 架构

[English](architecture.md) | [中文文档](architecture.zh-CN.md)

给贡献者与深度集成者的实现说明。宿主怎么用：[指南](guide.zh-CN.md)。稳定导出：[api](api.zh-CN.md)。

## Ports & Adapters（端口与适配器）

```
┌─────────────────────────────────────────────┐
│  宿主 Host（浏览器主线程 / Node / 测试）      │
│   createEngineClient  →  postMessage        │
└──────────────────────┬──────────────────────┘
                       │ start / steer / pause / resume / snapshot
                       ▼
┌─────────────────────────────────────────────┐
│  Dedicated Worker（`novel-engine/worker`）  │
│  StorePort（OpfsStore | MemoryStore）       │
│  LlmPort（由宿主注入）                       │
│  Engine.run → route(state) → Worker 工具    │
└─────────────────────────────────────────────┘
```

同线程宿主可以跳过 Worker，直接调用 `createEngine({ store, llm })`。Session（`novel-engine/session`）是同一 store 上的同线程门面；它的 Worker 桥（`createSessionClient` / `attachSessionWorker`）是第二层适配器，不是第二份业务规则。

- **`route` 是纯函数。** 输入是显式的 `State` 快照。它不做 IO，也不调用 `StorePort` 或 `LlmPort`。
- **`StorePort`（存储端口）** 加载该快照并持久化产物。宿主注入 `MemoryStore`、`OpfsStore`、IndexedDB，或在本库外部实现 Node fs。
- **`LlmPort`（LLM 端口）** 执行 architect / writer / editor 补全（可选结构化 `toolCalls`）。默认入口只附带 `MockLlm` / `ReplayLlm`。可选 fetch 适配器：`novel-engine/llm`。

`src/` 从不使用 `node:fs` / `node:path`。

## Engine 循环 vs `route`

`Engine.run` 是串行循环：加载 state → `route(state)` → Worker 工具 → 落盘 → 重复，直到 `complete` / `idle` / `pause` / `maxSteps`。

`route` 只选择下一条 `Instruction | null`。`null` 合法：Engine 接着尝试 `plan_start` 桩，或停止（`complete` / `idle`）。

`plan_start` 是**确定性关键词桩**（无 Arbiter LLM）：提示词含 `长篇` 则选 `architect_long` / `long`；含 `中篇` 或 `分层` 则选 `architect_long` / `mid`；否则 `architect_short` / `short`。Worker 指令失败会重试一次，然后暂停。同一条 Route 指令连续五次也会暂停（死锁上限）。

`pause` / `steer` 在**当前 Worker 指令结束后**生效，不会打断工具中途。`steer` 记录决策并设 `flow=steering`，于是 `route` 返回 null，直到 `resume()` 恢复先前 flow。

### `route` 如何决策

优先级为先匹配先返回，对齐 ainovel-cli 的 `internal/flow/router.go`：

1. `phase === "complete"` → `null`
2. 基础设定缺失且已有 `planningTier` → architect 补全
3. `pendingRewrites` 非空 → writer 重写 / 润色
4. `flow === "reviewing"` → `null`
5. `flow === "steering"` → `null`
6. 聚合刷新 → editor
7. 立即外部反馈 → architect
8. 分层弧末 → 审阅 / 摘要 / 展开 / 新卷
9. 非分层全局审阅到期 → editor
10. 非分层大纲写尽 → architect（`complete_book` / 续写）
11. 否则 → writer 下一章

## StorePort / LlmPort 契约

```ts
interface StorePort {
  loadState(): Promise<State>;
  loadProgress(): Promise<Progress | null>;
  saveProgress(progress: Progress): Promise<void>;
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  has(path: string): Promise<boolean>;
  list?(prefix?: string): readonly string[] | Promise<readonly string[]>;
  remove?(path: string): Promise<void>;
}

interface LlmPort {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
```

`list` 可选：`MemoryStore` / `OpfsStore` 实现了它，快照导出才能打进每个文件；没有 `list` 的自定义适配器仍会按已知书稿布局用 `has()` 探测。`remove` 可选：Session 在指纹文件变化后用它删除过期的 `meta/foundation_audit.json`（否则写入已清空的审查记录）。

`LlmCompletionResult.toolCalls[].arguments` 始终是解析后的对象。默认包从不附带供应商客户端。

## MemoryStore 布局 / `PATHS`

逻辑路径（本库不含文件系统）：

| 路径 | 产物 |
| --- | --- |
| `meta/progress.json` | 游标、已完成章、`layered`、`planningTier` |
| `meta/book.json` | 标题 / 简介 |
| `meta/run_meta.json` | 运行元信息，含 `planningTier` |
| `meta/checkpoints.jsonl` | 检查点 |
| `meta/decisions.jsonl` | 宿主 steer / 决策 |
| `meta/foundation_audit.json` | 基础设定审查（指纹 + issues） |
| `premise.md` | 前提 |
| `outline.json` | 短篇扁平大纲 |
| `layered_outline.json` | 卷/弧大纲（中长篇） |
| `characters.json` | 角色表 |
| `world_rules.json` | 世界规则表 |
| `drafts/NN.plan.json` / `drafts/NN.draft.md` | 章节计划 / 草稿 |
| `chapters/NN.md` | 章节终稿 |
| `summaries/NN.json` | 章节摘要 |
| `summaries/arc-vNNaNN.json` / `summaries/vol-vNN.json` | 弧 / 卷摘要 |
| `reviews/global_N.json` / `reviews/arc_N.json` | 审阅 |
| `meta/snapshots/vNNaNN.json` | 角色快照 |

`MemoryStore` 是内存里的 path → bytes 映射。测试与同线程宿主用它。Session 工作区约定是**一书一个 `StorePort`**，不是在同一个 store 里用路径前缀隔离。

## OPFS 写入策略

`OpfsStore` 先写同级临时文件（`.name.tmp`），再 `move`（或 copy-then-unlink），避免写到一半崩溃时截断旧文件。`list()` 会跳过这些临时文件。快照导出同样跳过 `.*.tmp`。

`createOpfsStore()` 在存在 `navigator.storage.getDirectory` 时打开 OPFS；**否则返回 `MemoryStore`**，除非 `{ fallbackToMemory: false }`（那时抛 `OpfsUnavailableError`）。默认子目录：`novel-engine`。

## 快照格式

浏览器安全的 zip，打包 store 中每个路径（[fflate](https://github.com/101arrowz/fflate)）。恢复是 **merge**：快照里的路径被覆盖；目标里多出来的文件保留。清单 `.novel-engine-snapshot.json` **只存在于 zip 内**——不会写入 store。

- `BOOK_SNAPSHOT_FORMAT === "novel-engine-book-snapshot"`
- `BOOK_SNAPSHOT_VERSION === 1`

非法 zip / 缺失或未知清单 / 路径逃逸会抛 `SnapshotError`。宿主怎么用：[指南 §5](guide.zh-CN.md#scenario-snapshot)。

## Engine Worker 协议（`ENGINE_PROTOCOL`）

`ENGINE_PROTOCOL === 1`。与 Session（`ns: "session"`）互不冲突。

主线程 → Worker 命令：`start` / `steer` / `pause` / `resume` / `snapshot`。

Worker → 主线程通知：`event` / `snapshot` / `error`。

事件种类：`started` | `step` | `paused` | `resumed` | `steered` | `stopped`。

`attachEngineWorker` 在 `novel-engine/worker` 上，便于打包器把主线程 client 从 Worker 里 treeshake 掉。宿主怎么用：[指南 §4](guide.zh-CN.md#scenario-worker)。

## Session 桥（`SESSION_PROTOCOL`）

`SESSION_PROTOCOL === 1`，`ns: "session"`——不与 Engine 的 `v: 1` 命令冲突。同线程 `NovelSession` 仍是实现；桥是适配器（`createSessionClient` / `attachSessionWorker`）。**不要从 `novel-engine/worker` 导入这些。**

命令（含增量 S5/S6）：

`inspectFoundation` | `getFoundation` | `getProgress` | `assertReadyToWrite` | `listArtifacts` | `exportSnapshot` | `importSnapshot` | `upsertFoundation` | `generateFoundation` | `assessFoundationImpact` | `applyFoundationChange` | `startAutoWrite` | `pause` | `resume` | `steer` | `cancel` | `getRunState` | `chapterGet` | `chapterSaveFinal` | `chapterWrite` | `chapterDelete` | `close`

通知：`result` | `event` | `error`。**兼容（0.7.0）：** `SESSION_PROTOCOL` 仍为 `1`；`cancel` / `getRunState` 为增量命令。`AbortSignal` 不做 structured clone——客户端把宿主 `signal` 映射成 `cancel` RPC。

`generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` **在 Worker 里跑**，因为书的 `StorePort` 在那边（通常是 OPFS）。主线程 generate/apply 会写到另一份 store。

没有 Workspace-over-Worker：把 `createNovelWorkspace` 留在 UI 线程，每本书开一个 session Worker。**Kit**（`novel-engine/kit`）替你做这件事（并自带 Worker）。

契约：[api](api.zh-CN.md#s4--worker-桥)。宿主怎么用：[指南 §8](guide.zh-CN.md#scenario-session-worker)。Kit：[指南](guide.zh-CN.md#scenario-kit)。

<a id="kit-worker-init"></a>

## Kit Worker init（`KIT_PROTOCOL`）

`KIT_PROTOCOL === 1`，`ns: "kit"`——不与 Engine 或 Session 冲突。在任何 session 命令**之前只用一次**。

主线程 → Worker `init`：`{ v, ns, type: "init", id, bookId, llmEndpoint, store: "opfs" | "memory", fallbackToMemory, opfsDirectory? }`。

Worker → 主线程 `ready`：`{ v, ns, type: "ready", id, bookId, storeKind }` 或 `error`。

随后沿用现有 Session 桥（`SESSION_PROTOCOL`，`ns: "session"`）。随包装箱发布的 `dist/novel-kit.worker.js` 调用 `attachKitWorker(self)`：创建 store + `fetch(llmEndpoint)` 的 `LlmPort`、`createNovelSession`、`attachSessionWorker`。Worker 里没有 API Key。默认 `workerUrl` 是相对 `dist/kit.js` 的 `new URL("./novel-kit.worker.js", import.meta.url)`；若打包器 404，把该文件拷到 `public/`。

Kit 只是组合 + 默认值。**不**改 Session/Engine 协议。

## Busy / session 生命周期

`startAutoWrite`、`chapter.write`、`chapter.delete` 与 `applyFoundationChange` 共用一个 session busy 标志。其中一个进行中再调用另一个会抛 `SessionBusyError`（同线程与 Worker 桥均如此）。Worker 侧 busy 意味着进行中的 `applyFoundationChange` / `startAutoWrite` / `chapter.delete` 会挡住跨桥的 `chapter.write`。

`pause` / `resume` / `steer` **不**占 busy。它们转发到 `startAutoWrite` → `Engine.run` 期间持有的 Engine 实例。没有 Engine 在跑时返回 `{ status: "idle" }`。`generateMissing`（`Engine.run` 之前）期间为 idle。空 steer 笔记抛 `EngineError`。

**新增（0.7.0）：** `cancel()` / `cancelBook()` 同样不占 busy。空闲 cancel 为 `{ status: "idle" }`。进行中的长任务（`startAutoWrite`、`generateFoundation`、`chapter.write` …）以 `AbortedError` 拒绝，随后清除 busy 与 `runningEngine`。`getRunState()` 是纯读取（`"idle" | "generating_missing" | "running" | "paused" | "busy"`）：`running` / `paused` 表示 pause/steer 会是 `ok`；其他状态表示它们会是 `idle`。start/generate/write 上的可选 `signal` 由宿主选择加入；不传则与 0.6.0 一致。

读取（`getFoundation`、`inspectFoundation`、`assessFoundationImpact`、`chapter.get`、`getRunState` …）不占 busy。Session **不缓存**产物——每次都是 store 直读。

`close()` / 工作区 `switchTo` / `open` 会关闭上一份 session。再使用旧引用会抛 `SessionClosedError`。

## `foundationMissing` / 指纹 / 审查

共享助手在 `src/store/foundation.ts`（Engine / `route` / Session 共用）：

```ts
foundationMissing(store: StorePort, tier?: PlanningTier): Promise<string[]>
```

- 中长篇只要有有效的非空 `layered_outline.json`（`parseLayeredVolumes` 接受的卷/弧形状），**不再需要**扁平 `outline.json`。短篇仍然需要。
- 省略 `tier` 时推断顺序：`meta/run_meta.json` 的 `planningTier` → `progress.planningTier` → `progress.layered` → 有效分层大纲（视为 mid）→ **short**。
- 空或非法的 `layered_outline.json` **不满足**大纲要求。
- `foundation_audit` 只在其它产物都在、且 `progress.phase` 不是 `writing` 或 `complete` 时报告。

指纹：存在有效分层大纲时跳过缺失的 `outline.json`，这样 layered-only 的 store 仍能跑 `audit_foundation` / `novel_context`。

`upsertFoundation` / `applyFoundationChange` 在任何指纹文件变化时会**作废** `meta/foundation_audit.json`（`book`、`premise`、`outline`、`characters`、`world_rules`、`layered_outline`）：实现了 `StorePort.remove` 则删除，否则写入已清空的审查记录。

提供的 `characters` / `worldRules` / `outline` / `layeredOutline` 数组会**整文件替换** JSON。省略的补丁键保持原样。见 [api](api.zh-CN.md#upsertfoundationpatch) 与 [指南：常见坑](guide.zh-CN.md#pitfalls)。

## ChapterRunner vs `Engine.run` vs `pendingRewrites`

| 路径 | 是什么 | 不是什么 |
| --- | --- | --- |
| `Engine.run` / 就绪后的 `startAutoWrite` | 全书 Route 循环（`route` → Worker 工具） | 单章改写 API |
| `session.chapter.write` | 专用作者循环，复用 `plan_chapter` / `draft_chapter` / `commit_chapter` | `Engine.run`；**不**驱动 `pendingRewrites` |
| `pendingRewrites` | Engine Route 在审阅后的 rewrite/polish 队列 | Session ChapterRunner |
| `applyFoundationChange({ rewriteChapters: true })` | upsert 之后，对建议终稿顺序 `chapter.write` | 自动改写；默认 `rewriteChapters` 为 false；`suggestedMode === "none"` 时无操作，除非宿主再传 `mode` |

`chapter.write` 只在 `plan_chapter` / `commit_chapter` 上注入内部 `sessionOverride`，以便覆盖已完成章。没有该标志时，Engine 顺序 saga 不变。

## 打包（`exports` / 本地引用）

宿主怎么用：[指南 — 安装](guide.zh-CN.md#install)。

`package.json` `exports` 把公开子路径映射到**构建产物**（不是 `src/`）：

| 子路径 | JS | 类型 |
| --- | --- | --- |
| `.` | `dist/index.js` | `dist/index.d.ts` |
| `./worker` | `dist/worker.js` | `dist/worker.d.ts` |
| `./llm` | `dist/llm.js` | `dist/llm.d.ts` |
| `./session` | `dist/session.js` | `dist/session.d.ts` |
| `./kit` | `dist/kit.js` | `dist/kit.d.ts` |
| `./kit/worker` | `dist/novel-kit.worker.js` | `dist/novel-kit.worker.d.ts` |
| `./package.json` | `package.json` | — |

`npm pack` / 登记处用的 `files`：`dist/`、`README.md`、`LICENSE`（`dist/` 被 gitignore — 必须 `npm run build`）。仅 ESM（`"type": "module"`）。`.` / `./worker` / `./session` / `./kit` 仍把 `fflate` 保持 external，让宿主从 `node_modules` 解析。随包装箱发布的 `./kit/worker` 会把 `fflate` 打进 Worker，这样拷到 `public/` 的 `novel-kit.worker.js` 不必在 Dedicated Worker 里解析裸说明符。

把本树**拷进** `vendor/novel-engine/`（等）的宿主，用相对路径导入 `dist/*.js`，或在副本里 `npm install && npm run build` 后用 `"novel-engine": "file:./vendor/novel-engine"` 保留包名。`src/*.ts` 不是 `exports` 条件；打包器可通过 `tsconfig` `paths` 编译它（见指南）。Node 不能直接跑 TypeScript 树（`.ts` 文件里的说明符是 `.js`）。

