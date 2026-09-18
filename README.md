# novel-engine

[English](README.md) | [中文文档](README.zh-CN.md)

**[Guide](docs/guide.md)** · **[API](docs/api.md)** · **[Architecture](docs/architecture.md)** · [中文](README.zh-CN.md)

Reusable **TypeScript** Novel Engine SDK for hosts that generate novels in the browser (or Node tests). Pure ESM, no UI, no React bindings, no TUI.

**Default public path:** optional **`novel-engine/kit`**. Only `NovelKit.create` (no `new` + `init`). Defaults **OPFS + Worker**. The package **ships** `dist/novel-kit.worker.js`. Session (`novel-engine/session`) is the reference implementation Kit wraps. Engine (`createEngine`) is the loop behind `startBook`.

The default `novel-engine` / `novel-engine/worker` entries never talk to a real model. `src/` never uses `node:fs` / `node:path`. Worker `LlmPort.complete` is `fetch(llmEndpoint)` — put vendor keys on a BFF, not in the worker.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli).

This README is the host landing: **usage scenarios** (install → write → change meta → chapters → export) plus a **full Kit API catalog**. Deep audited flows stay in the [guide](docs/guide.md) (7.2a–e). Contracts: [api](docs/api.md). Internals: [architecture](docs/architecture.md). Index: [docs/README.md](docs/README.md).

---

<a id="usage-scenarios"></a>

## 1. Usage scenarios

Each section is a job a host actually runs. Snippets use **`NovelKit`**. Session / Engine appear only where Kit cannot (scripted Engine mocks, host-owned workers). Copy a runnable file from [`examples/`](examples/) when you need the full mock LLM. `examples/` is documentation — not part of `npm test`. In-repo scenario walks: [`npm run test:smoke`](docs/smoke.md) (MockLlm) and `npm run test:browser` (shipped worker).

