# 使用示例

本目录是可跑通的 TypeScript 源码，索引在根目录 **[README 使用场景](../README.zh-CN.md#使用场景)**（[English](../README.md#usage-by-scenario)）。

文件按真实应用方式从 `novel-engine` / `novel-engine/worker` 导入。它们是**文档**，不进入 `npm test`；仓库内可跑通的 mock 路径仍是 `npm test`、`npm run test:short`、`npm run test:layered`。

怎么用请看根 README，这里不再重复长文。本目录只做深链目标。

[English](README.md) · [简体中文](README.zh-CN.md)

## 文件

| 场景（根 README） | 文件 |
| --- | --- |
| [1. 短篇完结](../README.zh-CN.md#scenario-short-book) | [`short-book.ts`](short-book.ts) |
| [2. 分层中长篇](../README.zh-CN.md#scenario-layered-book) | [`layered-book.ts`](layered-book.ts) |
| [3. 浏览器持久化（OPFS）](../README.zh-CN.md#scenario-opfs) | [`opfs-store.ts`](opfs-store.ts) |
| [4. 嵌入 Web Worker](../README.zh-CN.md#scenario-worker) | [`engine.worker.ts`](engine.worker.ts) + [`worker-host.ts`](worker-host.ts) |
| [5. 书稿快照导入导出](../README.zh-CN.md#scenario-snapshot) | [`snapshot-roundtrip.ts`](snapshot-roundtrip.ts) |
| [6. 注入真实 LLM](../README.zh-CN.md#scenario-llm) | [`llm-openai.ts`](llm-openai.ts) |
| [7. 宿主 Session](../README.zh-CN.md#scenario-session) | [`session-workspace.ts`](session-workspace.ts)（含 [7.2a–7.2e](../README.zh-CN.md#scenario-session-impact) 评估 / 应用） |
| [8. Worker 上的 Session](../README.zh-CN.md#scenario-session-worker) | [`session.worker.ts`](session.worker.ts) + [`session-host.ts`](session-host.ts)（含 [8.1](../README.zh-CN.md#scenario-session-worker-impact)） |

Web Worker 嵌入需要 **两份**文件。把 Worker 文件里的 `LlmPort` 占位换成网关 / WebLLM，或把 `novel-engine/llm` 放在 BFF 后面。见 [docs/llm-adapters.zh-CN.md](../docs/llm-adapters.zh-CN.md)。

本仓库可选类型检查（把 `novel-engine` 映射到 `src/`）：

```bash
npx tsc -p tsconfig.examples.json
```
