# novel-engine

[English](README.md) | [简体中文](README.zh-CN.md)

**[指南](docs/guide.zh-CN.md)** · **[API](docs/api.zh-CN.md)** · **[架构](docs/architecture.zh-CN.md)** · [English](README.md)

可复用的 **TypeScript** 小说引擎 SDK，给想在浏览器（或 Node 测试）里生成小说的宿主（host）使用。纯 ESM，无 UI、无 React 绑定、无 TUI。

**默认公开路径：** 可选入口 **`novel-engine/kit`**。只有 `NovelKit.create`（没有 `new` + `init`）。默认 **OPFS + Worker**。包装箱**自带** `dist/novel-kit.worker.js`。Session（`novel-engine/session`）是 Kit 包装的参考实现。Engine（`createEngine`）是 `startBook` 背后的循环。

默认的 `novel-engine` / `novel-engine/worker` 从不连接真实模型。`src/` 中也从不使用 `node:fs` / `node:path`。Worker 的 `LlmPort.complete` 是 `fetch(llmEndpoint)`——供应商密钥放在 BFF，不要放进 Worker。

路由模型受 [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) 启发。

本 README 是宿主落地页：**使用场景**（安装 → 开写 → 改元信息 → 章节 → 导出）加上 **完整 Kit API 目录**。已审计的长流程留在 [指南](docs/guide.zh-CN.md)（7.2a–e）。契约：[api](docs/api.zh-CN.md)。实现：[架构](docs/architecture.zh-CN.md)。索引：[docs/README.zh-CN.md](docs/README.zh-CN.md)。

---

<a id="使用场景"></a>
<a id="usage-scenarios"></a>

## 1. 使用场景

每一节对应宿主真实会做的一类工作。示例默认用 **`NovelKit`**。只有 Kit 做不到时才出现 Session / Engine（脚本化 Engine mock、宿主自有 Worker）。需要完整 mock LLM 时从 [`examples/`](examples/) 复制可跑文件。`examples/` 是文档，不进入 `npm test`。

