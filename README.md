# novel-engine

[English](README.md) | [中文文档](README.zh-CN.md)

Reusable **TypeScript** Novel Engine SDK for hosts that want to generate novels in the browser (or Node tests). Pure ESM, no UI, no React bindings, no TUI.

**0.1.0** is the first usable semver: Engine + `route` + MemoryStore / OpfsStore + MockLlm + Worker host + book snapshot zip.

This package never talks to a real model and never uses `node:fs` / `node:path` in `src/`.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/host/engine.go`).

Stable exports are listed in [docs/api.md](docs/api.md) ([中文 API](docs/api.zh-CN.md)). Copy-pasteable host examples live in [`examples/`](examples/) ([中文说明](examples/README.zh-CN.md)).

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
│   StorePort (OpfsStore | MemoryStore)       │
│   LlmPort  (host-injected)                  │
│   Engine.run → route(state) → Worker tools  │
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

## Quickstart (mock short book)

Full copy-pasteable run (handler through `phase=complete`): [`examples/short-book.ts`](examples/short-book.ts).

```ts
import { createEngine, MemoryStore, MockLlm } from "novel-engine";

const store = new MemoryStore();
const llm = new MockLlm([
  // Each complete() consumes one scripted step. Prefer toolCalls in real hosts.
  { text: "done" },
]);

const engine = createEngine({ store, llm, maxSteps: 40 });
const result = await engine.run({ prompt: "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。" });
// result.stoppedReason === "complete" | "idle" | "paused" | "max_steps"
```

To finish a whole book, use `MockLlm.fromHandler` (Worker tools echo results back; `audit_foundation` must reuse the `fingerprint` from `novel_context`). `ReplayLlm` only replays a fixed `{ text, toolCalls? }[]` and does not inspect the request.

`plan_start` is a **deterministic stub** (no Arbiter LLM): prompts containing `长篇` pick `architect_long` / `long`; `中篇` or `分层` pick `architect_long` / `mid`; otherwise `architect_short` / `short`. Worker failures retry once, then pause. Identical Route instructions five times also pause (deadlock cap).

The repo's short-book fixture is the supported mock path:

```bash
npm run test:short
```

## Layered mock (mid / long)

Full copy-pasteable run: [`examples/layered-book.ts`](examples/layered-book.ts).

`architect_long` tools: `save_foundation(type=layered_outline|append_volume|complete_book)`, `expand_next_arc`. Editor summaries: `save_review` (arc/global), `save_arc_summary`, `save_volume_summary`. `novel_context` is a sliding window of chapter summaries plus arc/volume summaries when present (no four-stage compressor).

```bash
npm run test:layered
```

The layered fixture is one volume / two arcs. After two expanded chapters, Route hits arc-end: editor `save_review` → `save_arc_summary` → `expand_next_arc`. After the second arc it writes a volume summary, then `complete_book`.

A host still injects `MemoryStore` + `MockLlm` (or a real `LlmPort`) the same way as the short-book quickstart — only the prompt keywords and tool names change.

## Persist with OPFS

Full copy-pasteable setup: [`examples/opfs-store.ts`](examples/opfs-store.ts).

`isOpfsAvailable()` is a capability check (`navigator.storage.getDirectory`, or an injected fake in tests).

`createOpfsStore()` opens `OpfsStore` when OPFS exists; **otherwise it returns `MemoryStore`**. Memory is ephemeral — reload loses artifacts. Hosts that must persist should check the capability (or call `OpfsStore.open()`, which throws `OpfsUnavailableError`).

```ts
import {
  createOpfsStore,
  isOpfsAvailable,
  OpfsStore,
} from "novel-engine";

if (!isOpfsAvailable()) {
  // Node, insecure context, older browser.
  // createOpfsStore() returns MemoryStore unless { fallbackToMemory: false }.
}

const store = await createOpfsStore(); // OpfsStore | MemoryStore
const persisted = await OpfsStore.open(); // subdirectory "novel-engine"; throws if unavailable
```

Writes use a sibling temp file then `move` (or copy-then-unlink) so a crash mid-write does not truncate the previous artifact.

## Embed in a Web Worker

Full copy-pasteable pair: [`examples/engine.worker.ts`](examples/engine.worker.ts) (worker thread) + [`examples/worker-host.ts`](examples/worker-host.ts) (main thread).

The worker bundle is a **separate entry** so bundlers can tree-shake the main-thread client out of the worker (and vice versa).

Worker module (host-owned file; inject your `LlmPort`):

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
    return { store, llm };
  },
});
```

Main thread:

```ts
import { createEngineClient } from "novel-engine";

const worker = new Worker(new URL("./engine.worker.js", import.meta.url), {
  type: "module",
});
const engine = createEngineClient(worker);

engine.onEvent((event) => {
  // event.kind: started | step | paused | resumed | steered | stopped
});

const result = await engine.start({ prompt: "写一本三章短篇：……" });
await engine.pause();
await engine.steer("把结局改成和解");
await engine.resume();
const snap = await engine.snapshot();
```

`pause` / `steer` take effect **after the current Worker instruction**, not mid-tool. `steer` records a decision and sets `flow=steering` so `route` returns null until `resume()` restores the previous flow.

Protocol (`v: 1`): `start` / `steer` / `pause` / `resume` / `snapshot` from main; `event` / `snapshot` / `error` from the worker.

## Book snapshot export / import

Full copy-pasteable round-trip: [`examples/snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts).

Browser-safe zip of every store path (fflate). Restore is a merge: snapshot paths are overwritten; extra files already in the destination stay.

```ts
import {
  exportBookSnapshot,
  importBookSnapshot,
  MemoryStore,
} from "novel-engine";

const bytes = await exportBookSnapshot(store); // Uint8Array zip
await importBookSnapshot(new MemoryStore(), bytes);
```

`MemoryStore` / `OpfsStore` implement `list()`, so custom extra files are included. Custom `StorePort` adapters without `list` still export the known book layout (`meta/`, `chapters/`, …).

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

## Examples

| File | What it shows |
| --- | --- |
| [`examples/short-book.ts`](examples/short-book.ts) | Short book to complete (`MockLlm` / `ReplayLlm`) |
| [`examples/layered-book.ts`](examples/layered-book.ts) | Layered mid-book `architect_long` |
| [`examples/opfs-store.ts`](examples/opfs-store.ts) | OPFS with MemoryStore fallback |
| [`examples/engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) | Worker embed + protocol |
| [`examples/snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) | Snapshot zip round-trip |

Index: [`examples/README.md`](examples/README.md) · [中文](examples/README.zh-CN.md)

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
