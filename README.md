# novel-engine

[English](README.md) | [中文文档](README.zh-CN.md)

Reusable **TypeScript** Novel Engine SDK for hosts that want to generate novels in the browser (or Node tests). Pure ESM, no UI, no React bindings, no TUI.

**0.4.0** adds Session **S5/S6** (`assessFoundationImpact` / `applyFoundationChange`) on the optional `novel-engine/session` entry, and keeps `novel-engine/llm` (fetch adapters for OpenAI, Anthropic, DashScope). Default bundles still ship no vendor clients and do not pull session.

The default `novel-engine` / `novel-engine/worker` entries never talk to a real model. `src/` never uses `node:fs` / `node:path`.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/host/engine.go`).

Stable exports: [docs/api.md](docs/api.md) ([中文 API](docs/api.zh-CN.md)). Session: [docs/session.md](docs/session.md).

**How do I use this?** Jump to [Usage by scenario](#usage-by-scenario) — [short book](#scenario-short-book) · [layered mid/long](#scenario-layered-book) · [OPFS persist](#scenario-opfs) · [Web Worker](#scenario-worker) · [book snapshot](#scenario-snapshot) · [real LLM adapters](#scenario-llm) · [host session](#scenario-session) ([gaps](#scenario-session-gaps) · [foundation](#scenario-session-foundation) · [foundation impact](#scenario-session-impact) ([assess only](#scenario-session-impact-assess) · [meta-only](#scenario-session-impact-meta) · [forward-only](#scenario-session-impact-forward) · [confirm gate](#scenario-session-impact-confirm) · [batch rewrite](#scenario-session-impact-batch)) · [chapter write](#scenario-session-chapter) · [read meta](#scenario-session-read) · [TOC & chapters](#scenario-session-toc) · [switch books](#scenario-session-workspace)) · [session over Worker](#scenario-session-worker) ([assess / apply](#scenario-session-worker-impact)). Runnable sources stay in [`examples/`](examples/).

## What's not included

- Vendor LLM clients in the default `novel-engine` / `novel-engine/worker` bundles — inject `LlmPort`, or import optional [`novel-engine/llm`](docs/llm-adapters.md) (fetch adapters; **do not put API keys in a public browser app**)
- Host session in the default bundles — import optional [`novel-engine/session`](docs/session.md) (S0–S6 inspect, generate, auto-write, ChapterRunner, foundation impact, Worker bridge, workspace)
- React package, Demo SPA, or any visual app
- Arbiter full semantic scenes (`plan_start` is a keyword stub)
- ChapterAdvanceGate review-mode UI
- Node filesystem adapters — implement `StorePort` outside this library if you need `fs`

## Ports & Adapters

```
┌─────────────────────────────────────────────┐
│  Host (browser main thread / Node / tests)  │
│   createEngineClient  →  postMessage        │
└──────────────────────┬──────────────────────┘
                       │ start / steer / pause / resume / snapshot
                       ▼