已审计的中途确认闸门（只评估、仅元信息、只影响后续、改写确认、批量同步章节）：[指南 §7.2a–e](docs/guide.zh-CN.md#scenario-session-impact)。那里的 Session 名称与 Kit 一一对应（`assessFoundationImpact` → `assessFoundation`，`applyFoundationChange` → `applyFoundation`）。

<a id="install"></a>

### 安装

**拷进宿主（推荐）：** 把本包根目录（`package.json`、`src/`、`tsup.config.ts`、`tsconfig.json`、`LICENSE`）放到应用里（`vendor/novel-engine/`、`packages/novel-engine/` …）。**不要**拷 `node_modules/` 或过期的 `dist/`。重新构建后用**相对 `dist/` 路径**导入（或 `"novel-engine": "file:./vendor/novel-engine"` 保留包名）。

```bash
cd vendor/novel-engine
npm install                # fflate + tsup
npm run build              # 写出 dist/（相对路径导入所必需）
```

```ts
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
import { MockLlm } from "../../vendor/novel-engine/dist/index.js";
```

登记处（另一种方式）：

```bash
npm install novel-engine
```

```ts
import { NovelKit } from "novel-engine/kit";
```

发布的 npm `files`：`dist/`、`README.md`、`LICENSE`（只有这份英文 README——中文 README 与 `docs/` 在 git / 拷进仓库的副本里，不在登记处 tarball 中）。Node `>=18.17`。细节：[指南 — 安装](docs/guide.zh-CN.md#install)。

<a id="init"></a>
<a id="初始化-llm"></a>
<a id="wire-the-llm"></a>

### 初始化

**只有 `NovelKit.create`**。默认 **OPFS + Worker**。省略 `bookId` → `"default"`。**没有** `new NovelKit()` / `init()`。

LLM **只在 create 时接入**——没有中途更换 `llm` 或 `llmEndpoint` 的 API（Worker 的 endpoint 在 init 握手时定死）。

**何时必须传 / 何时可选**

- **浏览器默认**（`runtime: "worker"`，OPFS）：**不要**传 `llm`。传 **`llmEndpoint`**（BFF URL；默认 `"/api/llm"`）。Kit **自带** `dist/novel-kit.worker.js`，由 Worker `fetch` 该 URL。**不要**把 API Key 放进浏览器。
- **主线程 / Node / 测试**（`runtime: "main"`，通常 `store: "memory"`）：**必须**传 `llm: LlmPort`。省略会抛 `KitLlmRequiredError`。`llmEndpoint` 不会被使用。

**互相冲突的选项：** Worker 始终用 `llmEndpoint`（同时传 `llm` 也会被忽略）。Main 始终用 `llm`（`llmEndpoint` 不用）。自定义 `StorePort` 以及 `opfs.root` / `opfs.storage` 需要 `runtime: "main"`。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `store` | `"opfs"` | `"memory"`（Node/测试）或一个 `StorePort`（仅 `runtime: "main"`） |
| `runtime` | `"worker"` | `"main"`（Node/测试；**必须传 `llm`**） |
| `llm` | — | **`LlmPort` 实例。** `"main"` 上必填。`"worker"` 上**忽略** |
| `llmEndpoint` | `"/api/llm"` | **仅 Worker** — 随包装箱 Worker `fetch` 的 BFF URL。`"main"` 上不用。空字符串会抛错 |
| `bookId` | `"default"` | 任意非空字符串 |
| `workspace` | `true` | `false`：`createBook` / `switchBook` / `listBooks` 抛错 |
| `fallbackToMemory` | `true` | `false`：没有 OPFS 时抛 `OpfsUnavailableError` |

**浏览器默认（Worker + OPFS）** — 传 `llmEndpoint`。Worker 对该 URL `POST` `LlmCompletionRequest` JSON，期望返回 `{ text: string, toolCalls? }`。供应商密钥放在 BFF（在那边调用 `createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm`）：[指南 §6](docs/guide.zh-CN.md#scenario-llm)。

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  llmEndpoint: "/api/llm", // Worker fetch — Worker 里不要放 API Key
  // 省略 bookId → "default"
});

console.log(kit.runtime, kit.storeKind, kit.bookId); // "worker", "opfs"|"memory", "default"
```

**主线程 / Node / 测试** — 传入 `llm: LlmPort`。用 `novel-engine/llm` 适配器（`createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm`）、自定义 port 或 `MockLlm` 构造。

```ts
import { createOpenAiLlm } from "novel-engine/llm";
import { NovelKit } from "novel-engine/kit";

const llm = createOpenAiLlm({
  apiKey: "sk-replace-me", // 受信任宿主 / BFF 环境 — 不要放进公开 SPA
  model: "gpt-4o-mini",
});
// createAnthropicLlm({ apiKey: "sk-replace-me", model: "claude-sonnet-4-20250514" })
// createDashScopeLlm({ apiKey: "sk-replace-me", model: "qwen-plus" })
// import { MockLlm, type LlmPort } from "novel-engine";
// const llm: LlmPort = { complete: async () => ({ text: "……" }) };
// const llm = new MockLlm([{ text: JSON.stringify({ premise: "……" }) }]);

const kit = await NovelKit.create({
  runtime: "main",
  store: "memory",
  llm,
  bookId: "letter",
});
```

示意：[`examples/kit-host.ts`](examples/kit-host.ts)（Worker 的 `llmEndpoint` + main 的 `MockLlm`）。适配器工厂：[`examples/llm-openai.ts`](examples/llm-openai.ts) · [指南 §6](docs/guide.zh-CN.md#scenario-llm)。Worker URL / 打包器 404：[Worker 说明](#worker-notes)。完整选项：[API 目录](#novelkit-create)。

<a id="short-book"></a>

### 写短篇怎么用

Kit 路径：**inspect → fill 或 generate foundation → `startBook`**。`startBook` 包装 Session 的 `startAutoWrite`，缺口表为空（或你关掉缺口闸门）时跑 **`createEngine(...).run`**。提示词关键词：不含 `中篇` / `分层` / `长篇` 即为 **short**（`architect_short`）。短篇需要**扁平** `outline`（不能只用 `layeredOutline`）。

```ts
const prompt = "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。";

const inspected = await kit.inspect({ prompt });
// inspected.planning.tier === "short"
// inspected.gaps — book / premise / outline / characters / world_rules / foundation_audit

await kit.fillFoundation({
  book: { title: "无主的信", synopsis: "灯塔与潮" }, // 只有 title + synopsis（没有 tags 字段）
  premise: "林守在风暴后捡到一封没有寄信人的信。",
  outline: [
    { chapter: 1, title: "风暴之后", summary: "捡到信。" },
    { chapter: 2, title: "岸边的地址", summary: "找到空屋。" },
    { chapter: 3, title: "回信", summary: "把守夜写进回信。" },
  ],
  characters: [{ name: "林守", role: "主角" }],
  worldRules: [{ name: "信与潮", description: "涨潮来信，退潮回信。" }],
});
// 或者：await kit.generateFoundation({ prompt, keys: ["book", "premise", "outline", "characters", "world_rules"] });

let outcome = await kit.startBook({ prompt, generateMissing: true });
if (outcome.status === "needs_foundation" && outcome.auditOnly) {
  // 剩下的缺口只有 foundation_audit — 宿主确认后，由 Engine 写审查。
  // 不要在这里用 requireConfirmGaps: false：那会连 book/premise/outline 缺口一并跳过。
  outcome = await kit.startBook({ prompt, confirmAuditGap: true });
}
// outcome.status === "completed" | "stopped" | 若还有别的缺口则仍是 "needs_foundation"
```

`fillFoundation` 是 upsert（没有确认闸门）。`startBook` 在默认 `requireConfirmGaps: true` 时，**只要还有缺口就不会**调用 `Engine.run`——包括填齐设定后仍在的 `foundation_audit`。`inspect().auditOnly` / `needs_foundation.auditOnly` 告诉宿主剩下的只是审查缺口。`generateMissing` 关不掉 `foundation_audit`。

脚本化 Engine mock 跑到 `phase=complete`（绕过 Kit 缺口闸门）：[`examples/short-book.ts`](examples/short-book.ts) · [指南 §1](docs/guide.zh-CN.md#scenario-short-book) · `npm run test:short`。

<a id="long-book"></a>

### 写长篇怎么用

同一套 Kit 方法。规划档位是**关键词桩**（`inferPlanningStub`）：`长篇` → `long` / `architect_long`；`中篇` 或 `分层` → `mid` / `architect_long`；否则短篇。中长篇可以提供 **`layeredOutline`** 代替扁平 `outline`。有效的非空分层大纲即可满足大纲缺口；短篇仍然需要扁平 `outline.json`。

```ts
const prompt = "写一本分层中篇：一座海上灯塔里住着守塔人林守。一卷两弧。";

const { planning, gaps } = await kit.inspect({ prompt });
// planning.tier === "mid", planning.planner === "architect_long"

await kit.fillFoundation({
  book: { title: "两弧灯塔", synopsis: "接灯，再离岸归来。" },
  premise: "林守从父亲手里接过灯塔。",
  layeredOutline: [
    {
      index: 1,
      title: "守夜",
      theme: "灯塔与离岸",
      arcs: [
        {
          index: 1,
          title: "初夜",
          goal: "接灯并挺过第一场风暴",
          chapters: [
            { chapter: 1, title: "交接", summary: "父亲把钥匙交给林守。" },
            { chapter: 2, title: "风暴", summary: "独自扛过整夜风暴。" },
          ],
        },
        {
          index: 2,
          title: "远航",
          goal: "离开灯塔又带着答案归来",
          estimatedChapters: 2,
          chapters: [], // 骨架弧 — Engine 的 expand_next_arc 会补全
        },
      ],
    },
  ],
  characters: [{ name: "林守", role: "主角" }],
  worldRules: [{ name: "灯", description: "灯塔必须有人守夜。" }],
});

let outcome = await kit.startBook({ prompt, generateMissing: true });
if (outcome.status === "needs_foundation" && outcome.auditOnly) {
  outcome = await kit.startBook({ prompt, confirmAuditGap: true });
}
```

分层 Engine mock（卷/弧，弧末审阅 → `expand_next_arc`）：[`examples/layered-book.ts`](examples/layered-book.ts) · [指南 §2](docs/guide.zh-CN.md#scenario-layered-book) · `npm run test:layered`。长篇运行：`pauseBook` / `resumeBook` / `steerBook(message)` 转发到 `startBook` 期间持有的 Engine（main 与 worker）。没有在跑时调用会返回 `{ status: "idle" }`（空操作，不是异常）。

<a id="change-meta"></a>

### 如何中途改元信息

**先评估拟议补丁，再 apply。** 不要先 `fillFoundation`——同一内容再评估一次通常会变成「没有变化」。

- `characters` / `worldRules` / `outline` / `layeredOutline` 是**整文件替换**（漏掉的名字/章节会被删掉，不是合并）。`{ characters: [{ name: "林深" }] }` 会去掉林守。
- `rewrite_needed` 是**两步确认闸门**：第一次 `applyFoundation({ patch })` 返回 `{ status: "needs_confirm" }` 且**不写盘**。再带 `confirmRewrite: true` 重试。第一次就传 `confirmRewrite: true` 永远不会得到 `needs_confirm`。
- `rewriteChapters` 默认 **false**——章节不会自动改写。`rewriteChapters: true` 且 `suggestedMode === "none"` 时不会写章，除非再传 `mode: "rewrite" | "polish"`。

```ts
const patch = { characters: [{ name: "林深", role: "主角" }] }; // 整表替换

const assessment = await kit.assessFoundation(patch);
// assessment.severity: "meta_only" | "forward_only" | "rewrite_needed"
// assessment.suggestedChapters / suggestedMode / reasons — store 未改

let outcome = await kit.applyFoundation({ patch });
if (outcome.status === "needs_confirm") {
  // 展示 outcome.assessment.reasons — store 仍未改
  outcome = await kit.applyFoundation({
    patch,
    confirmRewrite: true,   // 宿主已确认影响范围
    rewriteChapters: false, // 仍然不会自动改写章节，除非你显式选择
  });
}
```

只改标题/简介（`book: { title, synopsis }`）通常是 `meta_only`，无需确认即可 apply。完整可复制流程（7.2a 只评估、7.2b 仅元信息、7.2c 只影响后续、7.2d 确认、7.2e 批量同步）：[指南 §7.2a–e](docs/guide.zh-CN.md#scenario-session-impact)。Session 形态示意：[`examples/session-workspace.ts`](examples/session-workspace.ts)。

<a id="read-meta"></a>

### 如何获取元信息

每次读取都是 **store 直读**（Kit 不缓存）。大纲在 `getMeta()` 上。`updateOutline({ outline? , layeredOutline? })` 通过 `fillFoundation` upsert 这些键（整文件替换，**没有**评估/确认闸门）。正文用 `getChapter(n)`。

```ts
const meta = await kit.getMeta();
// { book, premise, outline, layeredOutline, characters, worldRules, audit, progress }
// 文件不存在时对应字段为 null

const progress = await kit.getProgress(); // 在有 meta/progress.json 之前为 null
if (progress != null) {
  // progress.phase / completedChapters / currentChapter / layered / planningTier?
}

const inspected = await kit.inspect({ prompt: "写一本三章短篇" });
// { meta, gaps, readyToWrite, planning }

const files = await kit.listArtifacts();           // 全部逻辑路径
const chapters = await kit.listArtifacts("chapters/"); // 例如 chapters/01.md
```

调用 `latestCompleted(progress)` / `nextChapter(progress)` 前**先判断 `getProgress()` 是否为 null**（这些辅助函数在 `novel-engine` 上，不在 Kit 上）。指南：[§7.4](docs/guide.zh-CN.md#scenario-session-read) · [§7.5](docs/guide.zh-CN.md#scenario-session-toc)。

<a id="chapters"></a>

### 如何处理章节（增删改查）

Kit 对应 Session ChapterRunner：`getChapter` / `writeChapter` / `saveChapter` / `deleteChapter`。章号从 **1** 起。

`deleteChapter(n, { syncOutline? })` 删除 `drafts/NN.plan.json`、`drafts/NN.draft.md`、`chapters/NN.md`、`summaries/NN.json`（审阅文件留着）。会从 `completedChapters` / `pendingRewrites` 去掉 `n`；若 `currentChapter` 指向 `n` 则钳到剩余最大值；若删掉已完成章且 `phase === "complete"`，phase 回到 `writing`。`totalChapters` 不变。`syncOutline: true` 会 upsert 扁平 `outline` 和/或 `layeredOutline` 去掉该行（不重编号；删掉扁平大纲最后一行不受支持，因为 upsert 禁止空数组）。需要 `StorePort.remove`（MemoryStore / OpfsStore）。与 `startBook` / `writeChapter` / `applyFoundation` 共用 busy 标志。

| 意图 | API | 说明 |
| --- | --- | --- |
| 读 | `getChapter(n)` | `{ chapter, plan, draft, final, summary }`；什么都没有则 **`null`** |
| LLM 写 | `writeChapter({ chapter, mode, instruction?, title?, force? })` | 专用作者循环——**不是** `Engine.run`，**不是** `pendingRewrites` |
| 宿主 Markdown | `saveChapter(n, markdown)` | 写终稿，不调 LLM。空字符串会抛错 |
| 删除 | `deleteChapter(n, { syncOutline? })` | 上述产物；可选 TOC upsert。Busy |

`writeChapter` 的 `mode`（`CHAPTER_WRITE_MODES`）：

| `mode` | 前置条件 | 行为 |
| --- | --- | --- |
| `create` | 没有终稿（除非 `force: true`） | plan → draft(write) → commit。已有终稿 → `ChapterConflictError` |
| `continue` | 有草稿、**没有**终稿 | `draft_chapter(append)` 再 commit |
| `rewrite` | 有终稿 | 覆盖 plan/draft/commit。`instruction` **可选** |
| `polish` | 有终稿 | 对现有终稿做轻度改写 |

```ts
const view = await kit.getChapter(1); // 还没有任何产物时为 null

await kit.writeChapter({
  chapter: 1,
  mode: "create", // "continue" | "rewrite" | "polish"
  title: "风暴之后",
  instruction: "灯塔视角",
  // force: true,  // 仅 create：覆盖已有终稿
});

await kit.saveChapter(1, "# 风暴之后\n\n……");
await kit.deleteChapter(1, { syncOutline: true });
```

`writeChapter` 需要 `llm`（main）或可用的 `llmEndpoint`（worker）。它与 `startBook` / `applyFoundation` 共用 **busy** 标志（`SessionBusyError`）。给 `writeChapter` 用的 MockLlm 必须返回 **toolCalls**（`plan_chapter` / `draft_chapter` / `commit_chapter`）；`generateFoundation` 则从 **`text` 里读 JSON**。指南：[§7.3](docs/guide.zh-CN.md#scenario-session-chapter)。

<a id="export"></a>

### 导出 / 导入

```ts
const bytes = await kit.exportBook();     // 把 store 全部路径打成 Uint8Array zip（含清单）
await kit.importBook(bytes);              // merge 恢复；不会删除目标里多出来的文件
```

格式：`novel-engine-book-snapshot` v1。临时文件 `.*.tmp` 会跳过。直接操作 store：`novel-engine` 上的 `exportBookSnapshot` / `importBookSnapshot`。示意：[`examples/snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) · [指南 §5](docs/guide.zh-CN.md#scenario-snapshot)。

<a id="subscribe"></a>

### 订阅与释放

```ts
const off = kit.subscribe((event) => {
  // "foundation_updated" | "auto_write_step" | "chapter_step" | "stopped"
  // | "paused" | "resumed" | "steered"
  console.log(event.type);
});
off();           // 取消订阅
kit.dispose();   // 关闭 session + 终止 kit worker；之后再调会抛 KitClosedError
kit.dispose();   // 可重复调用
```

<a id="multi-book"></a>

### 多本书

默认 `workspace: true`，且 store 是**具名**的（`"opfs"` 或 `"memory"`）。`createBook` 会打开新书（上一本 session 被关闭）。自定义 `StorePort` → `storeKind: "custom"` → 多书方法抛 `KitWorkspaceDisabledError`。

```ts
await kit.createBook({ bookId: "b", title: "第二本" }); // kit.bookId === "b"
await kit.switchBook("letter");
const catalog = await kit.listBooks(); // { bookId, createdAt, title? }[]
```

`workspace: false` 会禁用这三个方法。Session 级工作区（宿主自备 `createStore`）：[指南 §7.6](docs/guide.zh-CN.md#scenario-session-workspace) · [`examples/session-workspace.ts`](examples/session-workspace.ts)。

<a id="worker-notes"></a>

### Worker 说明

- **Kit Worker ≠ Engine Worker。** Kit 用随包装箱发布的 `novel-engine/kit/worker`（`dist/novel-kit.worker.js`）。`novel-engine/worker` 是给宿主自有 Engine 循环用的 `attachEngineWorker`。
- 默认 URL：`new URL("./novel-kit.worker.js", import.meta.url)`，相对 `dist/kit.js`。若打包器改写了 `import.meta.url` 导致 Worker 404，把该文件拷到 `public/` 并传 `workerUrl: "/novel-kit.worker.js"`。
- Worker 的 `LlmPort` 是对 `llmEndpoint` 的 `fetch`（完成请求 JSON）。Worker 模式下 **`options.llm` 会被忽略**。
- 自定义 `StorePort` 以及 `opfs.root` / `opfs.storage` 需要 `runtime: "main"`。
- Node / CI：没有 `Worker` → `KitWorkerError`。请用 `runtime: "main"` + `store: "memory"`。
- Init 握手最多等 **15 秒**（超时抛 `KitWorkerError`）。协议：[架构 — Kit init](docs/architecture.zh-CN.md#kit-worker-init)。
- 宿主自有 Session Worker（不是 Kit）：[指南 §8](docs/guide.zh-CN.md#scenario-session-worker) · [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts)。宿主自有 Engine Worker：[指南 §4](docs/guide.zh-CN.md#scenario-worker)。

真实 LLM 适配器（`novel-engine/llm`）应放在 **BFF**，不要放进公开 SPA：[指南 §6](docs/guide.zh-CN.md#scenario-llm) · [`examples/llm-openai.ts`](examples/llm-openai.ts)。

---

<a id="api-catalog"></a>
<a id="按-api-粒度分类"></a>

## 2. 按 API 粒度分类

<a id="package-entries"></a>

### 包入口

| 入口 | 导入 | 作用 |
| --- | --- | --- |
| `.` | `novel-engine` | Engine、stores、client、mocks、snapshot、`route`、领域类型 |
| `./kit` | `novel-engine/kit` | 开箱 `NovelKit.create`（默认 OPFS + Worker） |
| `./kit/worker` | `novel-engine/kit/worker` | 随包装箱发布的 Kit Worker（`dist/novel-kit.worker.js`） |
| `./session` | `novel-engine/session` | 同线程 Session + Worker session 桥（参考 API） |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores，供**专用 Engine** Worker 使用 |
| `./llm` | `novel-engine/llm` | 可选 fetch `LlmPort` 适配器（OpenAI、Anthropic、DashScope） |

```ts
import { NovelKit, type FoundationPatch, type InspectResult } from "novel-engine/kit";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
import { createEngine, MockLlm, exportBookSnapshot } from "novel-engine";
import { attachEngineWorker } from "novel-engine/worker";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";
```

`./kit` 会再导出宿主常用的 Session 类型（`FoundationPatch`、`FoundationMeta`、`InspectResult`、`AutoWriteResult`、`SessionEvent`、apply/assess/章节类型等）。运行时 Kit 表面仍是 `NovelKit` + kit 错误/协议。默认 `.` / `./worker` / `./llm` 包不会拉进 Kit 或 Session。

<a id="novelkit-create"></a>

### `NovelKit.create` + 选项 + 只读字段

`NovelKit.create(options?: NovelKitOptions): Promise<NovelKit>` ——**唯一**公开构造路径。

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `runtime` | `"worker"` \| `"main"` | `"worker"` | `"main"` 为同线程（Node/测试）且**必须传 `llm`**。`"worker"` 用 `llmEndpoint`，不用 `llm` |
| `store` | `"opfs"` \| `"memory"` \| `StorePort` | `"opfs"` | 自定义 `StorePort` 仅限 `"main"`；`storeKind: "custom"` |
| `llm` | `LlmPort` | — | `"main"` 上**必填**（省略抛 `KitLlmRequiredError`）。`"worker"` 上即使传入也**忽略**。只在 create 时绑定（会话中途不能换）。用 `novel-engine/llm` 的 `createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm` 构造，或任意 `LlmPort` / `MockLlm`。怎么传：[初始化](#init) |
| `llmEndpoint` | `string` | `"/api/llm"` | **仅 Worker。** BFF URL；随包装箱的 `dist/novel-kit.worker.js` 会 `POST` 完成请求 JSON，期望 `{ text, toolCalls? }`。`"main"` 上不用。必须非空。**不要**把 API Key 放进浏览器 |
| `bookId` | `string` | `"default"` | trim 后非空 |
| `workerUrl` | `string` \| `URL` | 随包装箱 Worker | 默认 URL 404 时覆盖 |
| `workspace` | `boolean` | `true` | `false` → 多书方法抛错 |
| `fallbackToMemory` | `boolean` | `true` | `false` → 没有 OPFS 时抛错 |
| `opfs` | `{ directory?, root?, storage? }` | `directory: "novel-engine"` | `root` / `storage` 需要 `"main"`。每本书目录：`${directory}/${bookId}` |

实例上的只读字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `runtime` | `"worker"` \| `"main"` | Session/Engine 跑在哪里 |
| `bookId` | `string` | 当前书（`createBook` / `switchBook` 后会变） |
| `storeKind` | `"opfs"` \| `"memory"` \| `"custom"` | 实际在用的持久化（OPFS 可能已回落到 memory） |

`./kit` 另外导出：`defaultKitWorkerUrl()`、`attachKitWorker(port)`、`KIT_PROTOCOL` / `KIT_NS`、`KitLlmRequiredError`、`KitWorkerError`、`KitWorkspaceDisabledError`、`KitClosedError`。

<a id="novelkit-methods"></a>

### `NovelKit` 方法

名称一一对应 Session（不重写业务规则）。`dispose()` 之后再调任何方法都会抛 `KitClosedError`。

Busy 标志（Session 的 `SessionBusyError`）：**`startBook`**、**`writeChapter`**、**`applyFoundation`**、**`deleteChapter`** 互斥。`pauseBook` / `resumeBook` / `steerBook` **不**占 busy（只在 `startBook` 的 Engine 在跑时生效）。`inspect` / `fillFoundation` / `generateFoundation` / `assessFoundation` / `getChapter` / `saveChapter` / `updateOutline` / 读取 / 导出 **不**占用该标志。

#### 检查 / 就绪

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `inspect({ prompt? })` | `InspectResult` | `{ meta, gaps, readyToWrite, planning, auditOnly }`。`prompt`（否则 run_meta / progress / 分层大纲）决定缺口表用的规划档位 |
| `assertReady({ prompt? })` | `void` | 未就绪时抛 `FoundationIncompleteError`（`.gaps`） |

`readyToWrite` 为 true 当且仅当 `foundationMissing` 为空。中长篇若有有效的 `layered_outline.json`，**不**需要扁平 `outline.json`。book/premise/outline/characters/worldRules 都齐之后，剩下的缺口常常是 **`foundation_audit`**（`auditOnly: true`），直到 phase 为 `writing` 或 `complete`（由 Engine 写审查）。用 `confirmAuditGap: true` 重试——不要为了跳过审查去关 `requireConfirmGaps`。

#### 设定写入

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `fillFoundation(patch)` | `FoundationPatch` | `FoundationMeta` | Upsert。省略的键不变。数组**整文件替换**。指纹文件变化会作废 `foundation_audit`。**没有**评估 / 确认 |
| `generateFoundation({ prompt, keys, mode? })` | keys：`book` \| `premise` \| `outline` \| `layered_outline` \| `characters` \| `world_rules` | `FoundationMeta` | 一次性 LLM，**JSON 在 `text` 里**（不是 toolCalls）。`mode`：`"fill_missing"`（默认）或 `"overwrite"`。需要 `llm` / Worker endpoint。**不是** Engine 循环，**不**占 busy |
| `startBook({ prompt, foundation?, generateMissing?, requireConfirmGaps?, confirmAuditGap?, maxSteps? })` | — | `AutoWriteResult` | 可选 upsert/generate，然后 `{ status: "needs_foundation", gaps, meta, auditOnly }` **或** `Engine.run` → `{ status: "completed" \| "stopped", result, meta }`。默认 `requireConfirmGaps: true`。`confirmAuditGap: true` 仅在剩下的缺口都是审查时放行。占 busy |
| `pauseBook()` / `resumeBook()` / `steerBook(message)` | — | `{ status: "ok" \| "idle" }` | 转发到 `startBook` 期间持有的 Engine。没有在跑则为 `idle`（空操作）。空 steer 笔记抛 `EngineError`。不占 busy |

`generateFoundation` 的 keys 是 **snake_case**（`layered_outline`、`world_rules`）；patch 字段是 **camelCase**（`layeredOutline`、`worldRules`）。`BookMetadata` 只有 `{ title, synopsis }`。

#### 中途评估 / 应用

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `assessFoundation(patch, { refineWithLlm? })` | 拟议的 `FoundationPatch` | `FoundationImpactAssessment` | **不得改 store**。在 apply/fill **之前**评估。`refineWithLlm` 不能把启发式 `severity` 往下降 |
| `applyFoundation({ patch, confirmRewrite?, rewriteChapters?, requireConfirmRewrite?, refineWithLlm?, chapters?, mode?, instruction? })` | — | `{ status: "needs_confirm", assessment }` **或** `{ status: "applied", assessment, meta, writes }` | 内部会再评估一次。占 busy。`rewriteChapters` 默认 **false** |

`FoundationImpactAssessment`：`severity`（`meta_only` \| `forward_only` \| `rewrite_needed`）、`suggestedChapters`、`suggestedRanges`、`suggestedMode`（`none` \| `polish` \| `rewrite`）、`reasons`、`notes`、`changedKeys`、`source`（`heuristics` \| `llm`）。

常见坑：`rewrite_needed` 用两步 apply；整文件替换；`rewriteChapters: true` + `suggestedMode: "none"` 是空操作，除非再传 `mode`；`confirmRewrite: true` 永远不会返回 `needs_confirm`。

#### 章节

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `getChapter(n)` | `ChapterView \| null` | `n` 为大于 0 的整数 |
| `writeChapter(input)` | `ChapterWriteResult` `{ chapter, mode, view, turns }` | 模式见上。占 busy。需要 LLM |
| `saveChapter(n, markdown)` | `void` | 不调 LLM。markdown 必须非空 |
| `deleteChapter(n, { syncOutline? })` | `ChapterDeleteResult` | 删除 plan/draft/final/summary。占 busy。`syncOutline` 会 upsert 去掉该行的 TOC |
| `updateOutline({ outline?, layeredOutline? })` | `FoundationMeta` | 经 `fillFoundation` upsert（无评估/确认）。至少要有一个键 |

#### 读取 / 快照 / 工作区 / 事件

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `getMeta()` | `FoundationMeta` | 对应 Session `getFoundation` |
| `getProgress()` | `Progress \| null` | 用进度辅助函数前**先判空** |
| `listArtifacts(prefix?)` | `string[]` | 逻辑 store 路径 |
| `exportBook()` | `Uint8Array` | zip + 清单 |
| `importBook(bytes)` | `void` | merge；目标里多出来的文件还在 |
| `createBook({ bookId?, title? })` | `{ bookId }` | 省略则分配 id。切换到新书。需要 workspace |
| `switchBook(bookId)` | `void` | 未知 id → `BookNotFoundError`。上一本 session 被关闭 |
| `listBooks()` | `BookIndexEntry[]` | `{ bookId, createdAt, title? }` |
| `subscribe(listener)` | `() => void` | 取消订阅函数 |
| `dispose()` | `void` | 关闭 + `worker.terminate`。可重复调用 |

Worker 模式下 `createBook` / `switchBook` 会拆掉上一个 kit worker，再为该 `bookId` 打开新 session。

#### 你会碰到的错误

来自 `novel-engine/kit`：`KitClosedError`、`KitLlmRequiredError`、`KitWorkerError`、`KitWorkspaceDisabledError`。

来自 Session（方法原样抛出）：`FoundationIncompleteError`、`SessionLlmRequiredError`、`FoundationGenerateError`、`SessionBusyError`、`ChapterConflictError`、`ChapterRunnerError`、`SessionClosedError`、`BookNotFoundError`。

<a id="lower-level"></a>

### 更底层的 Session / Engine（指针表）

Kit 默认不合适时再用（自定义 `createStore`、脚本化 Engine 循环、宿主自有 Worker）。这**不是**第二份教程——契约：[api — Session](docs/api.zh-CN.md#optional-host-session-novel-enginesession) · [api — Engine](docs/api.zh-CN.md#engine)。

| 需求 | 导入 | 入口 |
| --- | --- | --- |
| 不要 Kit 默认的同线程 session | `createNovelSession({ store, llm?, bookId })` | `novel-engine/session` |
| 宿主自备多书 store | `createNovelWorkspace({ createStore, llm?, indexStore? })` | `novel-engine/session` |
| 自有 session worker | `createSessionClient` / `attachSessionWorker` | `novel-engine/session`（不是 `./worker`） |
| 脚本化跑到 `phase=complete` | `createEngine({ store, llm }).run({ prompt })` | `novel-engine` |
| 规划关键词桩 | `inferPlanningStub(prompt)` | `novel-engine` |
| Engine 离开 UI 线程 | `createEngineClient` + `attachEngineWorker` | `.` + `novel-engine/worker` |
| 不经 Kit 做快照 | `exportBookSnapshot` / `importBookSnapshot` | `novel-engine` |
| 不经 Kit 用 OPFS | `createOpfsStore` / `OpfsStore.open` | `novel-engine` |
| 供应商 fetch LLM | `createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm` / `createVendorLlm` | `novel-engine/llm` |

Kit → Session 名称：`inspect` → `inspectFoundation`，`assertReady` → `assertReadyToWrite`，`fillFoundation` → `upsertFoundation`，`startBook` → `startAutoWrite`，`pauseBook`/`resumeBook`/`steerBook` → `pause`/`resume`/`steer`，`assessFoundation` → `assessFoundationImpact`，`applyFoundation` → `applyFoundationChange`，`getChapter`/`writeChapter`/`saveChapter`/`deleteChapter` → `chapter.get`/`write`/`saveFinal`/`delete`，`updateOutline` → `upsertFoundation`（大纲键），`getMeta` → `getFoundation`，`exportBook`/`importBook` → `exportSnapshot`/`importSnapshot`，`dispose` → `close`（外加终止 worker）。

---

## 不包含什么

- 默认 `novel-engine` / `novel-engine/worker` 包里的供应商 LLM 客户端——请自行注入 `LlmPort`，或导入 [`novel-engine/llm`](docs/guide.zh-CN.md#scenario-llm)（**不要把 API Key 放进公开浏览器应用**）
- React 包、Demo SPA 或任何可视化应用
- Arbiter（仲裁器）完整语义场景（`plan_start` 只是关键词桩）
- ChapterAdvanceGate 审阅模式 UI
- Node 文件系统适配器——若需要 `fs`，请在本库外部实现 `StorePort`
- 会话中途换 LLM、`new NovelKit()`

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
