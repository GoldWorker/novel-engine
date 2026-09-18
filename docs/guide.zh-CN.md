# 宿主指南

[English](guide.md) | [中文文档](guide.zh-CN.md)

给宿主应用的「怎么用」。先复制片段，再打开链接里的 `examples/*.ts` 看完整可跑文件。实现细节（`route`、协议、store 布局）：[架构](architecture.zh-CN.md)。契约：[api](api.zh-CN.md) · [session](session.zh-CN.md)。文档索引：[README](README.zh-CN.md)。

`examples/` 是文档，不进入 `npm test`。仓库内 mock：`npm run test:short` 与 `npm run test:layered`。

<a id="install"></a>

## 安装

### 把源码拷进宿主（推荐）

把本包的**包根目录**放进应用，重新安装并构建，再用相对路径导入（或用 `"novel-engine": "file:./vendor/novel-engine"` 保留包名）。

**拷什么：** 含 `package.json`、`src/`、`tsup.config.ts`、`tsconfig.json`、`LICENSE` 的目录（README 可选）。**不要**拷 `node_modules/` 或过期的 `dist/`——在副本里重新 `npm install` 和 `npm run build`。除非你有意保留版本历史，否则跳过 `.git/`。

```
my-app/
  package.json
  tsconfig.json
  src/
    lib/engine.ts          # 宿主代码
    app/page.tsx           # Next.js 示例
  vendor/novel-engine/     # 或 packages/ / lib/ / third_party/
    package.json
    src/
    tsup.config.ts
    dist/                  # 构建之后
```

```bash
# 拷贝之后
cd vendor/novel-engine
npm install                # 安装 fflate + tsup（构建需要）
npm run build              # 写出 dist/（上游 gitignore — dist 导入前必须有）
cd ../..
```

`dist/` 才是受支持的运行时表面（`exports` → `dist/*.js`）。`fflate` 是 external：要么依赖这份 vendored 目录（见下，让 npm 装上它），要么只做相对 `dist/` 导入时在宿主再装 `fflate`。

#### 相对路径导入 `dist/`（Node、Next.js、Vite）

从 `src/lib/engine.ts`：

```ts
import { createEngine, MemoryStore } from "../../vendor/novel-engine/dist/index.js";
import { createNovelSession } from "../../vendor/novel-engine/dist/session.js";
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
import { attachEngineWorker } from "../../vendor/novel-engine/dist/worker.js";
import { createOpenAiLlm } from "../../vendor/novel-engine/dist/llm.js";
```

从 `src/app/page.tsx`（App Router）前缀同样是 `../../vendor/novel-engine/dist/…`。Worker 模块可以 `import { attachEngineWorker } from "../../vendor/novel-engine/dist/worker.js"`。

#### 保留包名（`file:` 指向**已拷贝**的目录）

这仍是「在应用内部」，不是旁边另一个仓库：

```json
{
  "dependencies": {
    "novel-engine": "file:./vendor/novel-engine"
  }
}
```

然后可以用惯用导入：`novel-engine`、`novel-engine/kit`、`novel-engine/session`、`novel-engine/worker`、`novel-engine/llm`。引擎更新后在 `vendor/novel-engine` 里重新 `npm run build`。

#### TypeScript `paths` → `src/`（仅打包器）

