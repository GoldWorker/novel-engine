# novel-engine

[English](README.md) | [简体中文](README.zh-CN.md)

**[指南](docs/guide.zh-CN.md)** · **[Kit](docs/guide-kit.zh-CN.md)** · **[API](docs/api.zh-CN.md)** · **[Session](docs/session.zh-CN.md)** · **[架构](docs/architecture.zh-CN.md)** · [English](README.md)

可复用的 **TypeScript** 小说引擎 SDK，给想在浏览器（或 Node 测试）里生成小说的宿主（host）使用。纯 ESM，无 UI、无 React 绑定、无 TUI。

**0.5.0** 增加可选入口 **`novel-engine/kit`**：只有 `NovelKit.create`（没有 `new` + `init`），默认 **OPFS + Worker**，并**随包装箱发布** `dist/novel-kit.worker.js`，宿主不必再维护 Worker 源码。Session（`novel-engine/session`）仍是参考 API。默认 `.` / `./worker` / `./llm` 包仍然不含供应商客户端。

默认的 `novel-engine` / `novel-engine/worker` 从不连接真实模型。`src/` 中也从不使用 `node:fs` / `node:path`。

路由模型受 [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli)（`internal/flow/router.go`、`internal/host/engine.go`）启发。

文档索引：[docs/README.zh-CN.md](docs/README.zh-CN.md)。Ports、`route`、Worker 协议见 [架构](docs/architecture.zh-CN.md)（一句话：**`route` 是纯函数**；IO 由 Engine/Session 适配器完成）。

## 不包含什么

- 默认 `novel-engine` / `novel-engine/worker` 包里的供应商 LLM 客户端——请自行注入 `LlmPort`，或导入可选的 [`novel-engine/llm`](docs/llm-adapters.zh-CN.md)（fetch 适配器；**不要把 API Key 放进公开浏览器应用**）
- 默认包里的宿主 Session——请导入可选的 [`novel-engine/kit`](docs/guide-kit.zh-CN.md)（开箱门面）或 [`novel-engine/session`](docs/session.zh-CN.md)（S0–S6 检查、生成、自动写作、ChapterRunner、基础设定影响评估、Worker 桥、工作区）
- React 包、Demo SPA 或任何可视化应用
- Arbiter（仲裁器）完整语义场景（`plan_start` 只是关键词桩）
- ChapterAdvanceGate 审阅模式 UI
- Node 文件系统适配器——若需要 `fs`，请在本库外部实现 `StorePort`

## 安装

