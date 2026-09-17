# novel-engine

Reusable **TypeScript** Novel Engine SDK. Pure frontend-capable (ESM), no UI, no React bindings, no TUI.

Phase 3 adds **layered mid/long-book tools** on top of the Phase 2 Engine: `architect_long` (`layered_outline` / `expand_next_arc` / `append_volume` / `complete_book`), editor summaries (`save_review`, `save_arc_summary`, `save_volume_summary`), and a lightweight `novel_context` pack (sliding chapter summaries + arc/volume summaries). Phase 2's OpfsStore and Web Worker host remain. This package never talks to a real model and never touches `node:fs` in library runtime source.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/host/engine.go`).

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
- **`StorePort`** loads that snapshot and persists artifacts (Progress, foundation, drafts, checkpoints, decisions). Hosts inject `MemoryStore`, `OpfsStore`, IndexedDB, or Node fs *outside* this library.
- **`LlmPort`** runs architect / writer / editor completions (optional structured `toolCalls`). The library ships `MockLlm` / `ReplayLlm` only — no provider clients.

## Phase 3 contents

| Export | Role |
| --- | --- |
| `createEngine` / `Engine` | Serial loop: load state → `route` → Worker → repeat until complete / max steps. Cooperative `pause` / `resume` / `steer` at loop boundaries. |
| `MemoryStore` | In-memory `StorePort` (path → JSON/bytes) |
| `OpfsStore` / `createOpfsStore` / `isOpfsAvailable` | OPFS-backed `StorePort`; `createOpfsStore()` falls back to `MemoryStore` when OPFS is missing |
| `createEngineClient` | Main-thread wrapper over a `Worker` / message port |
| `attachEngineWorker` (`novel-engine/worker`) | Worker entry: constructs Engine with injected ports |
| `MockLlm` / `ReplayLlm` | Scripted / fixture `LlmPort` for tests |
| `route(state)` | Deterministic next `Instruction \| null` |
| `Phase` / `Flow` validators | Forward-only Phase; illegal Flow jumps fail |
| `architect_long` tools | `save_foundation(type=layered_outline\|append_volume\|complete_book)`, `expand_next_arc` |
| Editor summaries | `save_review` (arc/global), `save_arc_summary`, `save_volume_summary` |
| `novel_context` | Sliding chapter summaries + arc/volume summaries when present (no four-stage compressor) |

**Not in Phase 3:** real LLM clients, Arbiter semantic scenes, ChapterAdvanceGate review mode, voice-layer polish, UI.

## Host injection (same thread)

```ts
import { createEngine, MemoryStore, MockLlm } from "novel-engine";

const store = new MemoryStore();
const llm = new MockLlm([
  { text: "done" }, // or { toolCalls: [{ id, name, arguments }] }
]);

const engine = createEngine({ store, llm, maxSteps: 40 });
const result = await engine.run({ prompt: "写一本三章短篇：……" });
// result.stoppedReason === "complete" | "idle" | "paused" | "max_steps"
```

A real host swaps the adapters:

1. Implement `StorePort` (`loadState` / `read` / `write` / Progress helpers) over OPFS (below) or IndexedDB.
2. Implement `LlmPort.complete` against your gateway / WebLLM. Return `toolCalls` when the model wants `save_book`, `save_foundation`, `plan_chapter`, `draft_chapter`, `commit_chapter`, etc.
3. Call `createEngine({ store, llm }).run({ prompt })`.

`plan_start` is a **deterministic stub** (no Arbiter LLM): prompts containing `长篇` pick `architect_long` / `long`; `中篇` or `分层` pick `architect_long` / `mid`; otherwise `architect_short` / `short`. Worker failures retry once, then pause. Identical Route instructions five times also pause (deadlock cap).

## OPFS store

`isOpfsAvailable()` is a capability check (`navigator.storage.getDirectory`, or an injected fake in tests).

`createOpfsStore()` opens `OpfsStore` when OPFS exists; **otherwise it returns `MemoryStore`**. Memory is ephemeral — reload loses artifacts. Hosts that must persist should check the capability (or call `OpfsStore.open()`, which throws `OpfsUnavailableError`).

