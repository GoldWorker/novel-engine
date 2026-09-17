# novel-engine

[English](README.md) | [简体中文](README.zh-CN.md)

可复用的 **TypeScript** 小说引擎 SDK，给想在浏览器（或 Node 测试）里生成小说的宿主（host）使用。纯 ESM，无 UI、无 React 绑定、无 TUI。

**0.1.0** 是第一个可用的 semver：Engine（引擎）+ `route`（Route，纯路由函数）+ MemoryStore / OpfsStore + MockLlm + Worker 宿主 + 书籍快照 zip。

本包从不连接真实模型，`src/` 中也从不使用 `node:fs` / `node:path`。

路由模型受 [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli)（`internal/flow/router.go`、`internal/host/engine.go`）启发。

稳定导出见 [docs/api.zh-CN.md](docs/api.zh-CN.md)（[English API](docs/api.md)）。可复制的完整示例见 [`examples/`](examples/)（[中文说明](examples/README.zh-CN.md)）。

## 不包含什么

- 真实 LLM 供应商客户端（OpenAI、WebLLM 等）——请自行注入 `LlmPort`
- React 包、Demo SPA 或任何可视化应用
- Arbiter（仲裁器）完整语义场景（`plan_start` 只是关键词桩）
- ChapterAdvanceGate 审阅模式 UI
- Node 文件系统适配器——若需要 `fs`，请在本库外部实现 `StorePort`

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
│   StorePort（OpfsStore | MemoryStore）      │
│   LlmPort（由宿主注入）                      │
│   Engine.run → route(state) → Worker 工具   │
└─────────────────────────────────────────────┘
```

- **`route` 是纯函数。** 输入是显式的 `State` 快照。它不做 IO，也不调用 `StorePort` 或 `LlmPort`。
- **`StorePort`（存储端口）** 加载该快照并持久化产物。宿主注入 `MemoryStore`、`OpfsStore`、IndexedDB，或在本库外部实现 Node fs。
- **`LlmPort`（LLM 端口）** 执行 architect / writer / editor 补全（可选结构化 `toolCalls`）。本库只附带 `MockLlm` / `ReplayLlm`。

## 安装

```bash
npm install novel-engine
```

包导出：

| 入口 | 导入 | 作用 |
| --- | --- | --- |
| `.` | `novel-engine` | Engine、stores、client、mocks、snapshot、`route` |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores，供专用 Worker 使用 |

发布的 `files`：`dist/`、`README.md`、`LICENSE`。

## 快速开始（Mock 短篇）

完整可复制版本：[examples/short-book.ts](examples/short-book.ts)（含把三章跑到 `complete` 的 `MockLlm.fromHandler`）。

```ts
import { createEngine, MemoryStore, MockLlm } from "novel-engine";

const store = new MemoryStore();
const llm = new MockLlm([
  // 每次 complete() 消耗脚本里的一步。真实宿主请优先返回 toolCalls。
  { text: "done" },
]);

const engine = createEngine({ store, llm, maxSteps: 40 });
const result = await engine.run({ prompt: "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。" });
// result.stoppedReason === "complete" | "idle" | "paused" | "max_steps"
```

要把整本书跑完，请用 `MockLlm.fromHandler`（Worker 工具会把结果写回对话；`audit_foundation` 必须复用 `novel_context` 给出的 `fingerprint`）。`ReplayLlm` 只按固定 `{ text, toolCalls? }[]` 回放，不读取请求内容。

`plan_start` 是**确定性桩**（无 Arbiter LLM）：提示词含 `长篇` 则选 `architect_long` / `long`；含 `中篇` 或 `分层` 则选 `architect_long` / `mid`；否则 `architect_short` / `short`。Worker 失败会重试一次，然后暂停。同一条 Route 指令连续五次也会暂停（死锁上限）。

仓库内受支持的短篇 mock 路径：

```bash
npm run test:short
```

## 分层 mock（中篇 / 长篇）

完整可复制版本：[examples/layered-book.ts](examples/layered-book.ts)。

`architect_long` 工具：`save_foundation(type=layered_outline|append_volume|complete_book)`、`expand_next_arc`。编辑摘要：`save_review`（弧/全局）、`save_arc_summary`、`save_volume_summary`。`novel_context` 是章节摘要的滑动窗口，若已落盘则附带弧/卷摘要（没有四段压缩器）。

```bash
npm run test:layered
```

分层夹具是一卷 / 两弧。两章展开写完后，Route 碰到弧末：editor `save_review` → `save_arc_summary` → `expand_next_arc`。第二弧结束后写卷摘要，再 `complete_book`。

宿主仍按短篇快速开始的方式注入 `MemoryStore` + `MockLlm`（或真实 `LlmPort`）——只是提示词关键词和工具名不同。

## 使用 OPFS 持久化

完整可复制版本：[examples/opfs-store.ts](examples/opfs-store.ts)。

`isOpfsAvailable()` 是能力探测（`navigator.storage.getDirectory`，测试里也可注入 fake）。

`createOpfsStore()` 在 OPFS 存在时打开 `OpfsStore`；**否则返回 `MemoryStore`**。内存是临时的——刷新页面产物就没了。必须持久化的宿主应先检查能力（或调用 `OpfsStore.open()`，不可用时抛 `OpfsUnavailableError`）。

```ts
import {
  createOpfsStore,
  isOpfsAvailable,
  OpfsStore,
} from "novel-engine";

