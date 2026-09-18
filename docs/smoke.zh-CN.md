# 冒烟测试 vs 宿主 E2E

[English](smoke.md) | [中文文档](smoke.zh-CN.md)

本包装箱测什么，以及《写作工作台》（宿主应用）仍要自己测什么。

## 本仓库覆盖

| 层级 | 位置 | 命令 | 证明什么 |
| --- | --- | --- | --- |
| 单元 / 契约 | `tests/**/*.test.ts`（现有约 260 条 vitest） | `npm test` | Engine、Session、Kit 方法、适配器、fixture |
| **Tier 2 — README 场景冒烟** | `tests/smoke/` | `npm run test:smoke`（也包含在 `npm test` 中） | 文档里的 **宿主任务** 用 `NovelKit` + **MockLlm** 从头走到尾（无网络） |
| **Tier 1 — 浏览器 / 真实 Worker 冒烟** | `tests/browser/`（Playwright） | `npm run build && npm run test:browser` | 构建产物 `dist/kit.js` + 自带的 `dist/novel-kit.worker.js` 能在 Chromium 里加载；init 握手；inspect → fill → `startBook`（需要时 `confirmAuditGap`）打到 **本地 mock BFF** |

Tier 2 场景（README 任务）：

1. 短篇：`inspect` → `fillFoundation` → `startBook` → 若 `auditOnly` 则 `confirmAuditGap` → `completed` / `stopped`
2. 中篇 / 分层：写入 `layeredOutline` → `startBook`（加 audit 确认）
3. 中途改元信息：`assessFoundation` → `rewrite_needed` 的两步 `applyFoundation`
4. 章节：`writeChapter` create → `getChapter` → `deleteChapter`（`syncOutline`）
5. 控制：进行中的 `startBook` → `pauseBook` / `resumeBook` / `cancelBook` + `getRunState`
6. 在 `store: "memory"` 上导出 / 导入往返

Tier 1 说明：

- 假 LLM 是 harness 上的 `POST /api/llm`（脚本化 `{ text, toolCalls? }`）。**没有 OpenAI / Anthropic / DashScope 密钥或外网。**
- Kit 按默认 **`runtime: "worker"`** 创建。若 `dist/novel-kit.worker.js` 404，测试失败。
- 存储：默认 **OPFS**，`fallbackToMemory: true`。无头 Chromium 在 `http://127.0.0.1` 上通常可用 OPFS；若 `getDirectory()` 失败，worker 会用 **MemoryStore**（`storeKind: "memory"`）。这是文档里的 Kit 回退，**不是**跳过真实 worker 文件。
- localhost 已是安全上下文，一般不需要额外 Chromium flags。若某套 CI 镜像上 OPFS 不稳，保持 `fallbackToMemory: true`，不要 stub worker。

本机安装浏览器一次（CI 在 GitHub Actions 里做）：

```bash
npx playwright install --with-deps chromium
npm run build
npm run test:browser
```

`npm test` 仍然 **只跑 Node vitest**，这样没有安装 Playwright 浏览器的贡献者不会被打断。

## 仍由宿主负责（Tier 3）

**不要**在本仓库加 Next.js / 工作台 UI 测试。宿主应用应在真实的《写作工作台》上后续补 E2E。

宿主清单：

1. **BFF `/api/llm`** — `POST` worker 的 `LlmCompletionRequest` JSON；响应 `{ text: string, toolCalls? }`。供应商密钥只放服务端。非 OK HTTP 会让 worker 抛带 `status` 的 `LlmError`。
2. **Worker URL** — 默认相对 `dist/kit.js` 的 `new URL("./novel-kit.worker.js", import.meta.url)`。若打包器改写了 `import.meta.url` 导致 worker 404，把 `dist/novel-kit.worker.js` 拷到 `public/`，并传 `workerUrl: "/novel-kit.worker.js"`。
3. **OPFS** — 刷新后仍在；`fallbackToMemory` 只给不支持 OPFS 的浏览器。断言一本书能扛过 refresh。
4. **取消 UX** — `startBook` 进行中调用 `cancelBook()`；进行中的 Promise 拒绝 `AbortedError`；`getRunState()` 回到 `idle`；界面可再开写。
5. **确认闸门** — 只剩 `foundation_audit` → `confirmAuditGap: true`（不要用 `requireConfirmGaps: false` 跳过 book/大纲缺口）。中途 `rewrite_needed` 是两步 `applyFoundation`（先 `needs_confirm`，再 `confirmRewrite: true`）。
6. **Busy / 控制** — 写作中 `pauseBook` / `resumeBook` / `steerBook`；第二次 `startBook` / `writeChapter` 应得到 `SessionBusyError`。
7. **章节 + 导出** — UI 里创建 / 读取 / 删除；下载快照 zip 再导入。
8. **Worker 里没有密钥** — 在 `novel-kit.worker.js` 的 DevTools 里不应看到供应商机密。

这些步骤依赖宿主的路由、鉴权、文案和布局——不是本库的工具层测试。
