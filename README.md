# novel-engine

[English](README.md) | [中文文档](README.zh-CN.md)

Reusable **TypeScript** Novel Engine SDK for hosts that want to generate novels in the browser (or Node tests). Pure ESM, no UI, no React bindings, no TUI.

**0.1.0** is the first usable semver: Engine + `route` + MemoryStore / OpfsStore + MockLlm + Worker host + book snapshot zip.

This package never talks to a real model and never uses `node:fs` / `node:path` in `src/`.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/host/engine.go`).

Stable exports: [docs/api.md](docs/api.md) ([中文 API](docs/api.zh-CN.md)).

**How do I use this?** Jump to [Usage by scenario](#usage-by-scenario) — [short book](#scenario-short-book) · [layered mid/long](#scenario-layered-book) · [OPFS persist](#scenario-opfs) · [Web Worker](#scenario-worker) · [book snapshot](#scenario-snapshot). Runnable sources stay in [`examples/`](examples/).

## What's not included

- Real LLM provider clients (OpenAI, WebLLM, …) — inject `LlmPort`
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
- **`LlmPort`** runs architect / writer / editor completions (optional structured `toolCalls`). The library ships `MockLlm` / `ReplayLlm` only.

## Install

```bash
npm install novel-engine
```

Package exports:

| Entry | Import | Role |
| --- | --- | --- |
| `.` | `novel-engine` | Engine, stores, client, mocks, snapshot, `route` |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores for a dedicated worker |

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

The worker bundle is a **separate entry** so bundlers can tree-shake the main-thread client out of the worker (and vice versa). Host-owned worker file: inject your `LlmPort` there (this library never ships a provider client). `MockLlm.fromHandler` also works inside the worker — see scenario 1.

`pause` / `steer` take effect **after the current Worker instruction**, not mid-tool. `steer` records a decision and sets `flow=steering` so `route` returns null until `resume()` restores the previous flow.

Protocol (`ENGINE_PROTOCOL === 1`): main → worker `start` / `steer` / `pause` / `resume` / `snapshot`; worker → main `event` / `snapshot` / `error`. Event kinds: `started` | `step` | `paused` | `resumed` | `steered` | `stopped`.

Full pair: [`examples/engine.worker.ts`](examples/engine.worker.ts) (worker) + [`examples/worker-host.ts`](examples/worker-host.ts) (main). Copy **both**.

Worker module:

```ts
import { attachEngineWorker, createOpfsStore } from "novel-engine/worker";
import type { LlmPort } from "novel-engine/worker";

const llm: LlmPort = {
  async complete() {
    // gateway / WebLLM — this library does not ship a provider client
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

Tests use **mock fixtures only** — no network, no providers, no real OPFS.

Hand-authored JSON fixtures live in `fixtures/`:

- `phase-transitions.json` / `flow-transitions.json` — validator golden tables
- `route-cases.json` — Route golden cases
- `short-book.json` — 3-chapter non-layered mock book
- `layered-book.json` — 1 volume / 2 arcs mock mid-book
- `book-snapshot.json` — MemoryStore snapshot round-trip tree

## License

Apache-2.0