if (!isOpfsAvailable()) {
  // Node、非安全上下文、或较旧的浏览器。
  // createOpfsStore() 会返回 MemoryStore，除非传入 { fallbackToMemory: false }。
}

const store = await createOpfsStore(); // OpfsStore | MemoryStore
const persisted = await OpfsStore.open(); // 子目录 "novel-engine"；不可用则抛错
```

写入先写到同级临时文件再 `move`（或 copy-then-unlink），避免写到一半崩溃时截断旧产物。

## 嵌入 Web Worker

完整可复制版本：[examples/engine.worker.ts](examples/engine.worker.ts)（Worker 线程）+ [examples/worker-host.ts](examples/worker-host.ts)（主线程）。

Worker 包是**独立入口**，便于打包器把主线程 client 从 Worker 里 treeshake 掉（反之亦然）。

Worker 模块（由宿主持有；在此注入你的 `LlmPort`）：

```ts
import { attachEngineWorker, createOpfsStore } from "novel-engine/worker";
import type { LlmPort } from "novel-engine/worker";

const llm: LlmPort = {
  async complete() {
    // gateway / WebLLM — 本库不附带供应商客户端
    return { text: "", toolCalls: [] };
  },
};

attachEngineWorker(self, {
  async createPorts() {
    const store = await createOpfsStore();
    return { store, llm };
  },
});
```

主线程：

```ts
import { createEngineClient } from "novel-engine";

const worker = new Worker(new URL("./engine.worker.js", import.meta.url), {
  type: "module",
});
const engine = createEngineClient(worker);

engine.onEvent((event) => {
  // event.kind: started | step | paused | resumed | steered | stopped
});

const result = await engine.start({ prompt: "写一本三章短篇：……" });
await engine.pause();
await engine.steer("把结局改成和解");
await engine.resume();
const snap = await engine.snapshot();
```

`pause` / `steer` 在**当前 Worker 指令结束之后**生效，不会打断正在执行的工具。`steer` 会记录一条决策并把 `flow=steering`，于是 `route` 返回 null，直到 `resume()` 恢复之前的 flow。

协议（`v: 1`）：主线程发出 `start` / `steer` / `pause` / `resume` / `snapshot`；Worker 回 `event` / `snapshot` / `error`。

## 书籍快照导出 / 导入

完整可复制版本：[examples/snapshot-roundtrip.ts](examples/snapshot-roundtrip.ts)。

用 fflate 把 store 中每个路径打成浏览器可用的 zip。还原是 merge：快照里的路径会被覆盖；目标里多出来的文件会留下。

```ts
import {
  exportBookSnapshot,
  importBookSnapshot,
  MemoryStore,
} from "novel-engine";

const bytes = await exportBookSnapshot(store); // Uint8Array zip
await importBookSnapshot(new MemoryStore(), bytes);
```

`MemoryStore` / `OpfsStore` 实现了 `list()`，因此自定义的额外文件也会打进包。没有 `list` 的自定义 `StorePort` 仍会导出已知的书籍布局（`meta/`、`chapters/` 等）。

## `route` 如何决策

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

`null` 是合法返回：Engine 接着尝试 plan_start 桩，或停止（`complete` / `idle`）。

## 示例一览

| 文件 | 说明 |
| --- | --- |
| [examples/short-book.ts](examples/short-book.ts) | 短篇跑到完结（`MockLlm` / `ReplayLlm`） |
| [examples/layered-book.ts](examples/layered-book.ts) | 分层中篇 `architect_long` |
| [examples/opfs-store.ts](examples/opfs-store.ts) | OPFS 与 MemoryStore 回落 |
| [examples/engine.worker.ts](examples/engine.worker.ts) + [worker-host.ts](examples/worker-host.ts) | Worker 嵌入与协议 |
| [examples/snapshot-roundtrip.ts](examples/snapshot-roundtrip.ts) | 快照 zip 往返 |

说明文档：[examples/README.zh-CN.md](examples/README.zh-CN.md) · [English](examples/README.md)

## 公开 API

```ts
import {
  createEngine,
  createEngineClient,
  createOpfsStore,
  isOpfsAvailable,
  MemoryStore,
  OpfsStore,
  MockLlm,
  ReplayLlm,
  route,
  inferPlanningStub,
  exportBookSnapshot,
  importBookSnapshot,
  type StorePort,
  type LlmPort,
} from "novel-engine";

import { attachEngineWorker } from "novel-engine/worker";
```

稳定面（领域类型、Worker 协议、快照常量）见 [docs/api.zh-CN.md](docs/api.zh-CN.md)。

## 开发 / 测试

```bash
npm install
npm test
npm run test:short
npm run test:layered
npm run typecheck
npm run build
```

测试**只用 mock 夹具**——无网络、无供应商、无真实 OPFS。

手写 JSON 夹具在 `fixtures/`：

- `phase-transitions.json` / `flow-transitions.json` — 校验器黄金表
- `route-cases.json` — Route 黄金用例
- `short-book.json` — 三章非分层 mock 书
- `layered-book.json` — 1 卷 / 2 弧 mock 中篇
- `book-snapshot.json` — MemoryStore 快照往返树

## 许可证

Apache-2.0
