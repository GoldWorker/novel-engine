# 使用示例

给宿主（host）复制用的 TypeScript 片段。文件按真实应用方式从 `novel-engine` / `novel-engine/worker` 导入。它们是**文档**，不进入 `npm test`；仓库内可跑通的 mock 路径仍是：

```bash
npm test
npm run test:short
npm run test:layered
```

[English](README.md) · [简体中文](README.zh-CN.md)

## 文件

| 文件 | 内容 |
| --- | --- |
| [`short-book.ts`](short-book.ts) | `createEngine` + `MemoryStore` + `MockLlm.fromHandler` 跑完三章短篇到 `phase=complete`。附 `ReplayLlm` 用法示意。 |
| [`layered-book.ts`](layered-book.ts) | 中篇 `architect_long`：`layered_outline`，弧末 `save_review` → `save_arc_summary` → `expand_next_arc`，然后 `complete_book`。 |
| [`opfs-store.ts`](opfs-store.ts) | `isOpfsAvailable` / `createOpfsStore`（不可用则 MemoryStore），以及严格的 `OpfsStore.open()`。 |
| [`engine.worker.ts`](engine.worker.ts) | 专用 Worker 入口（从 `novel-engine/worker` 导入 `attachEngineWorker`）。 |
| [`worker-host.ts`](worker-host.ts) | 主线程 `createEngineClient`：`start` / `steer` / `pause` / `resume` / `snapshot`。 |
| [`snapshot-roundtrip.ts`](snapshot-roundtrip.ts) | `exportBookSnapshot` / `importBookSnapshot` 合并还原。 |

本仓库可选类型检查（把 `novel-engine` 映射到 `src/`）：

```bash
npx tsc -p tsconfig.examples.json
```

## 怎么读 / 怎么跑

1. 在宿主里 `npm install novel-engine`，或在本仓库 `npm run build` 后依赖 `dist/`。
2. 按需复制文件。Web Worker 嵌入需要 **两份**：`engine.worker.ts`（Worker 线程）和 `worker-host.ts`（主线程）。
3. 把 Worker 文件里的 `LlmPort` 占位换成你的网关 / WebLLM 适配器。本库不内置真实模型客户端。
4. `plan_start` 是关键词桩（无 Arbiter / 仲裁器 LLM）：提示词含 `长篇` → long / `architect_long`；含 `中篇` 或 `分层` → mid / `architect_long`；否则 short / `architect_short`。
5. 要跑完整本书请用 `MockLlm.fromHandler`：Worker 工具会把结果写回对话，且 `audit_foundation` 必须复用 `novel_context` 返回的 `fingerprint`。`ReplayLlm` 只按固定 `{ text, toolCalls? }[]` 回放，列表不够长就会耗尽抛错。

测试使用的黄金夹具（工具名与示例相同）：

- `fixtures/short-book.json` + `tests/helpers/short-book-llm.ts`
- `fixtures/layered-book.json` + `tests/helpers/layered-book-llm.ts`