**拷进宿主（Next.js《小说工作台》推荐）：** 把本包放到应用里（`vendor/novel-engine/`、`packages/novel-engine/` …），构建 `dist/`，再用**相对路径**导入（或 `"novel-engine": "file:./vendor/novel-engine"` 保留包名）。细节：[指南 — 安装](docs/guide.zh-CN.md#install)。

```ts
// 从 my-app/src/lib/engine.ts
import { createEngine, MemoryStore } from "../../vendor/novel-engine/dist/index.js";
import { createNovelSession } from "../../vendor/novel-engine/dist/session.js";
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
import { attachEngineWorker } from "../../vendor/novel-engine/dist/worker.js";
import { createOpenAiLlm } from "../../vendor/novel-engine/dist/llm.js";
```

**登记处（另一种方式）：**

```bash
npm install novel-engine
```

也可以：旁边仓库构建后用 `file:../novel-engine` 依赖——这不是主路径。

包导出：

| 入口 | 导入 | 作用 |
| --- | --- | --- |
| `.` | `novel-engine` | Engine、stores、client、mocks、snapshot、`route` |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores，供专用 Worker 使用 |
| `./llm` | `novel-engine/llm` | 可选 fetch `LlmPort` 适配器（OpenAI、Anthropic、DashScope） |
| `./session` | `novel-engine/session` | 可选同线程宿主 Session + Worker session 桥 |
| `./kit` | `novel-engine/kit` | 开箱 `NovelKit.create`（默认 OPFS + Worker） |
| `./kit/worker` | `novel-engine/kit/worker` | 随包装箱发布的 Kit Worker（`dist/novel-kit.worker.js`） |

发布的 `files`：`dist/`、`README.md`、`LICENSE`。

<a id="使用场景"></a>

## 使用场景

宿主怎么用（含已审计的 Session **7.2a–e** / **8.1** 确认闸门流程）写在 **[指南](docs/guide.zh-CN.md)**。每一行对应一类真实任务；完整可跑文件见链接里的 `examples/*.ts`。`examples/` 是文档，不进入 `npm test`。仓库内 mock：`npm run test:short` 与 `npm run test:layered`。

| 场景 | 什么时候用 | 指南 | 规范源码 |
| --- | --- | --- | --- |
| 0. **NovelKit（推荐）** | 浏览器工作台：OPFS + 自带 Worker；Node/测试：`runtime: "main"` + `store: "memory"` | [kit](docs/guide-kit.zh-CN.md) | [`kit-host.ts`](examples/kit-host.ts) |
| 1. 短篇完结 | 同线程把三章短篇 mock 跑到 `phase=complete` | [§1](docs/guide.zh-CN.md#scenario-short-book) | [`short-book.ts`](examples/short-book.ts) |
| 2. 分层中长篇 | 卷/弧大纲，弧末审阅 → `expand_next_arc` | [§2](docs/guide.zh-CN.md#scenario-layered-book) | [`layered-book.ts`](examples/layered-book.ts) |
| 3. 浏览器持久化（OPFS） | 刷新后产物还在 | [§3](docs/guide.zh-CN.md#scenario-opfs) | [`opfs-store.ts`](examples/opfs-store.ts) |
| 4. 嵌入 Web Worker | 专用 Engine Worker + 主线程 client | [§4](docs/guide.zh-CN.md#scenario-worker) | [`engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) |
| 5. 书稿快照导入导出 | 把 store 打成 zip 再 merge 恢复 | [§5](docs/guide.zh-CN.md#scenario-snapshot) | [`snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) |
| 6. 注入真实 LLM | `novel-engine/llm` 放在 BFF 后面 | [§6](docs/guide.zh-CN.md#scenario-llm) | [`llm-openai.ts`](examples/llm-openai.ts) |
| 7. 宿主 Session | 检查、设定 upsert/生成、**先评估再应用**（[7.2a](docs/guide.zh-CN.md#scenario-session-impact-assess) · [7.2b](docs/guide.zh-CN.md#scenario-session-impact-meta) · [7.2c](docs/guide.zh-CN.md#scenario-session-impact-forward) · [7.2d 确认闸门](docs/guide.zh-CN.md#scenario-session-impact-confirm) · [7.2e 批量改写](docs/guide.zh-CN.md#scenario-session-impact-batch)）、单章写作、目录、工作区 | [§7](docs/guide.zh-CN.md#scenario-session) | [`session-workspace.ts`](examples/session-workspace.ts) |
| 8. Worker 上的 Session | 同一套 Session API 离开 UI 线程；[8.1 评估 + 应用](docs/guide.zh-CN.md#scenario-session-worker-impact) | [§8](docs/guide.zh-CN.md#scenario-session-worker) | [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts) |

快速开始与常见坑（先评估拟议补丁、整表替换、`rewriteChapters` + `suggestedMode: "none"`、`getProgress()` 为 null）：[指南](docs/guide.zh-CN.md) · [常见坑](docs/guide.zh-CN.md#pitfalls)。

目录索引：[`examples/README.zh-CN.md`](examples/README.zh-CN.md) · [English](examples/README.md)。

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
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
import { NovelKit } from "novel-engine/kit";
```

稳定面：[docs/api.zh-CN.md](docs/api.zh-CN.md)。Kit 怎么用：[docs/guide-kit.zh-CN.md](docs/guide-kit.zh-CN.md)。Session 契约：[docs/session.zh-CN.md](docs/session.zh-CN.md)。

## 开发 / 测试

```bash
npm install
npm test
npm run test:short
npm run test:layered
npm run typecheck
npm run build
npx tsc -p tsconfig.examples.json
```

测试只用 **mock fixture**——无网络、无真实供应商、无真实 OPFS。供应商适配器套件 mock `fetch`。

手写 JSON fixture 在 `fixtures/`：

- `phase-transitions.json` / `flow-transitions.json` — 校验器金标表
- `route-cases.json` — Route 金标用例
- `short-book.json` — 三章非分层 mock 书
- `layered-book.json` — 1 卷 / 2 弧 mock 中篇
- `book-snapshot.json` — MemoryStore 快照往返树

## 许可证

Apache-2.0