Next.js / Vite（`moduleResolution: "bundler"`）可以编译这份 TypeScript。**Node 不能**直接 `import` `src/*.ts`（源码里的说明符是 `.js`）。任何不经打包器的 Node 运行，请用 `dist/`。

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "paths": {
      "novel-engine": ["./vendor/novel-engine/src/index.ts"],
      "novel-engine/kit": ["./vendor/novel-engine/src/kit/index.ts"],
      "novel-engine/session": ["./vendor/novel-engine/src/session/index.ts"],
      "novel-engine/worker": ["./vendor/novel-engine/src/worker.ts"],
      "novel-engine/llm": ["./vendor/novel-engine/src/adapters/llm/index.ts"]
    }
  }
}
```

模块路径上仍需要 `fflate`（在 `vendor/novel-engine` 或宿主里安装）。本仓库 `tsconfig.examples.json` 用同一套映射给 examples 做类型检查——它本身不是安装方式。

### 登记处（另一种方式）

```bash
npm install novel-engine
```

然后 `import { createEngine } from "novel-engine"`，子路径相同。打包 `files` 为 `dist/`、`README.md`、`LICENSE`。

### 也可以

旁边仓库构建后用 `"novel-engine": "file:../novel-engine"`，但这不是宿主的主布局。

打包实现：[架构](architecture.zh-CN.md#打包exports--本地引用)。

## 快速开始

**开箱（浏览器工作台推荐）：** [`novel-engine/kit`](guide-kit.zh-CN.md) — `NovelKit.create`、自带 Worker、默认 OPFS + Worker。Node/测试：`runtime: "main"` + `store: "memory"`。

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({ llmEndpoint: "/api/llm" });
const { gaps, readyToWrite } = await kit.inspect({ prompt: "写一本三章短篇" });
```

同线程 Engine + `MemoryStore` + `MockLlm`（包名导入；若 vendoring 且不用 `file:`，改用上面的相对 `dist/` 路径）：

```ts
import { createEngine, MemoryStore, MockLlm, inferPlanningStub } from "novel-engine";

const prompt = "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。";
const planning = inferPlanningStub(prompt); // short / architect_short
const engine = createEngine({
  store: new MemoryStore(),
  llm: MockLlm.fromHandler(shortBookHandler), // 从 examples/short-book.ts 复制
  maxSteps: 20,
});
const result = await engine.run({ prompt });
```

同线程 Session（可选 `novel-engine/session`）：

```ts
import { MemoryStore } from "novel-engine";
import { createNovelSession } from "novel-engine/session";

const session = await createNovelSession({
  store: new MemoryStore(),
  llm, // 只检查 / S5 启发式时可省略
  bookId: "letter",
});
const { gaps, readyToWrite } = await session.inspectFoundation({ prompt: "写一本三章短篇" });
```

