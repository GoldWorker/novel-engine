# novel-engine

[English](README.md) | [简体中文](README.zh-CN.md)

**[指南](docs/guide.zh-CN.md)** · **[API](docs/api.zh-CN.md)** · **[架构](docs/architecture.zh-CN.md)** · [English](README.md)

可复用的 **TypeScript** 小说引擎 SDK，给想在浏览器（或 Node 测试）里生成小说的宿主（host）使用。纯 ESM，无 UI、无 React 绑定、无 TUI。

**0.5.0** 增加可选入口 **`novel-engine/kit`**：只有 `NovelKit.create`（没有 `new` + `init`），默认 **OPFS + Worker**，并**随包装箱发布** `dist/novel-kit.worker.js`，宿主不必再维护 Worker 源码。Session（`novel-engine/session`）仍是参考 API。默认 `.` / `./worker` / `./llm` 包仍然不含供应商客户端。

默认的 `novel-engine` / `novel-engine/worker` 从不连接真实模型。`src/` 中也从不使用 `node:fs` / `node:path`。

路由模型受 [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli)（`internal/flow/router.go`、`internal/host/engine.go`）启发。

**怎么用：** [指南](docs/guide.zh-CN.md)。**契约：** [api](docs/api.zh-CN.md)。**实现：** [架构](docs/architecture.zh-CN.md)。索引：[docs/README.zh-CN.md](docs/README.zh-CN.md)。可跑通示意：[`examples/`](examples/)。

## 不包含什么

- 默认 `novel-engine` / `novel-engine/worker` 包里的供应商 LLM 客户端——请自行注入 `LlmPort`，或导入可选的 [`novel-engine/llm`](docs/guide.zh-CN.md#scenario-llm)（fetch 适配器；**不要把 API Key 放进公开浏览器应用**）
- 默认包里的宿主 Session——请导入可选的 [`novel-engine/kit`](docs/guide.zh-CN.md#scenario-kit)（开箱门面）或 [`novel-engine/session`](docs/api.zh-CN.md#optional-host-session-novel-enginesession)（S0–S6 检查、生成、自动写作、ChapterRunner、基础设定影响评估、Worker 桥、工作区）
- React 包、Demo SPA 或任何可视化应用
- Arbiter（仲裁器）完整语义场景（`plan_start` 只是关键词桩）
- ChapterAdvanceGate 审阅模式 UI
- Node 文件系统适配器——若需要 `fs`，请在本库外部实现 `StorePort`

## 安装

**拷进宿主（推荐）：** 把本包放到应用里（`vendor/novel-engine/`、`packages/novel-engine/` …），构建 `dist/`，再用**相对路径**导入（或 `"novel-engine": "file:./vendor/novel-engine"` 保留包名）。细节：[指南 — 安装](docs/guide.zh-CN.md#install)。登记处 `npm install novel-engine` 是另一种方式。

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({ llmEndpoint: "/api/llm" });
const { gaps, readyToWrite } = await kit.inspect({ prompt: "写一本三章短篇" });
```

包入口：`.` / `./worker` / `./llm` / `./session` / `./kit` / `./kit/worker`。发布的 `files`：`dist/`、`README.md`、`LICENSE`。稳定面：[docs/api.zh-CN.md](docs/api.zh-CN.md)。

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