Audited mid-story confirm-gate flows (assess only, meta-only, forward-only, rewrite confirm, batch chapter sync): [guide §7.2a–e](docs/guide.md#scenario-session-impact). Session names there map 1:1 onto Kit (`assessFoundationImpact` → `assessFoundation`, `applyFoundationChange` → `applyFoundation`).

<a id="install"></a>

### Install

**Copy into the host (recommended):** vendor this package root (`package.json`, `src/`, `tsup.config.ts`, `tsconfig.json`, `LICENSE`) under the app (`vendor/novel-engine/`, `packages/novel-engine/`, …). Do **not** copy `node_modules/` or a stale `dist/`. Rebuild, then import with **relative `dist/` paths** (or `"novel-engine": "file:./vendor/novel-engine"` to keep the package name).

```bash
cd vendor/novel-engine
npm install                # fflate + tsup
npm run build              # writes dist/ (required for dist imports)
```

```ts
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
import { MockLlm } from "../../vendor/novel-engine/dist/index.js";
```

Registry (other option):

```bash
npm install novel-engine
```

```ts
import { NovelKit } from "novel-engine/kit";
```

Published npm `files`: `dist/`, `README.md`, `LICENSE` (this English README only — the Chinese README and `docs/` ship in git / vendored copies, not the registry tarball). Node `>=18.17`. Details: [guide — Install](docs/guide.md#install).

<a id="init"></a>
<a id="wire-the-llm"></a>

### Initialize

**Create only** (`NovelKit.create`). Defaults **OPFS + Worker**. Omit `bookId` → `"default"`. There is **no** `new NovelKit()` / `init()`.

Wire the LLM **only at create** — there is no API to swap `llm` or `llmEndpoint` mid-session (the worker endpoint is fixed in the init handshake).

**When the LLM is required / optional**

- **Browser default** (`runtime: "worker"`, OPFS): do **not** pass `llm`. Pass **`llmEndpoint`** (BFF URL; default `"/api/llm"`). Kit **ships** `dist/novel-kit.worker.js`; the worker `fetch`es that URL. Do **not** put API keys in the browser.
- **Main-thread / Node / tests** (`runtime: "main"`, usually `store: "memory"`): **`llm: LlmPort` is required**. Omitting it throws `KitLlmRequiredError`. `llmEndpoint` is unused.

**Conflicts:** Worker always uses `llmEndpoint` (passing `llm` as well still ignores it). Main always uses `llm` (`llmEndpoint` is unused). A custom `StorePort` and `opfs.root` / `opfs.storage` require `runtime: "main"`.

| Option | Default | Notes |
| --- | --- | --- |
| `store` | `"opfs"` | `"memory"` (Node/tests) or a `StorePort` (`runtime: "main"` only) |
| `runtime` | `"worker"` | `"main"` (Node/tests; **`llm` required**) |
| `llm` | — | **`LlmPort` instance.** Required on `"main"`. **Ignored** on `"worker"` |
| `llmEndpoint` | `"/api/llm"` | **Worker only** — BFF URL the shipped worker `fetch`es. Unused on `"main"`. Empty string throws |
| `bookId` | `"default"` | any non-empty string |
| `workspace` | `true` | `false` — `createBook` / `switchBook` / `listBooks` throw |
| `fallbackToMemory` | `true` | `false` throws `OpfsUnavailableError` if OPFS is missing |

**Browser default (Worker + OPFS)** — pass `llmEndpoint`. The worker `POST`s `LlmCompletionRequest` JSON to that URL and expects `{ text: string, toolCalls? }`. Put vendor keys on the BFF (call `createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm` there): [guide §6](docs/guide.md#scenario-llm).

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  llmEndpoint: "/api/llm", // worker fetch — no API keys in the worker
  // bookId omitted → "default"
});

console.log(kit.runtime, kit.storeKind, kit.bookId); // "worker", "opfs"|"memory", "default"
```

**Main-thread / Node / tests** — pass an `llm: LlmPort`. Construct one with `novel-engine/llm` adapters (`createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm`), a custom port, or `MockLlm`.

```ts
import { createOpenAiLlm } from "novel-engine/llm";
import { NovelKit } from "novel-engine/kit";

const llm = createOpenAiLlm({
  apiKey: "sk-replace-me", // trusted host / BFF env — never a public SPA
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

Sketch: [`examples/kit-host.ts`](examples/kit-host.ts) (worker `llmEndpoint` + main `MockLlm`). Adapter factories: [`examples/llm-openai.ts`](examples/llm-openai.ts) · [guide §6](docs/guide.md#scenario-llm). Worker URL / bundler 404: [Worker notes](#worker-notes). Full options: [API catalog](#novelkit-create).

<a id="short-book"></a>

### Write a short book

Kit path: **inspect → fill or generate foundation → `startBook`**. `startBook` wraps Session `startAutoWrite`, which runs **`createEngine(...).run`** when the gap table is empty (or you disable the gap gate). Prompt keywords: anything without `中篇` / `分层` / `长篇` is **short** (`architect_short`). Short books need a **flat** `outline` (not only `layeredOutline`).

```ts
const prompt = "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。";

const inspected = await kit.inspect({ prompt });
// inspected.planning.tier === "short"
// inspected.gaps — book / premise / outline / characters / world_rules / foundation_audit

await kit.fillFoundation({
  book: { title: "无主的信", synopsis: "灯塔与潮" }, // title + synopsis only (no tags field)
  premise: "林守在风暴后捡到一封没有寄信人的信。",
  outline: [
    { chapter: 1, title: "风暴之后", summary: "捡到信。" },
    { chapter: 2, title: "岸边的地址", summary: "找到空屋。" },
    { chapter: 3, title: "回信", summary: "把守夜写进回信。" },
  ],
  characters: [{ name: "林守", role: "主角" }],
  worldRules: [{ name: "信与潮", description: "涨潮来信，退潮回信。" }],
});
// or: await kit.generateFoundation({ prompt, keys: ["book", "premise", "outline", "characters", "world_rules"] });

let outcome = await kit.startBook({ prompt, generateMissing: true });
if (outcome.status === "needs_foundation" && outcome.auditOnly) {
  // leftover is only foundation_audit — host confirms, Engine then writes the audit.
  // Do not use requireConfirmGaps: false here: that also skips book/premise/outline gaps.
  outcome = await kit.startBook({ prompt, confirmAuditGap: true });
}
// outcome.status === "completed" | "stopped" | still "needs_foundation" if other gaps remain
```

`fillFoundation` is an upsert (no confirm gate). `startBook` with default `requireConfirmGaps: true` **will not** call `Engine.run` while any gap remains — including `foundation_audit` after a complete fill. `inspect().auditOnly` / `needs_foundation.auditOnly` tell the host the leftover is audit-only. `generateMissing` cannot close `foundation_audit`.

Scripted Engine mock through `phase=complete` (bypasses the Kit gap gate): [`examples/short-book.ts`](examples/short-book.ts) · [guide §1](docs/guide.md#scenario-short-book) · `npm run test:short`.

<a id="long-book"></a>

### Write a mid / long book

Same Kit methods. Planning tier is a **keyword stub** (`inferPlanningStub`): `长篇` → `long` / `architect_long`; `中篇` or `分层` → `mid` / `architect_long`; else short. Mid/long may supply **`layeredOutline`** instead of a flat `outline`. A valid non-empty layered outline satisfies the outline gap; short still requires flat `outline.json`.

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
          chapters: [], // skeleton arc — Engine expand_next_arc fills this
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

Layered Engine mock (volume/arc, arc-end review → `expand_next_arc`): [`examples/layered-book.ts`](examples/layered-book.ts) · [guide §2](docs/guide.md#scenario-layered-book) · `npm run test:layered`. Long runs: `pauseBook` / `resumeBook` / `steerBook(message)` forward to the Engine held during `startBook` (main and worker). Calling them when nothing is running returns `{ status: "idle" }` (no-op, not an exception). **Added (0.7.0):** `cancelBook()` / optional `signal` abort with `AbortedError`; `getRunState()` is a read-only snapshot.

<a id="change-meta"></a>

### Change foundation mid-story

**Assess a proposed patch, then apply.** Do not `fillFoundation` first — a second assess of the same content then looks like “no change.”

- `characters` / `worldRules` / `outline` / `layeredOutline` are **whole-file replace** (omitted names/chapters are deleted, not merged). `{ characters: [{ name: "林深" }] }` removes 林守.
- `rewrite_needed` is a **two-step confirm gate**: first `applyFoundation({ patch })` returns `{ status: "needs_confirm" }` with **no writes**. Retry with `confirmRewrite: true`. Passing `confirmRewrite: true` on the first call never yields `needs_confirm`.
- `rewriteChapters` default **false** — chapters never auto-rewrite. `rewriteChapters: true` with `suggestedMode === "none"` writes no chapters unless you also pass `mode: "rewrite" | "polish"`.

```ts
const patch = { characters: [{ name: "林深", role: "主角" }] }; // whole-file replace

const assessment = await kit.assessFoundation(patch);
// assessment.severity: "meta_only" | "forward_only" | "rewrite_needed"
// assessment.suggestedChapters / suggestedMode / reasons — store unchanged

let outcome = await kit.applyFoundation({ patch });
if (outcome.status === "needs_confirm") {
  // show outcome.assessment.reasons — store still unchanged
  outcome = await kit.applyFoundation({
    patch,
    confirmRewrite: true,   // host acknowledged the blast radius
    rewriteChapters: false, // still no auto chapter rewrite unless you opt in
  });
}
```

Title / synopsis only (`book: { title, synopsis }`) is typically `meta_only` and applies without confirm. Deep copy-paste (7.2a assess, 7.2b meta, 7.2c forward, 7.2d confirm, 7.2e batch sync): [guide §7.2a–e](docs/guide.md#scenario-session-impact). Session-shaped sketch: [`examples/session-workspace.ts`](examples/session-workspace.ts).

<a id="read-meta"></a>

### Read foundation / progress

Every read is **store read-through** (no Kit cache). Outline lives on `getMeta()`. `updateOutline({ outline? , layeredOutline? })` upserts those keys via `fillFoundation` (whole-file replace, **no** assess/confirm gate). Bodies on `getChapter(n)`.

```ts
const meta = await kit.getMeta();
// { book, premise, outline, layeredOutline, characters, worldRules, audit, progress }
// each field is null when the file is absent

const progress = await kit.getProgress(); // null until meta/progress.json exists
if (progress != null) {
  // progress.phase / completedChapters / currentChapter / layered / planningTier?
}

const inspected = await kit.inspect({ prompt: "写一本三章短篇" });
// { meta, gaps, readyToWrite, planning }

const files = await kit.listArtifacts();           // all logical paths
const chapters = await kit.listArtifacts("chapters/"); // e.g. chapters/01.md
```

**Null-check `getProgress()`** before `latestCompleted(progress)` / `nextChapter(progress)` (those helpers live on `novel-engine`, not Kit). Guide: [§7.4](docs/guide.md#scenario-session-read) · [§7.5](docs/guide.md#scenario-session-toc).

<a id="chapters"></a>

### Chapters (create / read / update / delete)

Kit maps to Session ChapterRunner: `getChapter` / `writeChapter` / `saveChapter` / `deleteChapter`. Chapter numbers start at **1**.

`deleteChapter(n, { syncOutline? })` removes `drafts/NN.plan.json`, `drafts/NN.draft.md`, `chapters/NN.md`, and `summaries/NN.json` (reviews are left in place). It drops `n` from `completedChapters` / `pendingRewrites`, clamps `currentChapter` if it pointed at `n`, and if `phase === "complete"` after removing a completed chapter, sets phase back to `writing`. `totalChapters` is unchanged. `syncOutline: true` upserts flat `outline` and/or `layeredOutline` without that row (no renumbering; deleting the last remaining flat-outline row is unsupported because upsert forbids an empty array). Requires `StorePort.remove` (MemoryStore / OpfsStore). Shares the busy flag with `startBook` / `writeChapter` / `applyFoundation`.

| Intent | API | Notes |
| --- | --- | --- |
| Read | `getChapter(n)` | `{ chapter, plan, draft, final, summary }` or **`null`** if none exist |
| LLM write | `writeChapter({ chapter, mode, instruction?, title?, force? })` | Dedicated writer loop — **not** `Engine.run`, **not** `pendingRewrites` |
| Host markdown | `saveChapter(n, markdown)` | Writes the final, no LLM. Empty string throws |
| Delete | `deleteChapter(n, { syncOutline? })` | Artifacts above; optional TOC upsert. Busy |

`writeChapter` modes (`CHAPTER_WRITE_MODES`):

| `mode` | Precondition | Behavior |
| --- | --- | --- |
| `create` | No final (unless `force: true`) | plan → draft(write) → commit. Existing final → `ChapterConflictError` |
| `continue` | Draft present, **no** final | `draft_chapter(append)` then commit |
| `rewrite` | Final present | Overwrite plan/draft/commit. `instruction` is **optional** |
| `polish` | Final present | Lighter rewrite of the existing final |

```ts
const view = await kit.getChapter(1); // null if nothing is stored yet

await kit.writeChapter({
  chapter: 1,
  mode: "create", // "continue" | "rewrite" | "polish"
  title: "风暴之后",
  instruction: "灯塔视角",
  // force: true,  // create only: overwrite an existing final
});

await kit.saveChapter(1, "# 风暴之后\n\n……");
await kit.deleteChapter(1, { syncOutline: true });
```

`writeChapter` requires an `llm` (main) or a working `llmEndpoint` (worker). It shares the **busy** flag with `startBook` / `applyFoundation` (`SessionBusyError`). MockLlm for `writeChapter` must return **toolCalls** (`plan_chapter` / `draft_chapter` / `commit_chapter`); `generateFoundation` instead reads **JSON from `text`**. Guide: [§7.3](docs/guide.md#scenario-session-chapter).

<a id="export"></a>

### Export / import

```ts
const bytes = await kit.exportBook();     // Uint8Array zip of every store path + manifest
await kit.importBook(bytes);              // merge-restore; does not delete extra dest files
```

Format: `novel-engine-book-snapshot` v1. Temp `.*.tmp` files are skipped. Direct store helpers: `exportBookSnapshot` / `importBookSnapshot` from `novel-engine`. Sketch: [`examples/snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) · [guide §5](docs/guide.md#scenario-snapshot).

<a id="subscribe"></a>

### Subscribe and dispose

```ts
const off = kit.subscribe((event) => {
  // "foundation_updated" | "auto_write_step" | "chapter_step" | "stopped"
  // | "paused" | "resumed" | "steered"
  console.log(event.type);
});
off();           // unsubscribe
kit.dispose();   // close session + terminate kit worker; further calls throw KitClosedError
kit.dispose();   // idempotent
```

<a id="multi-book"></a>

### Multiple books

Default `workspace: true` with a **named** store (`"opfs"` or `"memory"`). `createBook` opens the new book (previous session is closed). Custom `StorePort` → `storeKind: "custom"` → multi-book methods throw `KitWorkspaceDisabledError`.

```ts
await kit.createBook({ bookId: "b", title: "第二本" }); // kit.bookId === "b"
await kit.switchBook("letter");
const catalog = await kit.listBooks(); // { bookId, createdAt, title? }[]
```

`workspace: false` disables these three methods. Session-level workspace (host-owned `createStore`): [guide §7.6](docs/guide.md#scenario-session-workspace) · [`examples/session-workspace.ts`](examples/session-workspace.ts).

<a id="worker-notes"></a>

### Worker notes

- **Kit worker ≠ Engine worker.** Kit uses shipped `novel-engine/kit/worker` (`dist/novel-kit.worker.js`). `novel-engine/worker` is `attachEngineWorker` for a host-owned Engine loop.
- Default URL: `new URL("./novel-kit.worker.js", import.meta.url)` relative to `dist/kit.js`. If a bundler rewrites `import.meta.url` so the worker 404s, copy that file to `public/` and pass `workerUrl: "/novel-kit.worker.js"`.
- Worker `LlmPort` is `fetch(llmEndpoint)` with the completion JSON. **`options.llm` is ignored** in worker mode.
- Custom `StorePort` and `opfs.root` / `opfs.storage` require `runtime: "main"`.
- Node / CI: `Worker` is missing → `KitWorkerError`. Use `runtime: "main"` + `store: "memory"`.
- Init handshake waits up to **15s** (`KitWorkerError` on timeout). Protocol: [architecture — Kit init](docs/architecture.md#kit-worker-init).
- Host-owned Session worker (not Kit): [guide §8](docs/guide.md#scenario-session-worker) · [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts). Host-owned Engine worker: [guide §4](docs/guide.md#scenario-worker).

Real LLM adapters (`novel-engine/llm`) belong on a **BFF**, not in a public SPA: [guide §6](docs/guide.md#scenario-llm) · [`examples/llm-openai.ts`](examples/llm-openai.ts).

---

<a id="api-catalog"></a>

## 2. API catalog (by surface)

<a id="package-entries"></a>

### Package entries

| Entry | Import | Role |
| --- | --- | --- |
| `.` | `novel-engine` | Engine, stores, client, mocks, snapshot, `route`, domain types |
| `./kit` | `novel-engine/kit` | Out-of-the-box `NovelKit.create` (defaults OPFS + Worker) |
| `./kit/worker` | `novel-engine/kit/worker` | Shipped kit worker (`dist/novel-kit.worker.js`) |
| `./session` | `novel-engine/session` | Same-thread Session + Worker session bridge (reference API) |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores for a **dedicated Engine** worker |
| `./llm` | `novel-engine/llm` | Optional fetch `LlmPort` adapters (OpenAI, Anthropic, DashScope) |

```ts
import { NovelKit, type FoundationPatch, type InspectResult } from "novel-engine/kit";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
import { createEngine, MockLlm, exportBookSnapshot } from "novel-engine";
import { attachEngineWorker } from "novel-engine/worker";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";
```

`./kit` re-exports commonly needed Session types (`FoundationPatch`, `FoundationMeta`, `InspectResult`, `AutoWriteResult`, `SessionEvent`, apply/assess/chapter types, …). Runtime Kit surface is still `NovelKit` + kit errors/protocol. Default `.` / `./worker` / `./llm` bundles do not pull in Kit or Session.

<a id="novelkit-create"></a>

### `NovelKit.create` + options + readonly fields

`NovelKit.create(options?: NovelKitOptions): Promise<NovelKit>` — **only** public constructor path.

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `runtime` | `"worker"` \| `"main"` | `"worker"` | `"main"` is same-thread (Node/tests) and **requires `llm`**. `"worker"` uses `llmEndpoint`, not `llm` |
| `store` | `"opfs"` \| `"memory"` \| `StorePort` | `"opfs"` | Custom `StorePort` → `runtime: "main"` only; `storeKind: "custom"` |
| `llm` | `LlmPort` | — | **Required** on `"main"` (`KitLlmRequiredError` if omitted). **Ignored** on `"worker"` even if passed. Init-time only (no mid-session swap). Construct with `createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm` from `novel-engine/llm`, or any `LlmPort` / `MockLlm`. How-to: [Initialize](#init) |
| `llmEndpoint` | `string` | `"/api/llm"` | **Worker only.** BFF URL; shipped `dist/novel-kit.worker.js` `POST`s completion JSON and expects `{ text, toolCalls? }`. Unused on `"main"`. Non-empty. Do **not** put API keys in the browser |
| `bookId` | `string` | `"default"` | Non-empty after trim |
| `workerUrl` | `string` \| `URL` | shipped worker | Override if the default URL 404s |
| `workspace` | `boolean` | `true` | `false` → multi-book methods throw |
| `fallbackToMemory` | `boolean` | `true` | `false` → throw if OPFS is missing |
| `opfs` | `{ directory?, root?, storage? }` | `directory: "novel-engine"` | `root` / `storage` require `"main"`. Per-book dir: `${directory}/${bookId}` |

Readonly on the instance:

| Field | Type | Meaning |
| --- | --- | --- |
| `runtime` | `"worker"` \| `"main"` | Where Session/Engine run |
| `bookId` | `string` | Current book (changes after `createBook` / `switchBook`) |
| `storeKind` | `"opfs"` \| `"memory"` \| `"custom"` | Persistence actually in use (OPFS may have fallen back to memory) |

Also exported from `./kit`: `defaultKitWorkerUrl()`, `attachKitWorker(port)`, `KIT_PROTOCOL` / `KIT_NS`, `KitLlmRequiredError`, `KitWorkerError`, `KitWorkspaceDisabledError`, `KitClosedError`.

<a id="novelkit-methods"></a>

### `NovelKit` methods

Names wrap Session 1:1 (no second copy of the rules). After `dispose()`, every method throws `KitClosedError`.

Busy flag (Session `SessionBusyError`): **`startBook`**, **`writeChapter`**, **`applyFoundation`**, **`deleteChapter`** are mutually exclusive. `pauseBook` / `resumeBook` / `steerBook` / **`cancelBook` / `getRunState`** do **not** take the busy flag (`pause`/`steer` only apply while `startBook`'s Engine is running). `inspect` / `fillFoundation` / `generateFoundation` / `assessFoundation` / `getChapter` / `saveChapter` / `updateOutline` / reads / export are **not** on that flag.

#### Inspect / ready

| Method | Returns | Notes |
| --- | --- | --- |
| `inspect({ prompt? })` | `InspectResult` | `{ meta, gaps, readyToWrite, planning, auditOnly }`. `prompt` (else run_meta / progress / layered outline) picks the planning tier for the gap table |
| `assertReady({ prompt? })` | `void` | Throws `FoundationIncompleteError` (`.gaps`) when not ready |

`readyToWrite` is true iff `foundationMissing` is empty. Mid/long with a valid `layered_outline.json` do **not** need flat `outline.json`. After book/premise/outline/characters/worldRules exist, the remaining gap is often **`foundation_audit`** (`auditOnly: true`) until phase is `writing` or `complete` (Engine writes the audit). Retry with `confirmAuditGap: true` — do not use `requireConfirmGaps: false` just to skip the audit.

#### Foundation write

| Method | Args | Returns | Notes |
| --- | --- | --- | --- |
| `fillFoundation(patch)` | `FoundationPatch` | `FoundationMeta` | Upsert. Omitted keys unchanged. Arrays **replace the whole file**. Invalidates `foundation_audit` when fingerprint files change. **No** assess / confirm |
| `generateFoundation({ prompt, keys, mode?, signal? })` | keys: `book` \| `premise` \| `outline` \| `layered_outline` \| `characters` \| `world_rules` | `FoundationMeta` | One-shot LLM **JSON in `text`** (not toolCalls). `mode`: `"fill_missing"` (default) or `"overwrite"`. Requires `llm` / worker endpoint. **Not** an Engine loop, **not** busy-locked. **Added:** optional `signal` |
| `startBook({ prompt, foundation?, generateMissing?, requireConfirmGaps?, confirmAuditGap?, maxSteps?, signal? })` | — | `AutoWriteResult` | Optional upsert/generate, then `{ status: "needs_foundation", gaps, meta, auditOnly }` **or** `Engine.run` → `{ status: "completed" \| "stopped", result, meta }`. Default `requireConfirmGaps: true`. `confirmAuditGap: true` proceeds only when leftover gaps are audit-only. Busy. **Added:** optional `signal`. **Compatible:** omit `signal` = 0.6.0 |
| `pauseBook()` / `resumeBook()` / `steerBook(message)` | — | `{ status: "ok" \| "idle" }` | Forwards to the Engine held during `startBook`. `idle` when nothing is running (no-op). Empty steer note throws `EngineError`. Not busy-locked |
| `cancelBook()` | — | `{ status: "ok" \| "idle" }` | **Added (0.7.0).** Abort in-flight start/generate/write. In-flight promise rejects `AbortedError`. Idle is a no-op. Not busy-locked |
| `getRunState()` | — | `"idle" \| "generating_missing" \| "running" \| "paused" \| "busy"` | **Added (0.7.0).** Pure observation. `running`/`paused` ↔ pause/steer would be `ok` |

`generateFoundation` keys are **snake_case** (`layered_outline`, `world_rules`); patch fields are **camelCase** (`layeredOutline`, `worldRules`). `BookMetadata` is `{ title, synopsis }` only.

#### Mid-story assess / apply

| Method | Args | Returns | Notes |
| --- | --- | --- | --- |
| `assessFoundation(patch, { refineWithLlm? })` | proposed `FoundationPatch` | `FoundationImpactAssessment` | **Must not mutate**. Assess **before** apply/fill. `refineWithLlm` cannot downgrade heuristic `severity` |
| `applyFoundation({ patch, confirmRewrite?, rewriteChapters?, requireConfirmRewrite?, refineWithLlm?, chapters?, mode?, instruction? })` | — | `{ status: "needs_confirm", assessment }` **or** `{ status: "applied", assessment, meta, writes }` | Re-assesses internally. Busy. `rewriteChapters` default **false** |

`FoundationImpactAssessment`: `severity` (`meta_only` \| `forward_only` \| `rewrite_needed`), `suggestedChapters`, `suggestedRanges`, `suggestedMode` (`none` \| `polish` \| `rewrite`), `reasons`, `notes`, `changedKeys`, `source` (`heuristics` \| `llm`).

Pitfalls: two-step apply for `rewrite_needed`; whole-file replace; `rewriteChapters: true` + `suggestedMode: "none"` is a no-op unless `mode` is passed; `confirmRewrite: true` never returns `needs_confirm`.

#### Chapters

| Method | Returns | Notes |
| --- | --- | --- |
| `getChapter(n)` | `ChapterView \| null` | `n` integer `> 0` |
| `writeChapter(input)` | `ChapterWriteResult` `{ chapter, mode, view, turns }` | Modes above. Busy. Needs LLM |
| `saveChapter(n, markdown)` | `void` | No LLM. Non-empty markdown required |
| `deleteChapter(n, { syncOutline? })` | `ChapterDeleteResult` | Removes plan/draft/final/summary. Busy. `syncOutline` upserts TOC without that row |
| `updateOutline({ outline?, layeredOutline? })` | `FoundationMeta` | Upsert via `fillFoundation` (no assess/confirm). At least one key required |

#### Reads / snapshot / workspace / events

| Method | Returns | Notes |
| --- | --- | --- |
| `getMeta()` | `FoundationMeta` | Alias of Session `getFoundation` |
| `getProgress()` | `Progress \| null` | **Null-check** before progress helpers |
| `listArtifacts(prefix?)` | `string[]` | Logical store paths |
| `exportBook()` | `Uint8Array` | Zip + manifest |
| `importBook(bytes)` | `void` | Merge; extra dest files remain |
| `createBook({ bookId?, title? })` | `{ bookId }` | Allocates an id when omitted. Switches to the new book. Needs workspace |
| `switchBook(bookId)` | `void` | Unknown id → `BookNotFoundError`. Previous session closed |
| `listBooks()` | `BookIndexEntry[]` | `{ bookId, createdAt, title? }` |
| `subscribe(listener)` | `() => void` | Unsubscribe function |
| `dispose()` | `void` | Close + `worker.terminate`. Idempotent |

Worker reconnect on `createBook` / `switchBook` tears down the previous kit worker and opens a new session for that `bookId`.

#### Errors you will see

From `novel-engine/kit`: `KitClosedError`, `KitLlmRequiredError`, `KitWorkerError`, `KitWorkspaceDisabledError`.

From Session (methods rethrow): `FoundationIncompleteError`, `SessionLlmRequiredError`, `FoundationGenerateError`, `SessionBusyError`, `ChapterConflictError`, `ChapterRunnerError`, `SessionClosedError`, `BookNotFoundError`, **`AbortedError`**, **`LlmError`**, **`StoreRemoveUnsupportedError`**.

<a id="lower-level"></a>

### Lower-level Session / Engine (pointer)

Use these when Kit defaults are wrong (custom `createStore`, scripted Engine loop, host-owned worker). This is **not** a second tutorial — contracts: [api — Session](docs/api.md#optional-host-session-novel-enginesession) · [api — Engine](docs/api.md#engine).

| Need | Import | Entry |
| --- | --- | --- |
| Same-thread session without Kit defaults | `createNovelSession({ store, llm?, bookId })` | `novel-engine/session` |
| Host-owned multi-book stores | `createNovelWorkspace({ createStore, llm?, indexStore? })` | `novel-engine/session` |
| Own session worker | `createSessionClient` / `attachSessionWorker` | `novel-engine/session` (not `./worker`) |
| Scripted book to `phase=complete` | `createEngine({ store, llm }).run({ prompt })` | `novel-engine` |
| Planning keyword stub | `inferPlanningStub(prompt)` | `novel-engine` |
| Engine off the UI thread | `createEngineClient` + `attachEngineWorker` | `.` + `novel-engine/worker` |
| Snapshot without Kit | `exportBookSnapshot` / `importBookSnapshot` | `novel-engine` |
| OPFS without Kit | `createOpfsStore` / `OpfsStore.open` | `novel-engine` |
| Vendor fetch LLM | `createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm` / `createVendorLlm` | `novel-engine/llm` |

Kit → Session names: `inspect` → `inspectFoundation`, `assertReady` → `assertReadyToWrite`, `fillFoundation` → `upsertFoundation`, `startBook` → `startAutoWrite`, `pauseBook`/`resumeBook`/`steerBook` → `pause`/`resume`/`steer`, `cancelBook` → `cancel`, `getRunState` → `getRunState`, `assessFoundation` → `assessFoundationImpact`, `applyFoundation` → `applyFoundationChange`, `getChapter`/`writeChapter`/`saveChapter`/`deleteChapter` → `chapter.get`/`write`/`saveFinal`/`delete`, `updateOutline` → `upsertFoundation` (outline keys), `getMeta` → `getFoundation`, `exportBook`/`importBook` → `exportSnapshot`/`importSnapshot`, `dispose` → `close` (+ terminate worker).

---

## What's not included

- Vendor LLM clients in default `novel-engine` / `novel-engine/worker` — inject `LlmPort`, or import [`novel-engine/llm`](docs/guide.md#scenario-llm) (**do not put API keys in a public browser app**)
- React package, Demo SPA, or any visual app
- Arbiter full semantic scenes (`plan_start` is a keyword stub)
- ChapterAdvanceGate review-mode UI
- Node filesystem adapters — implement `StorePort` outside this library if you need `fs`
- Mid-session LLM swap, `new NovelKit()`

## Develop / test

```bash
npm install
npm test
npm run test:short
npm run test:layered
npm run test:smoke
npm run typecheck
npm run build
npx playwright install --with-deps chromium   # once; CI does this too
npm run test:browser                          # needs dist/ from build
npx tsc -p tsconfig.examples.json
```

`npm test` is Node **vitest** (unit/contract + README scenario smoke). It does **not** launch a browser. Playwright worker smoke (`test:browser`) loads built `dist/kit.js` + shipped `dist/novel-kit.worker.js` against a local mock BFF — no vendor keys. Host Next.js / 《写作工作台》 E2E stays out of this repo: [smoke vs host E2E](docs/smoke.md).

Tests use **mock fixtures only** — no network, no live providers. Vendor adapter suites mock `fetch`. Browser smoke may use real OPFS in Chromium, or Kit's documented Memory fallback if OPFS is missing.

Hand-authored JSON fixtures live in `fixtures/`:

- `phase-transitions.json` / `flow-transitions.json` — validator golden tables
- `route-cases.json` — Route golden cases
- `short-book.json` — 3-chapter non-layered mock book
- `layered-book.json` — 1 volume / 2 arcs mock mid-book
- `book-snapshot.json` — MemoryStore snapshot round-trip tree

## License

Apache-2.0