`plan_start` 是关键词桩：`长篇` → long，`中篇`/`分层` → mid，否则 short。供应商密钥放在 BFF——见 [安全](#security)。

## Engine 场景

| 场景 | 何时 | 源码 |
| --- | --- | --- |
| [1. 短篇完结](#scenario-short-book) | 同线程 mock 到 `phase=complete` | [`short-book.ts`](../examples/short-book.ts) |
| [2. 分层中长篇](#scenario-layered-book) | 卷/弧大纲 | [`layered-book.ts`](../examples/layered-book.ts) |
| [3. OPFS 持久化](#scenario-opfs) | 刷新后产物还在 | [`opfs-store.ts`](../examples/opfs-store.ts) |
| [4. Engine Worker](#scenario-worker) | 循环离开 UI 线程 | [`engine.worker.ts`](../examples/engine.worker.ts) + [`worker-host.ts`](../examples/worker-host.ts) |
| [5. 书稿快照](#scenario-snapshot) | zip / merge 恢复 store | [`snapshot-roundtrip.ts`](../examples/snapshot-roundtrip.ts) |
| [6. 真实 LLM 适配器](#scenario-llm) | 经 BFF 使用 OpenAI / Anthropic / DashScope | [`llm-openai.ts`](../examples/llm-openai.ts) |

场景可以组合：Worker 示例已经调用 `createOpfsStore()`；快照适用于任意 `StorePort`。

<a id="scenario-short-book"></a>

### 1. 短篇完结

**何时：** Node 测试或同线程宿主。用脚本化的 `LlmPort` 填完基础设定、写满三章，停在 `complete`。

每次 `complete()` 必须返回 Worker `toolCalls`；`audit_foundation` 必须复用 `novel_context` 给出的 `fingerprint`。`ReplayLlm` 只按固定 `{ text, toolCalls? }[]` 回放，不看请求——列表不够长会在耗尽时抛错。

完整 handler：[`examples/short-book.ts`](../examples/short-book.ts)。仓库内：`npm run test:short`。

```ts
import {
  createEngine,
  MemoryStore,
  MockLlm,
  ReplayLlm,
  inferPlanningStub,
} from "novel-engine";

const prompt = "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。";
const planning = inferPlanningStub(prompt);
const store = new MemoryStore();
const llm = MockLlm.fromHandler(shortBookHandler); // 从 examples/short-book.ts 复制
const engine = createEngine({ store, llm, maxSteps: 20 });
const result = await engine.run({ prompt });
// result.stoppedReason === "complete" | "idle" | "paused" | "max_steps"

const replay = new ReplayLlm([
  {
    text: "save book",
    toolCalls: [
      { id: "1", name: "save_book", arguments: { title: "无主的信", synopsis: "……" } },
    ],
  },
]);
```

<a id="scenario-layered-book"></a>

### 2. 分层中长篇

**何时：** 需要卷/弧结构，而不是扁平大纲。

注入方式与场景 1 相同——只改提示词关键词和工具名。`architect_long` 工具：`save_foundation(type=layered_outline|append_volume|complete_book)`、`expand_next_arc`。Editor：`save_review`、`save_arc_summary`、`save_volume_summary`。`novel_context` 是章节摘要的滑动窗口，有弧/卷摘要时一并带上。

分层 fixture 是一卷两弧。展开两章后 Route 打到弧末：editor `save_review` → `save_arc_summary` → `expand_next_arc`。第二弧结束后写卷摘要，然后 `complete_book`。

完整 handler：[`examples/layered-book.ts`](../examples/layered-book.ts)。仓库内：`npm run test:layered`。

```ts
import { createEngine, MemoryStore, MockLlm, inferPlanningStub } from "novel-engine";

const prompt =
  "写一本分层中篇：一座海上灯塔里住着守塔人林守。一卷两弧，先写接灯，再写离岸归来。";
const planning = inferPlanningStub(prompt);
// planning.tier === "mid", planning.planner === "architect_long"

const engine = createEngine({
  store: new MemoryStore(),
  llm: MockLlm.fromHandler(layeredBookHandler), // 从 examples/layered-book.ts 复制
  maxSteps: 40,
});
const result = await engine.run({ prompt });
```

<a id="scenario-opfs"></a>

### 3. 浏览器持久化（OPFS）

**何时：** 浏览器宿主必须在刷新后保留产物。Node、非安全上下文、旧浏览器没有 OPFS。

`isOpfsAvailable()` 检查 `navigator.storage.getDirectory`（或测试注入的 fake）。`createOpfsStore()` 在有 OPFS 时打开 `OpfsStore`；**否则返回 `MemoryStore`**。Memory 是临时的。必须持久化时请检查能力、调用 `OpfsStore.open()`（会抛 `OpfsUnavailableError`），或传 `{ fallbackToMemory: false }`。

原子写入策略：[架构](architecture.zh-CN.md#opfs-写入策略)。本库从不使用 `node:fs`。

完整设置：[`examples/opfs-store.ts`](../examples/opfs-store.ts)。

```ts
import {
  createOpfsStore,
  isOpfsAvailable,
  MemoryStore,
  OpfsStore,
  OpfsUnavailableError,
  type StorePort,
} from "novel-engine";

export async function openStoreWithFallback(): Promise<StorePort> {
  if (!isOpfsAvailable()) {
    return new MemoryStore();
  }
  return createOpfsStore(); // OpfsStore | MemoryStore
}

export async function openPersistedStore(): Promise<OpfsStore> {
  try {
    return await OpfsStore.open(); // 子目录 "novel-engine"
  } catch (err) {
    if (err instanceof OpfsUnavailableError) throw err;
    throw err;
  }
}

export async function openOrThrow(): Promise<StorePort> {
  return createOpfsStore({ fallbackToMemory: false });
}
```

<a id="scenario-worker"></a>

### 4. 嵌入 Web Worker

**何时：** Engine 循环不能堵住 UI 线程。

Worker 包是**独立入口**。宿主自有的 Worker 文件里注入 `LlmPort`。生产环境优先 BFF（[场景 6](#scenario-llm)）。`pause` / `steer` 在当前 Worker 指令结束后生效。

协议概览：[架构](architecture.zh-CN.md#engine-worker-协议engine_protocol)。完整配对：[`examples/engine.worker.ts`](../examples/engine.worker.ts) + [`examples/worker-host.ts`](../examples/worker-host.ts)。两份都要复制。

Worker 模块：

```ts
import { attachEngineWorker, createOpfsStore } from "novel-engine/worker";
import type { LlmPort } from "novel-engine/worker";

const llm: LlmPort = {
  async complete() {
    // 网关 / WebLLM / 放在 BFF 后的 novel-engine/llm — 见场景 6
    return { text: "", toolCalls: [] };
  },
};

attachEngineWorker(self, {
  async createPorts() {
    const store = await createOpfsStore();
    return { store, llm, maxSteps: 40 };
  },
});
```

主线程：

```ts
import { createEngineClient, ENGINE_PROTOCOL } from "novel-engine";

const worker = new Worker(new URL("./engine.worker.js", import.meta.url), {
  type: "module",
});
const engine = createEngineClient(worker);

engine.onEvent((event) => {
  // event.kind: started | step | paused | resumed | steered | stopped
});

const result = await engine.start({
  prompt: "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。",
  maxSteps: 40,
});
await engine.pause();
await engine.steer("把结局改成和解");
await engine.resume();
const snap = await engine.snapshot();
console.log(result.stoppedReason, snap.paused, snap.running, ENGINE_PROTOCOL);
engine.close();
```

<a id="scenario-snapshot"></a>

### 5. 书稿快照导入导出

**何时：** 备份、转移、或在 store 之间灌入书稿树（Memory ↔ OPFS，或自定义 `StorePort`）。

恢复是 merge：快照路径被覆盖；目标里多出来的文件保留。格式细节：[架构](architecture.zh-CN.md#快照格式)。完整往返：[`examples/snapshot-roundtrip.ts`](../examples/snapshot-roundtrip.ts)。

```ts
import {
  BOOK_SNAPSHOT_FORMAT,
  BOOK_SNAPSHOT_VERSION,
  exportBookSnapshot,
  importBookSnapshot,
  MemoryStore,
  SnapshotError,
} from "novel-engine";

const source = new MemoryStore();
await source.write("meta/note.txt", "keep-me-source");
await source.write("chapters/01.md", "蜡封的瓶子");

const bytes = await exportBookSnapshot(source); // Uint8Array zip（PK 魔数）

const dest = new MemoryStore({ "extra/host.json": "{\"ok\":true}" });
try {
  await importBookSnapshot(dest, bytes); // merge
} catch (err) {
  if (err instanceof SnapshotError) throw err;
  throw err;
}
// dest 有快照里的 chapters/01.md；extra/host.json 仍在
```

<a id="scenario-llm"></a>

### 6. 注入真实 LLM（`novel-engine/llm`）

**何时：** 受信任的 Node 宿主、Electron 或 **服务端 BFF** 需要真实 `LlmPort`。不要把原始 API Key 打进公开 SPA。

可选子路径。基于 fetch 的 OpenAI / Anthropic / DashScope 适配器。没有 `openai` / `@anthropic-ai/sdk` 依赖。详情：[llm-adapters.zh-CN.md](llm-adapters.zh-CN.md)。示意：[`examples/llm-openai.ts`](../examples/llm-openai.ts)。

```ts
import { createEngine, MemoryStore } from "novel-engine";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";

const llm = createOpenAiLlm({
  apiKey: "sk-replace-me", // BFF / 受信任宿主环境 — 绝不是公开 SPA
  model: "gpt-4o-mini",
});
// createAnthropicLlm({ apiKey, model: "claude-sonnet-4-20250514" })
// createDashScopeLlm({ apiKey, model: "qwen-plus" })
// createVendorLlm({ provider: "dashscope", apiKey, model: "qwen-plus" })

const engine = createEngine({ store: new MemoryStore(), llm });
await engine.run({ prompt: "写一本三章短篇：……" });
```

## Session 宿主流程

可选 `novel-engine/session`。同线程检查、生成、中途改设定（评估 → 确认 → 应用）、单章写作、多书工作区。离主线程：[场景 8](#scenario-session-worker)。

契约与错误：[session.zh-CN.md](session.zh-CN.md)。示意：[`examples/session-workspace.ts`](../examples/session-workspace.ts)。

```ts
import { MemoryStore } from "novel-engine";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";

const store = new MemoryStore();
const session = await createNovelSession({ store, llm, bookId: "letter" });
```

`generateFoundation` 是 **`LlmPort.complete().text` 里的一次性 JSON**，不是 Engine 循环。`chapter.write` 是**专用作者循环**（不是 `Engine.run` / 不是 `pendingRewrites`）。`assessFoundationImpact` **规则优先**且不写盘。`applyFoundationChange` 除非 `rewriteChapters: true`，否则绝不自动重写章节。

<a id="scenario-session"></a>
<a id="scenario-session-gaps"></a>

### 7.1 自动写作前检查缺口

保持 `requireConfirmGaps: true`（默认）。若仍有缺口，`startAutoWrite` 提前返回 `needs_foundation`，**不**跑 Engine——用 `gaps[].hint` 提示 UI。

```ts
const outcome = await session.startAutoWrite({
  prompt: "写一本三章短篇：……",
  requireConfirmGaps: true, // 默认
});

if (outcome.status === "needs_foundation") {
  for (const gap of outcome.gaps) {
    // gap.key / gap.path / gap.hint — 如 book, premise, outline, characters…
  }
  return;
}
// outcome.status === "completed" | "stopped"

const { gaps, readyToWrite } = await session.inspectFoundation({ prompt: "……" });
```

<a id="scenario-session-foundation"></a>

### 7.2 自定义或 LLM 生成基础设定

**自定义**（表单 / 宿主已有数据）→ `upsertFoundation`。**LLM 补齐** → `generateFoundation`（`mode: "fill_missing"` | `"overwrite"`）。也可一并塞进 `startAutoWrite`。

```ts
await session.upsertFoundation({
  book: { title: "无主的信", synopsis: "……" },
  premise: "……",
  outline: [{ chapter: 1, title: "风暴之后", summary: "……" }], // 整文件替换
  characters: [{ name: "林守" }], // 整表替换；未出现的名字会被删除
  worldRules: [{ name: "信与潮", description: "……" }], // 整文件替换
});

await session.generateFoundation({
  prompt: "写一本三章短篇：……",
  keys: ["outline", "characters", "world_rules"], // 也可：book | premise | layered_outline
  mode: "fill_missing", // 默认；全量覆盖用 "overwrite"
});

await session.startAutoWrite({
  prompt: "……",
  foundation: { book: { title: "无主的信", synopsis: "……" } }, // 先 upsert
  generateMissing: true, // 再对剩余缺口 generate
  requireConfirmGaps: true, // 仍缺则返回 needs_foundation
});
```

指纹文件变更会作废 `foundation_audit`。中长篇可用 `layeredOutline` 代替扁平 `outline`。写作中途随时可以 upsert/generate；章节**不会**自动重写——先走 [7.2a–7.2e](#scenario-session-impact)，再动终稿。

<a id="scenario-session-impact"></a>

### 7.2a–7.2e 中途改基础设定（先评估再应用）

**先评估拟议补丁**（`assessFoundationImpact(patch)`，对照当前 store），再决定是否 apply、是否确认改写，以及（另一步）是否同步章节。**不要**先 upsert——同一内容再评估一次会看起来像「没有变更」。

**补丁形状：** 省略的键保持原样。一旦提供 `characters`、`worldRules`、`outline` 或 `layeredOutline` 数组，就是**整文件替换**——未出现的名字/章节会被删除，不是合并，也不是就地改名。`{ characters: [{ name: "林深" }] }` 会去掉林守。

示意：[`examples/session-workspace.ts`](../examples/session-workspace.ts)。Worker 上的同样调用见 [8.1](#scenario-session-worker-impact)。

| 任务 | 严重度 | 会改写章节吗？ |
| --- | --- | --- |
| [7.2a 只评估](#scenario-session-impact-assess) | 任意 | **不会** |
| [7.2b 仅元信息 apply](#scenario-session-impact-meta) | `meta_only` | 否（`suggestedMode: "none"`） |
| [7.2c 只影响后续 apply](#scenario-session-impact-forward) | `forward_only` | 否 |
| [7.2d 确认闸门](#scenario-session-impact-confirm) | `rewrite_needed` | 确认前否；确认后仍否，除非走 [7.2e](#scenario-session-impact-batch) |
| [7.2e 批量同步章节](#scenario-session-impact-batch) | `rewrite_needed` | 仅当 `rewriteChapters: true` |

<a id="scenario-session-impact-assess"></a>

#### 7.2a 只评估（不写盘）

对**拟议**补丁调用 `assessFoundationImpact(patch)`，且必须在 `applyFoundationChange` / `upsertFoundation` **之前**。

```ts
const patch = {
  // 整表替换：林守会被删除，不是就地改名
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
};

const assessment = await session.assessFoundationImpact(patch);
assessment.severity;          // "meta_only" | "forward_only" | "rewrite_needed"
assessment.suggestedChapters; // 如 [] 或 [1, 2]
assessment.suggestedMode;     // "none" | "polish" | "rewrite"
assessment.reasons;           // 给宿主 UI 的中英短句
assessment.notes;
assessment.changedKeys;       // 如 ["characters"]

if (assessment.severity === "rewrite_needed") {
  // 展示 assessment.reasons + suggestedChapters，等用户确认
} else {
  // meta_only / forward_only 无需改写确认即可 apply
}
```

这里的 `llm` 可选。只有需要 MockLlm/BFF JSON 精炼时才传 `{ refineWithLlm: true }`；启发式仍然给出严重度下限。

<a id="scenario-session-impact-meta"></a>

#### 7.2b 仅元信息 apply（标题 / 标签 / 简介）

```ts
const patch = {
  book: { title: "无主的信（修订）", synopsis: "灯塔与潮的简介改写，不改情节。" },
};

const assessment = await session.assessFoundationImpact(patch);
// assessment.severity === "meta_only"
// assessment.suggestedMode === "none"

const outcome = await session.applyFoundationChange({
  patch,
  rewriteChapters: false, // 默认；标题/标签不得改写章节
});
// outcome.status === "applied"
```

`meta_only` 不需要 `confirmRewrite`。这里即使传 `rewriteChapters: true` 也不会写章，除非再传 `mode: "rewrite" | "polish"`——因为 `suggestedMode` 是 `"none"`。

<a id="scenario-session-impact-forward"></a>

#### 7.2c 只影响后续（未来大纲 / 新角色）

```ts
const patch = {
  // 整文件替换：保留已写章节行，再追加后续章
  outline: [
    { chapter: 1, title: "风暴之后", summary: "林守在礁石缝里捡到那封信。" },
    { chapter: 2, title: "岸边的地址", summary: "按地址找到一座空屋。" },
    { chapter: 3, title: "回信", summary: "把守夜写进回信，放回海里。" },
    { chapter: 4, title: "灯塔之外", summary: "尚未写下的后续。" },
  ],
  // 整表替换：加「潮」时必须仍带上林守
  characters: [
    { name: "林守", role: "主角" },
    { name: "潮", role: "未出场", bio: "只在后续出现。" },
  ],
};

const assessment = await session.assessFoundationImpact(patch);
const outcome = await session.applyFoundationChange({
  patch,
  rewriteChapters: false,
});
```

已写章节的大纲行请保持原样，启发式才会停在 `forward_only`。改**已写**章的情节属于 [7.2d](#scenario-session-impact-confirm)。同样的坑：`suggestedMode === "none"` 时，除非宿主再传 `mode`，否则 `rewriteChapters: true` 也不会写章。

<a id="scenario-session-impact-confirm"></a>

#### 7.2d 需要改写 + 确认闸门

默认闸门下，未传 `confirmRewrite: true` 时 `applyFoundationChange` **不写盘**。请用两步 apply——**不要**先带 `confirmRewrite: true` 再指望看到 `needs_confirm`。

```ts
const patch = {
  premise: "林深从未离开灯塔。",
  // 整表替换：characters.json 里的林守会被删掉
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
};

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  // 用 outcome.assessment.reasons 提示 UI — store 仍未改
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,    // 宿主已确认影响范围
    rewriteChapters: false,  // 仍然不会自动改写章节（见 7.2e）
  });
}
// outcome.status === "applied"
```

关掉闸门（`requireConfirmRewrite: false`）只适合测试/工具——工作台 UI 应保持默认。

<a id="scenario-session-impact-batch"></a>

#### 7.2e 批量同步章节（`rewriteChapters: true`）

确认之后，章节**仍然**不会改写，除非宿主在**已确认的重试**上显式传入 `rewriteChapters: true`。`rewriteChapters: true` 且 `suggestedMode === "none"` 时不会写章，除非宿主再传 `mode: "rewrite" | "polish"`。

```ts
import { MemoryStore, MockLlm } from "novel-engine";

const llm = new MockLlm([
  {
    text: "write",
    toolCalls: [
      { id: "plan-1", name: "plan_chapter", arguments: { chapter: 1, title: "风暴之后", goal: "g", conflict: "c", hook: "h" } },
      { id: "draft-1", name: "draft_chapter", arguments: { chapter: 1, content: "重写：林深守着灯塔。", mode: "write" } },
      { id: "commit-1", name: "commit_chapter", arguments: { chapter: 1 } },
    ],
  },
  { text: "done" },
]);

const session = await createNovelSession({ store, llm, bookId: "letter" });
const patch = { characters: [{ name: "林深", role: "主角" }] }; // 整表替换

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,
    rewriteChapters: true, // 宿主显式选择——绝不是默认；只放在确认后的重试上
    instruction: "按新设定对齐本章",
  });
}
```

省略 `rewriteChapters`（或传 `false`）则只更新设定。不走 `pendingRewrites`。

<a id="scenario-session-chapter"></a>

### 7.3 单章创建 / 续写 / 改写 / 打磨

`session.chapter` 是专用作者循环——不是全书 `Engine.run`。

| 意图 | `mode` | 前置条件 |
| --- | --- | --- |
| 新建章 | `create` | 无终稿（或 `force: true`） |
| 续写草稿 | `continue` | 有草稿、无终稿 |
| 重写已完成章 | `rewrite` | 有终稿 + `instruction` |
| 轻度打磨 | `polish` | 有终稿 |

```ts
const view = await session.chapter.get(1); // plan / draft / final / summary，全无则 null

await session.chapter.write({
  chapter: 1,
  mode: "create", // | "continue" | "rewrite" | "polish"
  title: "风暴之后",
  instruction: "灯塔视角",
});

await session.chapter.saveFinal(1, "# 风暴之后\n\n……");
```

<a id="scenario-session-read"></a>

### 7.4 获取最新的基础元信息

Session **不缓存**产物——每次都是 store 直读。

```ts
const foundation = await session.getFoundation();
// { book, premise, outline, layeredOutline, characters, worldRules, audit, progress }

const progress = await session.getProgress();
session.subscribe((event) => {
  // foundation_updated | auto_write_step | chapter_step | stopped
});
```

<a id="scenario-session-toc"></a>

### 7.5 获取目录结构与对应章节

没有单独的「目录 API」：大纲在 `getFoundation()`，正文按章号用 `chapter.get(n)`。

```ts
import { flattenOutline, latestCompleted, nextChapter } from "novel-engine";

const { outline, layeredOutline, progress } = await session.getFoundation();
const flat = layeredOutline ? flattenOutline(layeredOutline) : (outline ?? []);
const finals = await session.listArtifacts("chapters/");

const view = await session.chapter.get(1);
if (view == null) {
  // 该章尚无 plan / draft / final / summary
}

const stored = await session.getProgress();
if (stored == null) {
  // 还没有 meta/progress.json
} else {
  const n = latestCompleted(stored); // 已完成章号最大值；没有则为 0
  const latest = n > 0 ? await session.chapter.get(n) : null;
  const next = nextChapter(stored);  // n + 1
  const current = stored.currentChapter;
  const inProgress = current ? await session.chapter.get(current) : null;
}
```

章节号从 **1** 起。调用 `latestCompleted` 前先判断 `getProgress()` 是否为 null。

<a id="scenario-session-workspace"></a>

### 7.6 小说切换与上下文状态恢复

一书一个 `StorePort`。`switchTo` / `open` 会 **关闭** 上一份 session——旧引用必须丢弃。

```ts
const stores = new Map<string, MemoryStore>();
const ws = createNovelWorkspace({
  createStore(bookId) {
    const existing = stores.get(bookId);
    if (existing) return existing;
    const next = new MemoryStore();
    stores.set(bookId, next);
    return next;
  },
  llm,
});

await ws.createBook({ bookId: "a", title: "无主的信" });
await ws.createBook({ bookId: "b", title: "两弧灯塔" });

const sessionA = await ws.switchTo("a");
const restored = await sessionA.getFoundation();
```

有 `indexStore` 时冷启动：`listBooks()` 可恢复书目，但**不会自动 open**。没有 Workspace-over-Worker——工作区留在 UI 线程；需要时每本书一个 session Worker（[场景 8](#scenario-session-worker)）。

<a id="scenario-session-worker"></a>

### 8. Worker 上的 Session（`createSessionClient`）

**何时：** 自动写作 / 章节操作 / 应用设定不能堵住 UI，并且供应商 API Key 必须留在 BFF。

从 `novel-engine/session` 导入 `attachSessionWorker`（不要从 `novel-engine/worker`）。`LlmPort.complete` 应 `fetch("/api/llm")`。协议：[架构](architecture.zh-CN.md#session-桥session_protocol) · [session S4](session.zh-CN.md#s4--worker-桥)。

配对：[`examples/session.worker.ts`](../examples/session.worker.ts) + [`examples/session-host.ts`](../examples/session-host.ts)。

```ts
import { createSessionClient } from "novel-engine/session";

const worker = new Worker(new URL("./session.worker.ts", import.meta.url), { type: "module" });
const session = createSessionClient(worker, { bookId: "letter" });
await session.inspectFoundation({ prompt: "写一本三章短篇" });
await session.startAutoWrite({ prompt: "……", generateMissing: true });
await session.chapter.write({ chapter: 1, mode: "create" });
```

<a id="scenario-session-worker-impact"></a>

#### 8.1 跨 Worker 桥评估 + 应用

与 [7.2a–7.2e](#scenario-session-impact) 相同：client 仍是 `NovelSession`。`rewrite_needed` 请用两步 apply。

```ts
const patch = { characters: [{ name: "林深", role: "主角" }] }; // 整表替换

const assessment = await session.assessFoundationImpact(patch);
// assessment.severity / suggestedChapters / suggestedMode / reasons — UI 线程，不写盘

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  // 展示 outcome.assessment.reasons — store 未改
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,
    rewriteChapters: false, // Worker 上同样要宿主显式选择；绝不自动改写
  });
}
```

Busy（`SessionBusyError`）是 Worker 侧 session 标志：进行中的 `applyFoundationChange` 会挡住跨桥的 `chapter.write`。

<a id="pitfalls"></a>

## 常见坑

- **先评估拟议补丁**：`assessFoundationImpact(patch)` 必须在 `applyFoundationChange` / `upsertFoundation` **之前**。同一内容已经写入后再评估一次，通常会看起来像「没有变更」。
- **`characters` / `worldRules` / `outline` / `layeredOutline` 是整文件替换。** `{ characters: [{ name: "林深" }] }` 会删掉林守，不是就地改名。想保留的行必须全部带上。
- **`rewriteChapters: true` 且 `suggestedMode === "none"`**（常见于 `meta_only` / `forward_only`）时不会写章，除非宿主再传 `mode: "rewrite" | "polish"`。
- **调用 `latestCompleted(progress)` / `nextChapter(progress)` 前先判断 `getProgress()` 是否为 null。**
- **两步确认：** 先不带 `confirmRewrite` apply；若 `status === "needs_confirm"`，再带 `confirmRewrite: true` 重试。已传 `confirmRewrite: true` 时不会再返回 `needs_confirm`。
- **密钥放在 BFF。** 不要把供应商 API Key 打进公开 SPA 或 Worker 包。

<a id="security"></a>

## 安全

**不要把供应商 API Key 放进公开 Web 应用。** 生产环境（包括 Next.js 工作台）请把密钥留在 BFF，让 Worker `fetch` 该路由。适配器详情：[llm-adapters.zh-CN.md](llm-adapters.zh-CN.md)。
