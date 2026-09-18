# novel-engine

[English](README.md) | [简体中文](README.zh-CN.md)

**[指南](docs/guide.zh-CN.md)** · **[API](docs/api.zh-CN.md)** · **[架构](docs/architecture.zh-CN.md)** · [English](README.md)

可复用的 **TypeScript** 小说引擎 SDK，给想在浏览器（或 Node 测试）里生成小说的宿主（host）使用。纯 ESM，无 UI、无 React 绑定、无 TUI。

**0.5.0** 增加可选入口 **`novel-engine/kit`**：只有 `NovelKit.create`（没有 `new` + `init`），默认 **OPFS + Worker**，并**随包装箱发布** `dist/novel-kit.worker.js`，宿主不必再维护 Worker 源码。Session（`novel-engine/session`）仍是参考 API。默认 `.` / `./worker` / `./llm` 包仍然不含供应商客户端。

默认的 `novel-engine` / `novel-engine/worker` 从不连接真实模型。`src/` 中也从不使用 `node:fs` / `node:path`。

路由模型受 [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli)（`internal/flow/router.go`、`internal/host/engine.go`）启发。

**怎么用：** [指南](docs/guide.zh-CN.md)。**契约：** [api](docs/api.zh-CN.md)。**实现：** [架构](docs/architecture.zh-CN.md)。索引：[docs/README.zh-CN.md](docs/README.zh-CN.md)。

## 开箱即用（`NovelKit`）

**只有 `NovelKit.create`**（没有 `new` + `init`）。默认 **OPFS + Worker**。包装箱**自带** `dist/novel-kit.worker.js`。Worker 的 `LlmPort.complete` 是 `fetch(llmEndpoint)`——供应商密钥放在 BFF，不要放进 Worker。省略 `bookId` → `"default"`。

| 选项 | 默认 | 如何关掉 |
| --- | --- | --- |
| `store` | `"opfs"` | `"memory"`（Node/测试） |
| `runtime` | `"worker"` | `"main"`（Node/测试；必须传 `llm`） |
| `llmEndpoint` | `"/api/llm"` | 你的 BFF 路由 |
| `bookId` | `"default"` | 任意非空字符串 |
| `fallbackToMemory` | `true` | `false`：没有 OPFS 时抛错 |

浏览器（推荐）：

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  llmEndpoint: "/api/llm", // Worker fetch — Worker 里不要放 API Key
  // 省略 bookId → "default"
});

