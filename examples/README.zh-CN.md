# 使用示例

可跑通的 TypeScript 源码，索引在 **[宿主指南](../docs/guide.zh-CN.md)**（[English](../docs/guide.md)）。根目录 [README](../README.zh-CN.md) 是产品入口；实现细节在 [架构](../docs/architecture.zh-CN.md)。

这些文件按真实应用的方式导入 `novel-engine` / `novel-engine/worker`。它们是**文档**（不进入 `npm test`）；仓库内可跑通的 mock 仍是 `npm test`、`npm run test:short`、`npm run test:layered`。

不要在这里重复怎么用——指南才是枢纽。本目录是深链目标。

[English](README.md) · [简体中文](README.zh-CN.md)

## 文件

| 场景（指南） | 文件 |
| --- | --- |
| [1. 短篇完结](../docs/guide.zh-CN.md#scenario-short-book) | [`short-book.ts`](short-book.ts) |
| [2. 分层中长篇](../docs/guide.zh-CN.md#scenario-layered-book) | [`layered-book.ts`](layered-book.ts) |
| [3. 浏览器持久化（OPFS）](../docs/guide.zh-CN.md#scenario-opfs) | [`opfs-store.ts`](opfs-store.ts) |
| [4. 嵌入 Web Worker](../docs/guide.zh-CN.md#scenario-worker) | [`engine.worker.ts`](engine.worker.ts) + [`worker-host.ts`](worker-host.ts) |
| [5. 书稿快照导入导出](../docs/guide.zh-CN.md#scenario-snapshot) | [`snapshot-roundtrip.ts`](snapshot-roundtrip.ts) |
| [6. 注入真实 LLM](../docs/guide.zh-CN.md#scenario-llm) | [`llm-openai.ts`](llm-openai.ts) |
| [7. 宿主 Session](../docs/guide.zh-CN.md#scenario-session) | [`session-workspace.ts`](session-workspace.ts)（含 [7.2a–7.2e](../docs/guide.zh-CN.md#scenario-session-impact) 评估 / 应用） |
| [8. Worker 上的 Session](../docs/guide.zh-CN.md#scenario-session-worker) | [`session.worker.ts`](session.worker.ts) + [`session-host.ts`](session-host.ts)（含 [8.1](../docs/guide.zh-CN.md#scenario-session-worker-impact)） |

Web Worker 嵌入需要 **两份**文件。把 Worker 文件里的 `LlmPort` 占位换成网关 / WebLLM，或把 `novel-engine/llm` 放在 BFF 后面。见 [docs/llm-adapters.zh-CN.md](../docs/llm-adapters.zh-CN.md)。

本仓库可选类型检查（把 `novel-engine` 映射到 `src/`）：

```bash
npx tsc -p tsconfig.examples.json
```