┌─────────────────────────────────────────────┐
│  Dedicated Worker (`novel-engine/worker`)   │
│  StorePort (OpfsStore | MemoryStore)        │
│  LlmPort  (host-injected)                   │
│  Engine.run → route(state) → Worker tools   │
└─────────────────────────────────────────────┘
```

- **`route` is a pure function.** Input is an explicit `State` snapshot. It performs no IO and does not call `StorePort` or `LlmPort`.
- **`StorePort`** loads that snapshot and persists artifacts. Hosts inject `MemoryStore`, `OpfsStore`, IndexedDB, or Node fs *outside* this library.
- **`LlmPort`** runs architect / writer / editor completions (optional structured `toolCalls`). Default entries ship `MockLlm` / `ReplayLlm` only. Optional fetch adapters: `novel-engine/llm`.

## Install

```bash
npm install novel-engine
```

Package exports:

| Entry | Import | Role |
| --- | --- | --- |
| `.` | `novel-engine` | Engine, stores, client, mocks, snapshot, `route` |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores for a dedicated worker |
| `./llm` | `novel-engine/llm` | Optional fetch `LlmPort` adapters (OpenAI, Anthropic, DashScope) |
| `./session` | `novel-engine/session` | Optional same-thread host session + Worker session bridge |

Published `files`: `dist/`, `README.md`, `LICENSE`.

## Usage by scenario

This section is the host how-to. Each row is a job you might actually run. Copy the snippet, then open the linked `examples/*.ts` for the full runnable file (handlers, merge rules, protocol). `examples/` is documentation — not part of `npm test`. Supported in-repo mock runs: `npm run test:short` and `npm run test:layered`.

Scenarios compose: the Worker example already calls `createOpfsStore()`; snapshot import/export works with any `StorePort`.

| Scenario | When to use | Canonical source |
| --- | --- | --- |
| [1. Short book to complete](#scenario-short-book) | Same-thread mock of a 3-chapter non-layered book through `phase=complete`. Default `plan_start` path (`architect_short` + `MemoryStore` + `MockLlm`). | [`examples/short-book.ts`](examples/short-book.ts) |
| [2. Layered mid / long book](#scenario-layered-book) | Volume/arc outline, arc-end review → summary → `expand_next_arc`, then `complete_book`. Prompt keywords pick `architect_long`. | [`examples/layered-book.ts`](examples/layered-book.ts) |
| [3. Persist in the browser (OPFS)](#scenario-opfs) | Keep artifacts across reloads with Origin Private File System; fall back to ephemeral `MemoryStore` when OPFS is missing. | [`examples/opfs-store.ts`](examples/opfs-store.ts) |
| [4. Embed in a Web Worker](#scenario-worker) | Dedicated worker + main-thread client: `start` / `steer` / `pause` / `resume` / `snapshot`. | [`engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) |
| [5. Book snapshot export / import](#scenario-snapshot) | Zip every store path (fflate) and merge-restore into another `StorePort`. | [`examples/snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) |
| [6. Inject a real LLM](#scenario-llm) | Host-side OpenAI / Anthropic / DashScope `LlmPort` via optional `novel-engine/llm`. Keys belong on a BFF. | [`examples/llm-openai.ts`](examples/llm-openai.ts) |
| [7. Host session (inspect + generate + ChapterRunner + impact + workspace)](#scenario-session) | Same-thread `NovelSession` / `NovelWorkspace`: [gap check](#scenario-session-gaps), [foundation upsert/generate](#scenario-session-foundation), [mid-story foundation change](#scenario-session-impact) ([assess only](#scenario-session-impact-assess) · [meta-only](#scenario-session-impact-meta) · [forward-only](#scenario-session-impact-forward) · [confirm gate](#scenario-session-impact-confirm) · [batch rewrite](#scenario-session-impact-batch)), [single-chapter write](#scenario-session-chapter), [read latest meta](#scenario-session-read), [TOC & chapters](#scenario-session-toc), [switch books / restore](#scenario-session-workspace). | [`examples/session-workspace.ts`](examples/session-workspace.ts) |
| [8. Session over Worker](#scenario-session-worker) | Workbench: `startAutoWrite` / `chapter.write` / `assessFoundationImpact` / `applyFoundationChange` off the UI thread. [Assess + apply over the bridge](#scenario-session-worker-impact). `createSessionClient` + `attachSessionWorker`. `LlmPort` fetches a BFF — no vendor keys in the worker. | [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts) |

`plan_start` is a **deterministic stub** (no Arbiter LLM): prompts containing `长篇` pick `architect_long` / `long`; `中篇` or `分层` pick `architect_long` / `mid`; otherwise `architect_short` / `short`. Worker failures retry once, then pause. Identical Route instructions five times also pause (deadlock cap).

Folder index (no extra how-to): [`examples/README.md`](examples/README.md) · [中文](examples/README.zh-CN.md).

<a id="scenario-short-book"></a>

### 1. Short book to complete

**When:** Node tests or a same-thread host. You want a scripted `LlmPort` to fill foundation, write three chapters, and stop at `complete`.

Wiring is `createEngine` + `MemoryStore` + `MockLlm.fromHandler`. Each `complete()` must return Worker `toolCalls`; `audit_foundation` must reuse the `fingerprint` from `novel_context`. `ReplayLlm` only replays a fixed `{ text, toolCalls? }[]` and does not inspect the request — a short list throws when exhausted.

Full handler (architect → writer → editor through `phase=complete`): [`examples/short-book.ts`](examples/short-book.ts) (`shortBookHandler`, `replayLlmSketch`, `runShortBook`). In-repo: `npm run test:short` + `fixtures/short-book.json`.

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
const llm = MockLlm.fromHandler(shortBookHandler); // copy from examples/short-book.ts
const engine = createEngine({ store, llm, maxSteps: 20 });
const result = await engine.run({ prompt });
// result.stoppedReason === "complete" | "idle" | "paused" | "max_steps"

// ReplayLlm does not read the request — the list must cover every complete():
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

### 2. Layered mid / long book

**When:** Mid or long books that need volume/arc structure instead of a flat outline.

Same injection as scenario 1 (`createEngine` + `MemoryStore` + `MockLlm`) — only the prompt keywords and tool names change.

`architect_long` tools: `save_foundation(type=layered_outline|append_volume|complete_book)`, `expand_next_arc`. Editor: `save_review` (arc/global), `save_arc_summary`, `save_volume_summary`. `novel_context` is a sliding window of chapter summaries plus arc/volume summaries when present (no four-stage compressor).

The layered fixture is one volume / two arcs. After two expanded chapters, Route hits arc-end: editor `save_review` → `save_arc_summary` → `expand_next_arc`. After the second arc it writes a volume summary, then `complete_book`.

Full handler: [`examples/layered-book.ts`](examples/layered-book.ts) (`layeredBookHandler`, `runLayeredBook`). In-repo: `npm run test:layered` + `fixtures/layered-book.json`.

```ts
import { createEngine, MemoryStore, MockLlm, inferPlanningStub } from "novel-engine";

const prompt =
  "写一本分层中篇：一座海上灯塔里住着守塔人林守。一卷两弧，先写接灯，再写离岸归来。";
const planning = inferPlanningStub(prompt);
// planning.tier === "mid", planning.planner === "architect_long"
// Prompt with 长篇 → { tier: "long", planner: "architect_long" }

const engine = createEngine({
  store: new MemoryStore(),
  llm: MockLlm.fromHandler(layeredBookHandler), // copy from examples/layered-book.ts
  maxSteps: 40,
});
const result = await engine.run({ prompt });
```

<a id="scenario-opfs"></a>

### 3. Persist in the browser (OPFS)

**When:** A browser host must keep artifacts across reloads. Node, insecure contexts, and older browsers have no OPFS.

`isOpfsAvailable()` is a capability check (`navigator.storage.getDirectory`, or an injected fake in tests).

`createOpfsStore()` opens `OpfsStore` when OPFS exists; **otherwise it returns `MemoryStore`**. Memory is ephemeral — reload loses artifacts. Hosts that must persist should check the capability (or call `OpfsStore.open()`, which throws `OpfsUnavailableError`), or pass `{ fallbackToMemory: false }`.

Writes use a sibling temp file then `move` (or copy-then-unlink) so a crash mid-write does not truncate the previous artifact.

This library never uses `node:fs` / `node:path`. Implement `StorePort` outside the package if you need a Node filesystem adapter.

Full setup (`openStoreWithFallback`, `openPersistedStore`, `openOrThrow`): [`examples/opfs-store.ts`](examples/opfs-store.ts).

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
    // Node, insecure context, or older browser.
    return new MemoryStore();
  }
  return createOpfsStore(); // OpfsStore | MemoryStore
}

export async function openPersistedStore(): Promise<OpfsStore> {
  try {
    return await OpfsStore.open(); // subdirectory "novel-engine"
  } catch (err) {
    if (err instanceof OpfsUnavailableError) throw err; // OPFS missing
    throw err;
  }
}

export async function openOrThrow(): Promise<StorePort> {
  return createOpfsStore({ fallbackToMemory: false });
}
```

<a id="scenario-worker"></a>

### 4. Embed in a Web Worker

**When:** The Engine loop should not block the UI thread. Pair a dedicated worker module with a main-thread client.

The worker bundle is a **separate entry** so bundlers can tree-shake the main-thread client out of the worker (and vice versa). Host-owned worker file: inject your `LlmPort` there. Default entries do not ship a provider client; optional fetch adapters are `novel-engine/llm` (prefer a BFF in production — see scenario 6). `MockLlm.fromHandler` also works inside the worker — see scenario 1.

`pause` / `steer` take effect **after the current Worker instruction**, not mid-tool. `steer` records a decision and sets `flow=steering` so `route` returns null until `resume()` restores the previous flow.

Protocol (`ENGINE_PROTOCOL === 1`): main → worker `start` / `steer` / `pause` / `resume` / `snapshot`; worker → main `event` / `snapshot` / `error`. Event kinds: `started` | `step` | `paused` | `resumed` | `steered` | `stopped`.

Full pair: [`examples/engine.worker.ts`](examples/engine.worker.ts) (worker) + [`examples/worker-host.ts`](examples/worker-host.ts) (main). Copy **both**.

Worker module:

```ts
import { attachEngineWorker, createOpfsStore } from "novel-engine/worker";
import type { LlmPort } from "novel-engine/worker";

const llm: LlmPort = {
  async complete() {
    // gateway / WebLLM / novel-engine/llm behind a BFF — see scenario 6
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

Main thread:

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

### 5. Book snapshot export / import

**When:** Backup, transfer, or hydrate a book tree between stores (Memory ↔ OPFS, or a custom `StorePort`).

Browser-safe zip of every store path (fflate). Restore is a merge: snapshot paths are overwritten; extra files already in the destination stay. Manifest `.novel-engine-snapshot.json` lives inside the zip only — it is not written to the store.

`MemoryStore` / `OpfsStore` implement `list()`, so custom extra files are included. Custom `StorePort` adapters without `list` still export the known book layout (`meta/`, `chapters/`, …). Temp files matching `.*.tmp` are skipped. Invalid zip / missing or unknown manifest / path escape throws `SnapshotError`.

Full round-trip: [`examples/snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts).

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

const bytes = await exportBookSnapshot(source); // Uint8Array zip (PK magic)

const dest = new MemoryStore({ "extra/host.json": "{\"ok\":true}" });
try {
  await importBookSnapshot(dest, bytes); // merge
} catch (err) {
  if (err instanceof SnapshotError) throw err;
  throw err;
}
// dest has chapters/01.md from the snapshot; extra/host.json is kept
// BOOK_SNAPSHOT_FORMAT === "novel-engine-book-snapshot"
// BOOK_SNAPSHOT_VERSION === 1
```

<a id="scenario-llm"></a>

### 6. Inject a real LLM (`novel-engine/llm`)

**When:** A trusted Node host, Electron, or a **server BFF** needs a real `LlmPort`. Not for shipping raw API keys in a public SPA.

Optional subpath. Fetch-based OpenAI, Anthropic, and DashScope (OpenAI-compatible `compatible-mode/v1`) adapters. No `openai` / `@anthropic-ai/sdk` packages. DashScope reuses the OpenAI-shaped client with a DashScope base URL + Bearer key.

**Security:** browsers that call vendors directly expose the key. Production (including a Next.js workbench) should keep keys on a BFF and have the worker call that route.

Details: [docs/llm-adapters.md](docs/llm-adapters.md) ([中文](docs/llm-adapters.zh-CN.md)). Sketch: [`examples/llm-openai.ts`](examples/llm-openai.ts).

```ts
import { createEngine, MemoryStore } from "novel-engine";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";

const llm = createOpenAiLlm({
  apiKey: "sk-replace-me", // BFF / trusted host env — never a public SPA
  model: "gpt-4o-mini",
});
// createAnthropicLlm({ apiKey, model: "claude-sonnet-4-20250514" })
// createDashScopeLlm({ apiKey, model: "qwen-plus" })
// createVendorLlm({ provider: "dashscope", apiKey, model: "qwen-plus" })

const engine = createEngine({ store: new MemoryStore(), llm });
await engine.run({ prompt: "写一本三章短篇：……" });
```

<a id="scenario-session"></a>

### 7. Host session (`novel-engine/session`)

**When:** A same-thread host wants to inspect whether a store is ready to write, fill foundation via a structured LLM JSON call, change foundation mid-story (assess → confirm → apply), write or rewrite a single chapter, or switch among several books.

Optional subpath. S0–S6: `getFoundation` / `inspectFoundation` / `upsertFoundation` / `generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` / `startAutoWrite` / `chapter.get` / `chapter.saveFinal` / `chapter.write` / workspace `createBook` / `switchTo`. Mid/long books with a valid `layered_outline.json` no longer need a flat `outline.json`. `generateFoundation` is **one-shot JSON in `LlmPort.complete().text`**, not an Engine loop. `chapter.write` is a **dedicated writer loop** (reuses writer tools; not `Engine.run` / not `pendingRewrites`). `assessFoundationImpact` is **rules-first** and does not mutate. `applyFoundationChange` never auto-rewrites chapters unless `rewriteChapters: true`. `startAutoWrite`, `chapter.write`, and `applyFoundationChange` share a busy flag (`SessionBusyError`). Worker off-thread: [scenario 8](#scenario-session-worker).

Details: [docs/session.md](docs/session.md) ([中文](docs/session.zh-CN.md)). Sketch: [`examples/session-workspace.ts`](examples/session-workspace.ts).

```ts
import { MemoryStore } from "novel-engine";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";

const store = new MemoryStore();
const session = await createNovelSession({ store, llm, bookId: "letter" });
```

<a id="scenario-session-gaps"></a>

#### 7.1 Auto-write: inspect gaps and prompt to fill

Keep `requireConfirmGaps: true` (default). If anything is missing, `startAutoWrite` returns early with `needs_foundation` and does **not** run the Engine — use `gaps[].hint` in the UI.

```ts
const outcome = await session.startAutoWrite({
  prompt: "写一本三章短篇：……",
  requireConfirmGaps: true, // default
});

if (outcome.status === "needs_foundation") {
  for (const gap of outcome.gaps) {
    // gap.key / gap.path / gap.hint — e.g. book, premise, outline, characters…
  }
  return;
}
// outcome.status === "completed" | "stopped"

// Or inspect without writing:
const { gaps, readyToWrite } = await session.inspectFoundation({ prompt: "……" });
```

<a id="scenario-session-foundation"></a>

#### 7.2 Custom or LLM-generated foundation before auto-write

**Custom** (form / host data) → `upsertFoundation`. **LLM fill** → `generateFoundation` (one-shot JSON in `complete().text`; `mode: "fill_missing"` | `"overwrite"`). Or fold both into `startAutoWrite`.

```ts
await session.upsertFoundation({
  book: { title: "无主的信", synopsis: "……" },
  premise: "……",
  outline: [{ chapter: 1, title: "风暴之后", summary: "……" }], // whole-file replace
  characters: [{ name: "林守" }], // whole-file replace; omitted names are deleted
  worldRules: [{ name: "信与潮", description: "……" }], // whole-file replace
});

await session.generateFoundation({
  prompt: "写一本三章短篇：……",
  keys: ["outline", "characters", "world_rules"], // also: book | premise | layered_outline
  mode: "fill_missing", // default; use "overwrite" to replace
});

await session.startAutoWrite({
  prompt: "……",
  foundation: { book: { title: "无主的信", synopsis: "……" } }, // upsert first
  generateMissing: true, // then generate remaining gaps
  requireConfirmGaps: true, // still return needs_foundation if anything left
});
```

Fingerprint file changes invalidate `foundation_audit`. Mid/long can supply `layeredOutline` instead of flat `outline`. Mid-story foundation upsert/generate is allowed anytime; chapters do **not** auto-rewrite — walk [7.2a–7.2e](#scenario-session-impact) before touching finals.

<a id="scenario-session-impact"></a>

#### 7.2a–7.2e Mid-story foundation change (assess → apply)

The host UI should **assess a proposed patch first** (`assessFoundationImpact(patch)` vs the current store), then decide whether to apply, confirm a rewrite, and (separately) opt in to chapter sync. Do **not** upsert first — a second assess of the same content then looks like “no change.” Heuristics are deterministic (`meta_only` / `forward_only` / `rewrite_needed`). Optional `refineWithLlm` uses JSON in `complete().text` (`MockLlm` in tests). Sketch: [`examples/session-workspace.ts`](examples/session-workspace.ts). Same calls over a Worker: [8.1](#scenario-session-worker-impact).

**Patch shape:** omitted keys are left unchanged. A provided `characters`, `worldRules`, `outline`, or `layeredOutline` array **replaces the whole file** — omitted names/chapters are deleted, not merged or renamed in place. `{ characters: [{ name: "林深" }] }` removes 林守. `book` / `premise` likewise replace those artifacts when present.

| Job | Severity you typically see | Writes chapters? |
| --- | --- | --- |
| [7.2a Assess only](#scenario-session-impact-assess) | any | **Never** — assess does not mutate |
| [7.2b Meta-only apply](#scenario-session-impact-meta) | `meta_only` | No (`suggestedMode: "none"`) |
| [7.2c Forward-only apply](#scenario-session-impact-forward) | `forward_only` | No (unwritten future chapters) |
| [7.2d Confirm gate](#scenario-session-impact-confirm) | `rewrite_needed` | No until the host confirms, and still no unless [7.2e](#scenario-session-impact-batch) |
| [7.2e Batch chapter sync](#scenario-session-impact-batch) | `rewrite_needed` | Only if `rewriteChapters: true` |

<a id="scenario-session-impact-assess"></a>

#### 7.2a Assess only (no write)

Call `assessFoundationImpact(patch)` on a **proposed** patch **before** `applyFoundationChange` / `upsertFoundation`. Read `severity` / `suggestedChapters` / `suggestedMode` / `reasons` and decide in the host UI. This call is pure: the store and chapter finals stay unchanged. If that patch was already written, a second assess typically reports no change.

```ts
const patch = {
  // whole-file replace: 林守 is deleted, not renamed in place
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
};

const assessment = await session.assessFoundationImpact(patch);
assessment.severity;          // "meta_only" | "forward_only" | "rewrite_needed"
assessment.suggestedChapters; // e.g. [] or [1, 2]
assessment.suggestedMode;     // "none" | "polish" | "rewrite"
assessment.reasons;           // bilingual strings for the host UI
assessment.notes;
assessment.changedKeys;       // e.g. ["characters"]

// Decide in the UI — do not upsert or rewrite yet:
if (assessment.severity === "rewrite_needed") {
  // show assessment.reasons + suggestedChapters; wait for the user
} else {
  // meta_only / forward_only can apply without a rewrite confirm
}
```

`llm` is optional here. Pass `{ refineWithLlm: true }` only when you want a MockLlm/BFF JSON refine; heuristics still set a severity floor.

<a id="scenario-session-impact-meta"></a>

#### 7.2b Meta-only apply (title / tags / synopsis)

A `meta/book.json` title or synopsis-style edit assesses as `meta_only`. Apply the patch; **do not** rewrite chapters.

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
  rewriteChapters: false, // default; title/tags must not rewrite chapters
});
// outcome.status === "applied"
// written chapter finals are unchanged; foundation.book.title is the new title
```

`confirmRewrite` is not required for `meta_only`. `rewriteChapters: true` also does nothing here unless you pass `mode: "rewrite" | "polish"` — `suggestedMode` is `"none"`.

<a id="scenario-session-impact-forward"></a>

#### 7.2c Forward-only (future outline / new characters)

Changes that mainly affect **unwritten** future chapters assess as `forward_only`. Written finals stay; `suggestedMode` is `none`. Apply foundation only — no rewrite, no polish.

```ts
const patch = {
  // whole-file replace: keep written-chapter rows, then append the future chapter
  outline: [
    { chapter: 1, title: "风暴之后", summary: "林守在礁石缝里捡到那封信。" },
    { chapter: 2, title: "岸边的地址", summary: "按地址找到一座空屋。" },
    { chapter: 3, title: "回信", summary: "把守夜写进回信，放回海里。" },
    { chapter: 4, title: "灯塔之外", summary: "尚未写下的后续。" },
  ],
  // whole-file replace: keep 林守 when adding 潮
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
  rewriteChapters: false, // unwritten chapters have nothing to rewrite
});
// outcome.status === "applied" — outline/characters updated; chapters/01.md unchanged
```

Keep existing written-chapter outline rows intact so heuristics stay `forward_only`. Changing a **written** chapter's plot in the outline is [7.2d](#scenario-session-impact-confirm) instead. Same `rewriteChapters` pitfall as [7.2b](#scenario-session-impact-meta): `suggestedMode === "none"` writes no chapters unless the host also passes `mode`.

<a id="scenario-session-impact-confirm"></a>

#### 7.2d Rewrite needed + confirm gate

Character / world / past-plot contradictions with written finals assess as `rewrite_needed`. `applyFoundationChange` **does not write** until the host passes `confirmRewrite: true` (default gate). Retry the same patch after the UI confirms.

```ts
const patch = {
  premise: "林深从未离开灯塔。",
  // whole-file replace: 林守 is removed from characters.json
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
};

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  // outcome.assessment.severity === "rewrite_needed"
  // outcome.assessment.suggestedChapters — e.g. [1, 2]
  // outcome.assessment.suggestedMode === "rewrite"
  // show outcome.assessment.reasons in the UI — store is still unchanged
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,    // host acknowledged the blast radius
    rewriteChapters: false,  // still no auto chapter rewrite (see 7.2e)
  });
}
// outcome.status === "applied"
// foundation updated; chapter finals still the pre-change text
```

Skipping the gate (`requireConfirmRewrite: false`) is an escape hatch for tests/tools — a workbench UI should keep the default and show `needs_confirm`.

<a id="scenario-session-impact-batch"></a>

#### 7.2e Batch chapter sync (`rewriteChapters: true`)

After confirm, chapters **still** do not rewrite unless the host opts in with `rewriteChapters: true` on the **confirmed** retry. Session then sequentially `chapter.write`s `suggestedChapters` (`rewrite` or `polish`). Requires `llm` (MockLlm `toolCalls`, same as [7.3](#scenario-session-chapter)). `rewriteChapters: true` with `suggestedMode === "none"` (typical `meta_only` / `forward_only`) writes no chapters unless the host also passes `mode: "rewrite" | "polish"`.

```ts
import { MemoryStore, MockLlm } from "novel-engine";

const llm = new MockLlm([
  // one writer loop per suggested chapter (toolCalls, not Engine.run)
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
const patch = { characters: [{ name: "林深", role: "主角" }] }; // replaces the whole table

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,
    rewriteChapters: true, // host opt-in — never the default; only on the confirmed retry
    instruction: "按新设定对齐本章",
  });
}
// outcome.status === "applied"
// outcome.writes.map((row) => row.chapter)  // sequential suggestedChapters
// outcome.writes.every((row) => row.mode === "rewrite")
```

Omit `rewriteChapters` (or pass `false`) to update foundation only. `pendingRewrites` is not used.

<a id="scenario-session-chapter"></a>

#### 7.3 Single-chapter create / continue / rewrite / polish

`session.chapter` is a dedicated writer loop — not full-book `Engine.run`.

| Intent | `mode` | Prerequisite |
| --- | --- | --- |
| New chapter | `create` | No final (or `force: true`) |
| Continue draft | `continue` | Draft exists, no final |
| Rewrite finished chapter | `rewrite` | Final exists + `instruction` |
| Light polish | `polish` | Final exists |

```ts
const view = await session.chapter.get(1); // plan / draft / final / summary, or null

await session.chapter.write({
  chapter: 1,
  mode: "create", // | "continue" | "rewrite" | "polish"
  title: "风暴之后",
  instruction: "灯塔视角",
});

// Host-authored final, no LLM:
await session.chapter.saveFinal(1, "# 风暴之后\n\n……");
```

<a id="scenario-session-read"></a>

#### 7.4 Read the latest foundation metadata

Session does **not** cache artifacts — every call reads the store.

```ts
const foundation = await session.getFoundation();
// { book, premise, outline, layeredOutline, characters, worldRules, audit, progress }
// missing files → null fields

const progress = await session.getProgress();
session.subscribe((event) => {
  // foundation_updated | auto_write_step | chapter_step | stopped
});
```

`upsertFoundation` / `generateFoundation` also return the latest `FoundationMeta`.

<a id="scenario-session-toc"></a>

#### 7.5 Read outline / TOC and chapters

There is no separate “TOC API”: the outline lives in `getFoundation()`, and chapter bodies are loaded with `chapter.get(n)`. Helpers come from `novel-engine`.

**Outline / TOC**

```ts
import { flattenOutline, latestCompleted, nextChapter } from "novel-engine";

const { outline, layeredOutline, progress } = await session.getFoundation();

// Short: flat outline [{ chapter, title, summary? }, ...]
outline;

// Mid/long: volume/arc layered outline; flatten to chapter list when needed
layeredOutline;
const flat = layeredOutline ? flattenOutline(layeredOutline) : (outline ?? []);

// On-disk final paths (e.g. chapters/01.md)
const finals = await session.listArtifacts("chapters/");
```

**Load a chapter by number**

```ts
const view = await session.chapter.get(1);
if (view == null) {
  // no plan / draft / final / summary yet
} else {
  view.chapter; // 1
  view.plan;    // chapter plan, or null
  view.draft;   // draft markdown, or null
  view.final;   // final markdown, or null
  view.summary; // summary, or null
}
```

Chapter numbers start at **1**. Returns `null` only when all four fields are absent; otherwise a `ChapterView`.

**Latest completed / next chapter**

```ts
const progress = await session.getProgress();
if (progress == null) {
  // no meta/progress.json yet
} else {
  const n = latestCompleted(progress); // max completed chapter; 0 if none
  const latest = n > 0 ? await session.chapter.get(n) : null;
  const next = nextChapter(progress);  // n + 1

  // In progress (may only have a draft):
  const current = progress.currentChapter;
  const inProgress = current ? await session.chapter.get(current) : null;
}
```

<a id="scenario-session-workspace"></a>

#### 7.6 Switch books and restore context

`createNovelWorkspace`: one `StorePort` per `bookId`. State lives in the store (foundation, progress, chapters), not in the in-memory session object. `switchTo` / `open` **closes** the previous session — discard the old reference (`SessionClosedError` if reused).

```ts
const stores = new Map<string, MemoryStore>();
const ws = createNovelWorkspace({
  createStore(bookId) {
    // Must cache: same bookId → same persistent store (Memory / OPFS / custom)
    const existing = stores.get(bookId);
    if (existing) return existing;
    const next = new MemoryStore();
    stores.set(bookId, next);
    return next;
  },
  // indexStore: optional — persists _index.json (book list + currentBookId)
  llm,
});

await ws.createBook({ bookId: "a", title: "无主的信" });
await ws.createBook({ bookId: "b", title: "两弧灯塔" });

const sessionA = await ws.switchTo("a"); // closes previous session
const restored = await sessionA.getFoundation(); // read back from that book's store
await sessionA.chapter.get(1);
await sessionA.getProgress();
```

Cold start with `indexStore`: `listBooks()` restores the catalog but does **not** auto-open — call `open` / `switchTo` again. For browser persistence, point `createStore` at OPFS (or a per-book subdirectory). There is no Workspace-over-Worker — keep the workspace on the UI thread; use one session Worker per book if needed ([scenario 8](#scenario-session-worker)).

<a id="scenario-session-worker"></a>

### 8. Session over Worker (`createSessionClient`)

**When:** A workbench UI must not block on auto-write / chapter ops / foundation apply, and vendor API keys must stay on a BFF.

Import `attachSessionWorker` from `novel-engine/session` (not `novel-engine/worker`). The worker holds the same-thread `NovelSession` + OPFS store; the main thread uses `createSessionClient`. `LlmPort.complete` should `fetch("/api/llm")` — **do not put API keys in the worker bundle**. `generateFoundation`, `assessFoundationImpact`, and `applyFoundationChange` run in the worker because that is where the store lives.

Details: [docs/session.md](docs/session.md#s4--worker-bridge). Pair: [`examples/session.worker.ts`](examples/session.worker.ts) + [`examples/session-host.ts`](examples/session-host.ts).

```ts
import { createSessionClient } from "novel-engine/session";

const worker = new Worker(new URL("./session.worker.ts", import.meta.url), { type: "module" });
const session = createSessionClient(worker, { bookId: "letter" });
await session.inspectFoundation({ prompt: "写一本三章短篇" });
await session.startAutoWrite({ prompt: "……", generateMissing: true });
await session.chapter.write({ chapter: 1, mode: "create" });
```

<a id="scenario-session-worker-impact"></a>

#### 8.1 Assess + apply over the Worker bridge

Same [7.2a–7.2e](#scenario-session-impact) flows: the client is still a `NovelSession`. Additive protocol commands (`SESSION_PROTOCOL === 1`): `assessFoundationImpact` / `applyFoundationChange`. Confirm gate and `rewriteChapters` default **false** are enforced in the worker. Prefer the two-step apply for `rewrite_needed` — do **not** pass `confirmRewrite: true` and then expect `needs_confirm`.

```ts
const patch = { characters: [{ name: "林深", role: "主角" }] }; // whole-file replace

const assessment = await session.assessFoundationImpact(patch);
// assessment.severity / suggestedChapters / suggestedMode / reasons — UI thread, no write

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  // show outcome.assessment.reasons — store unchanged
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,
    rewriteChapters: false, // host opt-in on the worker too; never auto-rewrite
  });
}
```

Busy (`SessionBusyError`) is the worker-side session flag: an in-flight `applyFoundationChange` blocks `chapter.write` across the bridge.

## How `route` decides

Priority is first-match, matching ainovel-cli `internal/flow/router.go`:

1. `phase === "complete"` → `null`
2. Foundation missing and `planningTier` known → architect fill
3. `pendingRewrites` non-empty → writer rewrite / polish
4. `flow === "reviewing"` → `null`
5. `flow === "steering"` → `null`
6. Aggregate refresh → editor
7. Immediate external feedback → architect
8. Layered arc-end → review / summary / expand / new volume
9. Non-layered global review due → editor
10. Non-layered outline exhausted → architect (`complete_book` / continue)
11. Else → writer next chapter

`null` is valid: Engine then tries the plan_start stub, or stops (`complete` / `idle`).

## Public API

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

See [docs/api.md](docs/api.md) for the stable surface (domain types, Worker protocol, snapshot constants).

## Develop / test

```bash
npm install
npm test
npm run test:short
npm run test:layered
npm run typecheck
npm run build
npx tsc -p tsconfig.examples.json
```

Tests use **mock fixtures only** — no network, no live providers, no real OPFS. Vendor adapter suites mock `fetch`.

Hand-authored JSON fixtures live in `fixtures/`:

- `phase-transitions.json` / `flow-transitions.json` — validator golden tables
- `route-cases.json` — Route golden cases
- `short-book.json` — 3-chapter non-layered mock book
- `layered-book.json` — 1 volume / 2 arcs mock mid-book
- `book-snapshot.json` — MemoryStore snapshot round-trip tree

## License

Apache-2.0
