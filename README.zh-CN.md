# novel-engine

[English](README.md) | [简体中文](README.zh-CN.md)

可复用的 **TypeScript** 小说引擎 SDK，给想在浏览器（或 Node 测试）里生成小说的宿主（host）使用。纯 ESM，无 UI、无 React 绑定、无 TUI。

**0.4.0** 在可选入口 `novel-engine/session` 上增加 Session **S5/S6**（`assessFoundationImpact` / `applyFoundationChange`），并保留 `novel-engine/llm`（OpenAI / Anthropic / DashScope 的 fetch 适配器）。默认包仍然不含供应商客户端，也不会打进 session。

默认的 `novel-engine` / `novel-engine/worker` 从不连接真实模型。`src/` 中也从不使用 `node:fs` / `node:path`。

路由模型受 [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli)（`internal/flow/router.go`、`internal/host/engine.go`）启发。

稳定导出见 [docs/api.zh-CN.md](docs/api.zh-CN.md)（[English API](docs/api.md)）。Session：[docs/session.zh-CN.md](docs/session.zh-CN.md)。

**怎么用？** 先看 [使用场景](#使用场景) — [短篇完结](#scenario-short-book) · [分层中长篇](#scenario-layered-book) · [浏览器持久化](#scenario-opfs) · [Web Worker](#scenario-worker) · [书稿快照](#scenario-snapshot) · [真实 LLM 适配器](#scenario-llm) · [宿主 Session](#scenario-session)（[缺口检查](#scenario-session-gaps) · [基础设定](#scenario-session-foundation) · [基础设定影响](#scenario-session-impact)（[只评估](#scenario-session-impact-assess) · [仅元信息](#scenario-session-impact-meta) · [只影响后续](#scenario-session-impact-forward) · [确认闸门](#scenario-session-impact-confirm) · [批量改写](#scenario-session-impact-batch)）· [单章写作](#scenario-session-chapter) · [读元信息](#scenario-session-read) · [目录与章节](#scenario-session-toc) · [切书恢复](#scenario-session-workspace)）· [Worker 上的 Session](#scenario-session-worker)（[评估 / 应用](#scenario-session-worker-impact)）。可跑通的源码在 [`examples/`](examples/)。

## 不包含什么

- 默认 `novel-engine` / `novel-engine/worker` 包里的供应商 LLM 客户端——请自行注入 `LlmPort`，或导入可选的 [`novel-engine/llm`](docs/llm-adapters.zh-CN.md)（fetch 适配器；**不要把 API Key 放进公开浏览器应用**）
- 默认包里的宿主 Session——请导入可选的 [`novel-engine/session`](docs/session.zh-CN.md)（S0–S6 检查、生成、自动写作、ChapterRunner、基础设定影响评估、Worker 桥、工作区）
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
│  StorePort（OpfsStore | MemoryStore）       │
│  LlmPort（由宿主注入）                       │
│  Engine.run → route(state) → Worker 工具    │
└─────────────────────────────────────────────┘
```

- **`route` 是纯函数。** 输入是显式的 `State` 快照。它不做 IO，也不调用 `StorePort` 或 `LlmPort`。
- **`StorePort`（存储端口）** 加载该快照并持久化产物。宿主注入 `MemoryStore`、`OpfsStore`、IndexedDB，或在本库外部实现 Node fs。
- **`LlmPort`（LLM 端口）** 执行 architect / writer / editor 补全（可选结构化 `toolCalls`）。默认入口只附带 `MockLlm` / `ReplayLlm`。可选 fetch 适配器：`novel-engine/llm`。

## 安装

```bash
npm install novel-engine
```

包导出：

| 入口 | 导入 | 作用 |
| --- | --- | --- |
| `.` | `novel-engine` | Engine、stores、client、mocks、snapshot、`route` |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores，供专用 Worker 使用 |
| `./llm` | `novel-engine/llm` | 可选 fetch `LlmPort` 适配器（OpenAI、Anthropic、DashScope） |
| `./session` | `novel-engine/session` | 可选同线程宿主 Session + Worker session 桥 |

发布的 `files`：`dist/`、`README.md`、`LICENSE`。

## 使用场景

本节是宿主的「怎么用」入口。每一行对应一类真实任务：先复制片段，再打开链接里的 `examples/*.ts` 看完整可跑文件（handler、合并规则、协议）。`examples/` 是文档，不进入 `npm test`。仓库内可跑通的 mock 路径：`npm run test:short` 与 `npm run test:layered`。

场景可以组合：Worker 示例已经调用 `createOpfsStore()`；快照导入导出适用于任意 `StorePort`。

| 场景 | 什么时候用 | 规范源码 |
| --- | --- | --- |
| [1. 短篇完结](#scenario-short-book) | 同线程把三章非分层短篇 mock 跑到 `phase=complete`。默认 `plan_start` 路径（`architect_short` + `MemoryStore` + `MockLlm`）。 | [`examples/short-book.ts`](examples/short-book.ts) |
| [2. 分层中长篇](#scenario-layered-book) | 卷/弧大纲，弧末审阅 → 摘要 → `expand_next_arc`，然后 `complete_book`。提示词关键词选出 `architect_long`。 | [`examples/layered-book.ts`](examples/layered-book.ts) |
| [3. 浏览器持久化（OPFS）](#scenario-opfs) | 用 Origin Private File System 让产物在刷新后还在；没有 OPFS 时回落到临时的 `MemoryStore`。 | [`examples/opfs-store.ts`](examples/opfs-store.ts) |
| [4. 嵌入 Web Worker](#scenario-worker) | 专用 Worker + 主线程 client：`start` / `steer` / `pause` / `resume` / `snapshot`。 | [`engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) |
| [5. 书稿快照导入导出](#scenario-snapshot) | 把 store 中每个路径打成 zip（fflate），再 merge 进另一个 `StorePort`。 | [`examples/snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) |
| [6. 注入真实 LLM](#scenario-llm) | 宿主侧通过可选的 `novel-engine/llm` 得到 OpenAI / Anthropic / DashScope 的 `LlmPort`。密钥放在 BFF。 | [`examples/llm-openai.ts`](examples/llm-openai.ts) |
| [7. 宿主 Session（检查 + 生成 + ChapterRunner + 影响评估 + 工作区）](#scenario-session) | 同线程 `NovelSession` / `NovelWorkspace`：[缺口检查](#scenario-session-gaps)、[设定 upsert/生成](#scenario-session-foundation)、[中途改设定](#scenario-session-impact)（[只评估](#scenario-session-impact-assess) · [仅元信息](#scenario-session-impact-meta) · [只影响后续](#scenario-session-impact-forward) · [确认闸门](#scenario-session-impact-confirm) · [批量改写](#scenario-session-impact-batch)）、[单章写作](#scenario-session-chapter)、[读最新元信息](#scenario-session-read)、[目录与章节](#scenario-session-toc)、[切书 / 恢复](#scenario-session-workspace)。 | [`examples/session-workspace.ts`](examples/session-workspace.ts) |
| [8. Worker 上的 Session](#scenario-session-worker) | 工作台：把 `startAutoWrite` / `chapter.write` / `assessFoundationImpact` / `applyFoundationChange` 移出 UI 线程。[跨桥评估 + 应用](#scenario-session-worker-impact)。`createSessionClient` + `attachSessionWorker`。`LlmPort` fetch BFF——Worker 里不放供应商密钥。 | [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts) |

`plan_start` 是**确定性桩**（无 Arbiter LLM）：提示词含 `长篇` 则选 `architect_long` / `long`；含 `中篇` 或 `分层` 则选 `architect_long` / `mid`；否则 `architect_short` / `short`。Worker 失败会重试一次，然后暂停。同一条 Route 指令连续五次也会暂停（死锁上限）。

目录索引（不再重复怎么用）：[`examples/README.zh-CN.md`](examples/README.zh-CN.md) · [English](examples/README.md)。

<a id="scenario-short-book"></a>

### 1. 短篇完结

**何时：** Node 测试或同线程宿主。要用脚本化的 `LlmPort` 填完基础设定、写满三章，并停在 `complete`。

接线是 `createEngine` + `MemoryStore` + `MockLlm.fromHandler`。每次 `complete()` 都要返回 Worker 的 `toolCalls`；`audit_foundation` 必须复用 `novel_context` 给出的 `fingerprint`。`ReplayLlm` 只按固定 `{ text, toolCalls? }[]` 回放，不读取请求内容——列表不够长就会耗尽抛错。

完整 handler（architect → writer → editor 直到 `phase=complete`）：[`examples/short-book.ts`](examples/short-book.ts)（`shortBookHandler`、`replayLlmSketch`、`runShortBook`）。仓库内：`npm run test:short` + `fixtures/short-book.json`。

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
// planning.tier === "short", planning.planner === "architect_short"

const store = new MemoryStore();
const llm = MockLlm.fromHandler(shortBookHandler); // 从 examples/short-book.ts 复制
const engine = createEngine({ store, llm, maxSteps: 20 });
const result = await engine.run({ prompt });
// result.stoppedReason === "complete" | "idle" | "paused" | "max_steps"

// ReplayLlm 不读请求——列表必须覆盖每一次 complete()：
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

**何时：** 中篇或长篇需要卷/弧结构，而不是扁平大纲。

注入方式与场景 1 相同（`createEngine` + `MemoryStore` + `MockLlm`）——只是提示词关键词和工具名不同。

`architect_long` 工具：`save_foundation(type=layered_outline|append_volume|complete_book)`、`expand_next_arc`。编辑：`save_review`（弧/全局）、`save_arc_summary`、`save_volume_summary`。`novel_context` 是章节摘要的滑动窗口，若已落盘则附带弧/卷摘要（没有四段压缩器）。

分层夹具是一卷 / 两弧。两章展开写完后，Route 碰到弧末：editor `save_review` → `save_arc_summary` → `expand_next_arc`。第二弧结束后写卷摘要，再 `complete_book`。

完整 handler：[`examples/layered-book.ts`](examples/layered-book.ts)（`layeredBookHandler`、`runLayeredBook`）。仓库内：`npm run test:layered` + `fixtures/layered-book.json`。

```ts
import { createEngine, MemoryStore, MockLlm, inferPlanningStub } from "novel-engine";

const prompt =
  "写一本分层中篇：一座海上灯塔里住着守塔人林守。一卷两弧，先写接灯，再写离岸归来。";
const planning = inferPlanningStub(prompt);
// planning.tier === "mid", planning.planner === "architect_long"
// 提示词含 长篇 → { tier: "long", planner: "architect_long" }

const engine = createEngine({
  store: new MemoryStore(),
  llm: MockLlm.fromHandler(layeredBookHandler), // 从 examples/layered-book.ts 复制
  maxSteps: 40,
});
const result = await engine.run({ prompt });
```

<a id="scenario-opfs"></a>

### 3. 浏览器持久化（OPFS）

**何时：** 浏览器宿主必须在刷新后保住产物。Node、非安全上下文、较旧的浏览器没有 OPFS。

`isOpfsAvailable()` 是能力探测（`navigator.storage.getDirectory`，测试里也可注入 fake）。

`createOpfsStore()` 在 OPFS 存在时打开 `OpfsStore`；**否则返回 `MemoryStore`**。内存是临时的——刷新页面产物就没了。必须持久化的宿主应先检查能力（或调用 `OpfsStore.open()`，不可用时抛 `OpfsUnavailableError`），或传入 `{ fallbackToMemory: false }`。

写入先写到同级临时文件再 `move`（或 copy-then-unlink），避免写到一半崩溃时截断旧产物。

本库从不使用 `node:fs` / `node:path`。若需要 Node 文件系统适配器，请在包外实现 `StorePort`。

完整装配（`openStoreWithFallback`、`openPersistedStore`、`openOrThrow`）：[`examples/opfs-store.ts`](examples/opfs-store.ts)。

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
    // Node、非安全上下文、或较旧的浏览器。
    return new MemoryStore();
  }
  return createOpfsStore(); // OpfsStore | MemoryStore
}

export async function openPersistedStore(): Promise<OpfsStore> {
  try {
    return await OpfsStore.open(); // 子目录 "novel-engine"
  } catch (err) {
    if (err instanceof OpfsUnavailableError) throw err; // 没有 OPFS
    throw err;
  }
}

export async function openOrThrow(): Promise<StorePort> {
  return createOpfsStore({ fallbackToMemory: false });
}
```

<a id="scenario-worker"></a>

### 4. 嵌入 Web Worker

**何时：** Engine 循环不应卡住 UI 线程。把专用 Worker 模块和主线程 client 配对。

Worker 包是**独立入口**，便于打包器把主线程 client 从 Worker 里 treeshake 掉（反之亦然）。Worker 文件由宿主持有：在此注入你的 `LlmPort`。默认入口不附带供应商客户端；可选 fetch 适配器是 `novel-engine/llm`（生产请走 BFF——见场景 6）。Worker 里也可以用 `MockLlm.fromHandler`——见场景 1。

`pause` / `steer` 在**当前 Worker 指令结束之后**生效，不会打断正在执行的工具。`steer` 会记录一条决策并把 `flow=steering`，于是 `route` 返回 null，直到 `resume()` 恢复之前的 flow。

协议（`ENGINE_PROTOCOL === 1`）：主线程发出 `start` / `steer` / `pause` / `resume` / `snapshot`；Worker 回 `event` / `snapshot` / `error`。事件 kind：`started` | `step` | `paused` | `resumed` | `steered` | `stopped`。

完整配对：[`examples/engine.worker.ts`](examples/engine.worker.ts)（Worker）+ [`examples/worker-host.ts`](examples/worker-host.ts)（主线程）。请**两份一起**复制。

Worker 模块：

```ts
import { attachEngineWorker, createOpfsStore } from "novel-engine/worker";
import type { LlmPort } from "novel-engine/worker";

const llm: LlmPort = {
  async complete() {
    // gateway / WebLLM / novel-engine/llm 走 BFF — 见场景 6
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

**何时：** 在 store 之间备份、转移或灌入书稿树（Memory ↔ OPFS，或自定义 `StorePort`）。

用 fflate 把 store 中每个路径打成浏览器可用的 zip。还原是 merge：快照里的路径会被覆盖；目标里多出来的文件会留下。清单 `.novel-engine-snapshot.json` 只存在于 zip 内——不会写入 store。

`MemoryStore` / `OpfsStore` 实现了 `list()`，因此自定义的额外文件也会打进包。没有 `list` 的自定义 `StorePort` 仍会导出已知的书籍布局（`meta/`、`chapters/` 等）。匹配 `.*.tmp` 的临时文件会被跳过。非法 zip / 缺失或未知清单 / 路径逃逸会抛 `SnapshotError`。

完整往返：[`examples/snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts)。

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
// dest 里有快照的 chapters/01.md；extra/host.json 会留下
// BOOK_SNAPSHOT_FORMAT === "novel-engine-book-snapshot"
// BOOK_SNAPSHOT_VERSION === 1
```

<a id="scenario-llm"></a>

### 6. 注入真实 LLM（`novel-engine/llm`）

**何时：** 受信任的 Node 宿主、Electron，或 **服务端 BFF** 需要真实 `LlmPort`。不要把原始 API Key 打进公开 SPA。

可选子路径。基于 fetch 的 OpenAI、Anthropic、DashScope（OpenAI 兼容的 `compatible-mode/v1`）适配器。无 `openai` / `@anthropic-ai/sdk` 包。DashScope 复用 OpenAI 形态的客户端，使用 DashScope 的 base URL + Bearer 密钥。

**安全：** 浏览器直连供应商会暴露密钥。生产（包括 Next.js 工作台）应把密钥放在 BFF，让 Worker 只访问该路由。

详情：[docs/llm-adapters.zh-CN.md](docs/llm-adapters.zh-CN.md)（[English](docs/llm-adapters.md)）。示意：[`examples/llm-openai.ts`](examples/llm-openai.ts)。

```ts
import { createEngine, MemoryStore } from "novel-engine";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";

const llm = createOpenAiLlm({
  apiKey: "sk-replace-me", // BFF / 受信任宿主环境变量 — 不要放进公开 SPA
  model: "gpt-4o-mini",
});
// createAnthropicLlm({ apiKey, model: "claude-sonnet-4-20250514" })
// createDashScopeLlm({ apiKey, model: "qwen-plus" })
// createVendorLlm({ provider: "dashscope", apiKey, model: "qwen-plus" })

const engine = createEngine({ store: new MemoryStore(), llm });
await engine.run({ prompt: "写一本三章短篇：……" });
```

<a id="scenario-session"></a>

### 7. 宿主 Session（`novel-engine/session`）

**何时：** 同线程宿主想检查一份 store 是否写得动，用结构化 LLM JSON 补齐基础设定，写作中途改设定（评估 → 确认 → 应用），单章写作或重写，或在多本书之间切换。

可选子路径。S0–S6：`getFoundation` / `inspectFoundation` / `upsertFoundation` / `generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` / `startAutoWrite` / `chapter.get` / `chapter.saveFinal` / `chapter.write` / 工作区 `createBook` / `switchTo`。中长篇只要有有效的 `layered_outline.json`，不再需要扁平 `outline.json`。`generateFoundation` 是 **`LlmPort.complete().text` 里的一次性 JSON**，不是 Engine 循环。`chapter.write` 是**专用作者循环**（复用 writer 工具；不是 `Engine.run` / 不是 `pendingRewrites`）。`assessFoundationImpact` **规则优先**且不写盘。`applyFoundationChange` 除非 `rewriteChapters: true`，否则绝不自动重写章节。`startAutoWrite`、`chapter.write` 与 `applyFoundationChange` 共用 busy 标志（`SessionBusyError`）。离主线程：见 [场景 8](#scenario-session-worker)。

详情：[docs/session.zh-CN.md](docs/session.zh-CN.md)（[English](docs/session.md)）。示意：[`examples/session-workspace.ts`](examples/session-workspace.ts)。

```ts
import { MemoryStore } from "novel-engine";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";

const store = new MemoryStore();
const session = await createNovelSession({ store, llm, bookId: "letter" });
```

<a id="scenario-session-gaps"></a>

#### 7.1 自动写作：检查缺口并提示补齐

保持 `requireConfirmGaps: true`（默认）。若有缺失，`startAutoWrite` 早退为 `needs_foundation`，**不会**跑 Engine——用 `gaps[].hint` 驱动 UI。

```ts
const outcome = await session.startAutoWrite({
  prompt: "写一本三章短篇：……",
  requireConfirmGaps: true, // 默认
});

if (outcome.status === "needs_foundation") {
  for (const gap of outcome.gaps) {
    // gap.key / gap.path / gap.hint — 如 book、premise、outline、characters…
  }
  return;
}
// outcome.status === "completed" | "stopped"

// 也可只检查、不写作：
const { gaps, readyToWrite } = await session.inspectFoundation({ prompt: "……" });
```

<a id="scenario-session-foundation"></a>

#### 7.2 自动写作前：自定义或 LLM 生成基础元信息

**自定义**（表单 / 宿主已有数据）→ `upsertFoundation`。**LLM 补齐** → `generateFoundation`（一次性 `complete().text` JSON；`mode: "fill_missing"` | `"overwrite"`）。也可一并塞进 `startAutoWrite`。

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

指纹文件变更会作废 `foundation_audit`。中长篇可用 `layeredOutline` 代替扁平 `outline`。写作中途随时可以 upsert/generate 基础设定；章节**不会**自动重写——先走 [7.2a–7.2e](#scenario-session-impact)，再动终稿。

<a id="scenario-session-impact"></a>

#### 7.2a–7.2e 中途改基础设定（先评估再应用）

宿主 UI 应**先评估拟议补丁**（`assessFoundationImpact(patch)`，对照当前 store），再决定是否 apply、是否确认改写，以及（另一步）是否同步章节。**不要**先 upsert——同一内容再评估一次会看起来像「没有变更」。启发式是确定性的（`meta_only` / `forward_only` / `rewrite_needed`）。可选 `refineWithLlm` 使用 `complete().text` 里的 JSON（测试用 `MockLlm`）。示意：[`examples/session-workspace.ts`](examples/session-workspace.ts)。Worker 上的同样调用见 [8.1](#scenario-session-worker-impact)。

**补丁形状：** 省略的键保持原样。一旦提供 `characters`、`worldRules`、`outline` 或 `layeredOutline` 数组，就是**整文件替换**——未出现的名字/章节会被删除，不是合并，也不是就地改名。`{ characters: [{ name: "林深" }] }` 会去掉林守。提供 `book` / `premise` 时同样整份替换对应产物。

| 任务 | 常见严重度 | 会改写章节吗？ |
| --- | --- | --- |
| [7.2a 只评估](#scenario-session-impact-assess) | 任意 | **不会** — 评估不写盘 |
| [7.2b 仅元信息 apply](#scenario-session-impact-meta) | `meta_only` | 否（`suggestedMode: "none"`） |
| [7.2c 只影响后续 apply](#scenario-session-impact-forward) | `forward_only` | 否（尚未写下的后续章） |
| [7.2d 确认闸门](#scenario-session-impact-confirm) | `rewrite_needed` | 确认前否；确认后仍否，除非走 [7.2e](#scenario-session-impact-batch) |
| [7.2e 批量同步章节](#scenario-session-impact-batch) | `rewrite_needed` | 仅当 `rewriteChapters: true` |

<a id="scenario-session-impact-assess"></a>

#### 7.2a 只评估（不写盘）

对**拟议**补丁调用 `assessFoundationImpact(patch)`，且必须在 `applyFoundationChange` / `upsertFoundation` **之前**。读取 `severity` / `suggestedChapters` / `suggestedMode` / `reasons`，在宿主 UI 里做决定。该调用是纯评估：store 与章节终稿都不变。若该补丁已经写入，再评估一次通常会显示没有变更。

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

// 在 UI 里决定——此时不要 upsert，也不要改写章节：
if (assessment.severity === "rewrite_needed") {
  // 展示 assessment.reasons + suggestedChapters，等用户确认
} else {
  // meta_only / forward_only 无需改写确认即可 apply
}
```

这里的 `llm` 可选。只有需要 MockLlm/BFF JSON 精炼时才传 `{ refineWithLlm: true }`；启发式仍然给出严重度下限。

<a id="scenario-session-impact-meta"></a>

#### 7.2b 仅元信息 apply（标题 / 标签 / 简介）

对 `meta/book.json` 的标题或简介类修改，评估为 `meta_only`。应用补丁，**不要**改写章节。

```ts
const patch = {
  book: { title: "无主的信（修订）", synopsis: "灯塔与潮的简介改写，不改情节。" },
};

const assessment = await session.assessFoundationImpact(patch);
// assessment.severity === "meta_only"
// assessment.suggestedMode === "none"
// assessment.suggestedChapters === []

const outcome = await session.applyFoundationChange({
  patch,
  rewriteChapters: false, // 默认；标题/标签不得改写章节
});
// outcome.status === "applied"
// 已写章节终稿不变；foundation.book.title 已是新标题
```

`meta_only` 不需要 `confirmRewrite`。这里即使传 `rewriteChapters: true` 也不会写章，除非再传 `mode: "rewrite" | "polish"`——因为 `suggestedMode` 是 `"none"`。

<a id="scenario-session-impact-forward"></a>

#### 7.2c 只影响后续（未来大纲 / 新角色）

主要落在**未写**后续章的变更，评估为 `forward_only`。已写终稿不动；`suggestedMode` 为 `none`。只 apply 设定——不 rewrite，也不 polish。

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
// assessment.severity === "forward_only"
// assessment.suggestedChapters === []
// assessment.suggestedMode === "none"

const outcome = await session.applyFoundationChange({
  patch,
  rewriteChapters: false, // 未写的章没有可改写的终稿
});
// outcome.status === "applied" — 大纲/角色已更新；chapters/01.md 不变
```

已写章节的大纲行请保持原样，启发式才会停在 `forward_only`。改**已写**章的情节属于 [7.2d](#scenario-session-impact-confirm)。与 [7.2b](#scenario-session-impact-meta) 相同：`suggestedMode === "none"` 时，除非宿主再传 `mode`，否则 `rewriteChapters: true` 也不会写章。

<a id="scenario-session-impact-confirm"></a>

#### 7.2d 需要改写 + 确认闸门

角色 / 世界 / 已写情节与终稿矛盾时，评估为 `rewrite_needed`。默认闸门下，未传 `confirmRewrite: true` 时 `applyFoundationChange` **不写盘**。UI 确认后再用同一补丁重试。

```ts
const patch = {
  premise: "林深从未离开灯塔。",
  // 整表替换：characters.json 里的林守会被删掉
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
};

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  // outcome.assessment.severity === "rewrite_needed"
  // outcome.assessment.suggestedChapters — 如 [1, 2]
  // outcome.assessment.suggestedMode === "rewrite"
  // 用 outcome.assessment.reasons 提示 UI — store 仍未改
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,    // 宿主已确认影响范围
    rewriteChapters: false,  // 仍然不会自动改写章节（见 7.2e）
  });
}
// outcome.status === "applied"
// 设定已更新；章节终稿仍是改设定前的文本
```

关掉闸门（`requireConfirmRewrite: false`）只适合测试/工具——工作台 UI 应保持默认，并展示 `needs_confirm`。

<a id="scenario-session-impact-batch"></a>

#### 7.2e 批量同步章节（`rewriteChapters: true`）

确认之后，章节**仍然**不会改写，除非宿主在**已确认的重试**上显式传入 `rewriteChapters: true`。Session 随后按 `suggestedChapters` 顺序调用 `chapter.write`（`rewrite` 或 `polish`）。需要 `llm`（MockLlm 的 `toolCalls`，与 [7.3](#scenario-session-chapter) 相同）。`rewriteChapters: true` 且 `suggestedMode === "none"`（常见于 `meta_only` / `forward_only`）时不会写章，除非宿主再传 `mode: "rewrite" | "polish"`。

```ts
import { MemoryStore, MockLlm } from "novel-engine";

const llm = new MockLlm([
  // 每个建议章一轮作者循环（toolCalls，不是 Engine.run）
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
// outcome.status === "applied"
// outcome.writes.map((row) => row.chapter)  // 顺序即 suggestedChapters
// outcome.writes.every((row) => row.mode === "rewrite")
```

省略 `rewriteChapters`（或传 `false`）则只更新设定。不走 `pendingRewrites`。

<a id="scenario-session-chapter"></a>

#### 7.3 单章创建 / 续写 / 改写 / 打磨

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

// 宿主手写终稿、不调 LLM：
await session.chapter.saveFinal(1, "# 风暴之后\n\n……");
```

<a id="scenario-session-read"></a>

#### 7.4 获取最新的基础元信息

Session **不缓存**产物——每次都是 store 直读。

```ts
const foundation = await session.getFoundation();
// { book, premise, outline, layeredOutline, characters, worldRules, audit, progress }
// 缺文件对应字段为 null

const progress = await session.getProgress();
session.subscribe((event) => {
  // foundation_updated | auto_write_step | chapter_step | stopped
});
```

`upsertFoundation` / `generateFoundation` 的返回值也是最新的 `FoundationMeta`。

<a id="scenario-session-toc"></a>

#### 7.5 获取目录结构与对应章节

没有单独的「目录 API」：大纲在 `getFoundation()`，正文按章号用 `chapter.get(n)`。辅助函数从 `novel-engine` 导入。

**目录 / 大纲**

```ts
import { flattenOutline, latestCompleted, nextChapter } from "novel-engine";

const { outline, layeredOutline, progress } = await session.getFoundation();

// 短篇：扁平大纲 [{ chapter, title, summary? }, ...]
outline;

// 中长篇：卷/弧分层大纲；可展平成章列表
layeredOutline;
const flat = layeredOutline ? flattenOutline(layeredOutline) : (outline ?? []);

// 已落盘的终稿路径（如 chapters/01.md）
const finals = await session.listArtifacts("chapters/");
```

**按章号读取对应章节**

```ts
const view = await session.chapter.get(1);
if (view == null) {
  // 该章尚无 plan / draft / final / summary
} else {
  view.chapter; // 1
  view.plan;    // 章节计划，或 null
  view.draft;   // 草稿 markdown，或 null
  view.final;   // 终稿 markdown，或 null
  view.summary; // 摘要，或 null
}
```

章节号从 **1** 起。四个字段都没有时返回 `null`；有任一产物就返回 `ChapterView`。

**最新已完成章 / 下一章**

```ts
const progress = await session.getProgress();
if (progress == null) {
  // 还没有 meta/progress.json
} else {
  const n = latestCompleted(progress); // 已完成章号最大值；没有则为 0
  const latest = n > 0 ? await session.chapter.get(n) : null;
  const next = nextChapter(progress);  // n + 1

  // 正在写、可能只有草稿：
  const current = progress.currentChapter;
  const inProgress = current ? await session.chapter.get(current) : null;
}
```

<a id="scenario-session-workspace"></a>

#### 7.6 小说切换与上下文状态恢复

`createNovelWorkspace`：一书一个 `StorePort`。状态在 store 里（设定、进度、章节），不在 session 对象内存里。`switchTo` / `open` 会 **关闭** 上一份 session——旧引用必须丢弃（再调会 `SessionClosedError`）。

```ts
const stores = new Map<string, MemoryStore>();
const ws = createNovelWorkspace({
  createStore(bookId) {
    // 必须缓存：同一 bookId → 同一持久化 store（Memory / OPFS / 自实现）
    const existing = stores.get(bookId);
    if (existing) return existing;
    const next = new MemoryStore();
    stores.set(bookId, next);
    return next;
  },
  // indexStore: 可选 — 持久化 _index.json（书目 + currentBookId）
  llm,
});

await ws.createBook({ bookId: "a", title: "无主的信" });
await ws.createBook({ bookId: "b", title: "两弧灯塔" });

const sessionA = await ws.switchTo("a"); // 关闭上一份 session
const restored = await sessionA.getFoundation(); // 从该书 store 读回
await sessionA.chapter.get(1);
await sessionA.getProgress();
```

有 `indexStore` 时冷启动：`listBooks()` 可恢复书目，但**不会自动 open**——需再调 `open` / `switchTo`。浏览器持久化时把 `createStore` 接到 OPFS（或按 bookId 分子目录）。没有 Workspace-over-Worker——工作区留在 UI 线程；需要时每本书一个 session Worker（[场景 8](#scenario-session-worker)）。

<a id="scenario-session-worker"></a>

### 8. Worker 上的 Session（`createSessionClient`）

**何时：** 工作台 UI 不能被自动写作 / 章节操作 / 应用设定堵住，并且供应商 API Key 必须留在 BFF。

从 `novel-engine/session` 导入 `attachSessionWorker`（不要从 `novel-engine/worker`）。Worker 持有同线程 `NovelSession` + OPFS store；主线程用 `createSessionClient`。`LlmPort.complete` 应 `fetch("/api/llm")`——**不要把 API Key 放进 Worker 包**。`generateFoundation`、`assessFoundationImpact`、`applyFoundationChange` 都在 Worker 里跑，因为 store 在那边。

详情：[docs/session.zh-CN.md](docs/session.zh-CN.md#s4--worker-桥)。配对：[`examples/session.worker.ts`](examples/session.worker.ts) + [`examples/session-host.ts`](examples/session-host.ts)。

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

与 [7.2a–7.2e](#scenario-session-impact) 相同：client 仍是 `NovelSession`。增量协议命令（`SESSION_PROTOCOL === 1`）：`assessFoundationImpact` / `applyFoundationChange`。确认闸门与 `rewriteChapters` 默认 **false** 在 Worker 里执行。`rewrite_needed` 请用两步 apply——**不要**先带 `confirmRewrite: true` 再指望看到 `needs_confirm`。

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
```

稳定面（领域类型、Worker 协议、快照常量）见 [docs/api.zh-CN.md](docs/api.zh-CN.md)。Session 见 [docs/session.zh-CN.md](docs/session.zh-CN.md)。

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

测试**只用 mock 夹具**——无网络、无在线供应商、无真实 OPFS。供应商适配器测试会 mock `fetch`。

手写 JSON 夹具在 `fixtures/`：

- `phase-transitions.json` / `flow-transitions.json` — 校验器黄金表
- `route-cases.json` — Route 黄金用例
- `short-book.json` — 三章非分层 mock 书
- `layered-book.json` — 1 卷 / 2 弧 mock 中篇
- `book-snapshot.json` — MemoryStore 快照往返树

## 许可证

Apache-2.0