```ts
import {
  createOpfsStore,
  isOpfsAvailable,
  OpfsStore,
  MemoryStore,
} from "novel-engine";

if (!isOpfsAvailable()) {
  // No OPFS (Node, insecure context, older browser). createOpfsStore()
  // returns MemoryStore unless you pass { fallbackToMemory: false }.
}

const store = await createOpfsStore(); // OpfsStore | MemoryStore
// store is a StorePort; Engine does not care which.

// Strict: throw if OPFS cannot be opened
const persisted = await OpfsStore.open(); // subdirectory "novel-engine"
```

Writes use a sibling temp file then `move` (or copy-then-unlink) so a crash mid-write does not truncate the previous artifact. Tests inject an in-memory OPFS shim — no real browser required.

Dedicated Workers can open OPFS; putting `OpfsStore` inside the worker (below) keeps disk IO off the main thread.

## Web Worker host

The worker bundle is a **separate entry** so bundlers can tree-shake the main-thread client out of the worker (and vice versa):

- `novel-engine` — Engine, stores, `createEngineClient`, protocol types
- `novel-engine/worker` — `attachEngineWorker` + Engine/stores for the worker module

Protocol (`v: 1`):

| Direction | `type` | Role |
| --- | --- | --- |
| main → worker | `start` | `Engine.run({ prompt, maxSteps })` |
| main → worker | `steer` | Persist a note, set `flow=steering`, pause at the next loop boundary |
| main → worker | `pause` / `resume` | Cooperative yield / continue (after the current instruction) |
| main → worker | `snapshot` | `{ state, result, running, paused }` |
| worker → main | `event` | `started` / `step` / `paused` / `resumed` / `steered` / `stopped` |
| worker → main | `snapshot` | Completes `start` / `snapshot` |
| worker → main | `error` | Failed command (`id` correlates) |

Worker module (host-owned file; inject your `LlmPort`):

```ts
import { attachEngineWorker, createOpfsStore } from "novel-engine/worker";
import type { LlmPort } from "novel-engine/worker";

const llm: LlmPort = {
  async complete(request) {
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

`pause` / `steer` take effect **after the current Worker instruction** (architect/writer/editor tool-loop), not mid-tool. `steer` records a decision and sets `flow=steering` so `route` returns null until `resume()` restores the previous flow.

Tests drive this protocol with a fake message port (no real `Worker` thread).

## Install / develop

```bash
npm install
npm test
npm run typecheck
npm run build
```

`pnpm test` works the same (`package.json` script is `vitest run`). Tests use **mock fixtures only** — no network, no providers, no real OPFS.

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
  type StorePort,
  type LlmPort,
} from "novel-engine";

import { attachEngineWorker } from "novel-engine/worker";
```

## Tests

Hand-authored JSON fixtures live in `fixtures/`:

- `phase-transitions.json` / `flow-transitions.json` — validator golden tables
- `route-cases.json` — Route golden cases
- `short-book.json` — 3-chapter non-layered mock book (Phase 1, still required)
- `layered-book.json` — 1 volume / 2 arcs mock mid-book (Phase 3)

The end-to-end mock runs:

```bash
npm test -- tests/engine.short-book.test.ts
npm test -- tests/engine.layered-book.test.ts
```

The short-book test starts from a prompt, injects `MemoryStore` + `MockLlm` (scripted tool calls, no provider), and asserts `phase === "complete"` with three committed chapters, checkpoints, and a stub `plan_start` decision.

The layered mock run uses the same injection. Prompt keywords select `architect_long`. After two expanded chapters, Route hits arc-end: editor `save_review` (scope=arc) → `save_arc_summary` → `expand_next_arc`. After the second arc it writes a volume summary, then `complete_book`.

Worker protocol + OPFS shim:

```bash
npm test -- tests/engine-host.test.ts tests/opfs-store.test.ts
```

```bash
npm test
npm run build
```

## License

Apache-2.0