const { gaps, readyToWrite } = await kit.inspect({ prompt: "写一本三章短篇" });
await kit.fillFoundation({ book: { title: "无主的信", synopsis: "灯塔与潮" } });
const outcome = await kit.startBook({
  prompt: "写一本三章短篇：……",
  generateMissing: true, // 可能返回 { status: "needs_foundation", gaps }
});
kit.subscribe((event) => console.log(event.type));
kit.dispose();
```

Node / 测试（`runtime: "main"` + `store: "memory"`；**必须**传 `llm`）：

```ts
import { MockLlm } from "novel-engine";
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  runtime: "main",
  store: "memory",
  llm: new MockLlm([{ text: JSON.stringify({ premise: "……" }) }]),
  bookId: "letter",
});
```

可跑文件：[`examples/kit-host.ts`](examples/kit-host.ts)。完整 Kit 怎么用（Worker URL、方法对照、两步 `applyFoundation`）：[指南](docs/guide.zh-CN.md#scenario-kit)。契约：[api](docs/api.zh-CN.md#optional-novelkit-novel-enginekit)。

Kit 名称一一对应 Session（`inspect` → `inspectFoundation`，`applyFoundation` → `applyFoundationChange`，…）。对**拟议**补丁先评估再 apply。`rewriteChapters` 默认 **false**。已审计的长流程（7.2a–e 确认闸门）：[指南 §7.2a–e](docs/guide.zh-CN.md#scenario-session-impact)。

## 安装

**拷进宿主（推荐）：** 把本包放到应用里（`vendor/novel-engine/`、`packages/novel-engine/` …），构建 `dist/`，再用**相对路径**导入（或 `"novel-engine": "file:./vendor/novel-engine"` 保留包名）。细节：[指南 — 安装](docs/guide.zh-CN.md#install)。登记处 `npm install novel-engine` 是另一种方式。

```ts
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
```

包入口：

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

每一行对应一类真实任务。打开链接里的 `examples/*.ts` 去复制；需要上下文 how-to（含已审计的 Session **7.2a–e** / **8.1** 确认闸门）时再打开 [指南](docs/guide.zh-CN.md)。`examples/` 是文档，不进入 `npm test`。仓库内 mock：`npm run test:short` 与 `npm run test:layered`。

| 场景 | 什么时候用 | 指南 | 实例 |
| --- | --- | --- | --- |
| 0. **NovelKit（推荐）** | 浏览器工作台：OPFS + 自带 Worker；Node/测试：`runtime: "main"` + `store: "memory"` | [Kit](docs/guide.zh-CN.md#scenario-kit) | [`kit-host.ts`](examples/kit-host.ts) |
| 1. 短篇完结 | 同线程把三章短篇 mock 跑到 `phase=complete` | [§1](docs/guide.zh-CN.md#scenario-short-book) | [`short-book.ts`](examples/short-book.ts) |
| 2. 分层中长篇 | 卷/弧大纲，弧末审阅 → `expand_next_arc` | [§2](docs/guide.zh-CN.md#scenario-layered-book) | [`layered-book.ts`](examples/layered-book.ts) |
| 3. 浏览器持久化（OPFS） | 刷新后产物还在 | [§3](docs/guide.zh-CN.md#scenario-opfs) | [`opfs-store.ts`](examples/opfs-store.ts) |
| 4. 嵌入 Web Worker | 专用 Engine Worker + 主线程 client | [§4](docs/guide.zh-CN.md#scenario-worker) | [`engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) |
| 5. 书稿快照导入导出 | 把 store 打成 zip 再 merge 恢复 | [§5](docs/guide.zh-CN.md#scenario-snapshot) | [`snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) |
| 6. 注入真实 LLM | `novel-engine/llm` 放在 BFF 后面 | [§6](docs/guide.zh-CN.md#scenario-llm) | [`llm-openai.ts`](examples/llm-openai.ts) |
| 7. 宿主 Session | 检查、设定 upsert/生成、**先评估再应用**、单章写作、目录、工作区 | [§7](docs/guide.zh-CN.md#scenario-session)（[7.2a–e](docs/guide.zh-CN.md#scenario-session-impact)） | [`session-workspace.ts`](examples/session-workspace.ts) |
| 8. Worker 上的 Session | 同一套 Session API 离开 UI 线程 | [§8](docs/guide.zh-CN.md#scenario-session-worker)（[8.1](docs/guide.zh-CN.md#scenario-session-worker-impact)） | [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts) |

常见坑（先评估拟议补丁、整表替换、`rewriteChapters` + `suggestedMode: "none"`、`getProgress()` 为 null）：[指南](docs/guide.zh-CN.md#pitfalls)。

## 实例

可跑通的 TypeScript 在 [`examples/`](examples/)。按上一表复制对应文件。Worker 嵌入需要 **两份**文件。

| 文件 | 什么时候复制 |
| --- | --- |
| [`kit-host.ts`](examples/kit-host.ts) | 开箱 Kit 宿主 |
| [`short-book.ts`](examples/short-book.ts) | 脚本化三章 Engine mock |
| [`layered-book.ts`](examples/layered-book.ts) | 卷/弧 Engine mock |
| [`opfs-store.ts`](examples/opfs-store.ts) | 浏览器 OPFS store |
| [`engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) | 宿主自有 Engine Worker |
| [`snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) | 书稿快照 zip / merge |
| [`llm-openai.ts`](examples/llm-openai.ts) | 受信任宿主 / BFF 上的 `novel-engine/llm` |
| [`session-workspace.ts`](examples/session-workspace.ts) | 同线程 Session（含评估 / 应用） |
| [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts) | Worker 上的 Session |

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

稳定面：[docs/api.zh-CN.md](docs/api.zh-CN.md)。Session 契约（S0–S6、错误、协议）：[api — Session](docs/api.zh-CN.md#optional-host-session-novel-enginesession)。

## 不包含什么

- 默认 `novel-engine` / `novel-engine/worker` 包里的供应商 LLM 客户端——请自行注入 `LlmPort`，或导入可选的 [`novel-engine/llm`](docs/guide.zh-CN.md#scenario-llm)（fetch 适配器；**不要把 API Key 放进公开浏览器应用**）
- 默认包里的宿主 Session——请导入可选的 [`novel-engine/kit`](docs/guide.zh-CN.md#scenario-kit)（开箱门面）或 [`novel-engine/session`](docs/api.zh-CN.md#optional-host-session-novel-enginesession)（S0–S6 检查、生成、自动写作、ChapterRunner、基础设定影响评估、Worker 桥、工作区）
- React 包、Demo SPA 或任何可视化应用
- Arbiter（仲裁器）完整语义场景（`plan_start` 只是关键词桩）
- ChapterAdvanceGate 审阅模式 UI
- Node 文件系统适配器——若需要 `fs`，请在本库外部实现 `StorePort`

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
