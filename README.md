# novel-engine

Reusable **TypeScript** Novel Engine SDK. Pure frontend-capable (ESM), no UI, no React bindings, no TUI.

Phase 1 adds a **runnable Engine**: in-memory `StorePort` + scripted `LlmPort` adapters drive `route` and a thin Worker tool-loop until a short book reaches `phase=complete`. This package never talks to a real model and never touches `node:fs` in library runtime source.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/host/engine.go`).

## Ports & Adapters

```
┌─────────────────────────────────────────────┐
│  Host (browser / Node / worker)             │
│   StorePort adapter    LlmPort adapter      │
└──────────────┬───────────────┬──────────────┘
               │ inject        │ inject
               ▼               ▼
┌─────────────────────────────────────────────┐
│  novel-engine                               │
│   MemoryStore / MockLlm  (test adapters)    │
│   Engine.run → route(state) → Worker tools  │
│   domain  ·  StorePort / LlmPort            │
└─────────────────────────────────────────────┘
```

- **`route` is a pure function.** Input is an explicit `State` snapshot. It performs no IO and does not call `StorePort` or `LlmPort`.
- **`StorePort`** loads that snapshot and persists artifacts (Progress, foundation, drafts, checkpoints, decisions). Hosts inject memory, OPFS, IndexedDB, or Node fs *outside* this library.
- **`LlmPort`** runs architect / writer / editor completions (optional structured `toolCalls`). The library ships `MockLlm` / `ReplayLlm` only — no provider clients.

## Phase 1 contents

| Export | Role |
| --- | --- |
| `createEngine` / `Engine` | Serial loop: load state → `route` → Worker → repeat until complete / max steps |
| `MemoryStore` | In-memory `StorePort` (path → JSON/bytes) |
| `MockLlm` / `ReplayLlm` | Scripted / fixture `LlmPort` for tests |
| `route(state)` | Deterministic next `Instruction \| null` |
| `Phase` / `Flow` validators | Forward-only Phase; illegal Flow jumps fail |
| `StorePort` / `LlmPort` | Injection contracts |

**Not in Phase 1:** real LLM clients, OPFS, Web Worker wrapper, Arbiter semantic scenes, ChapterAdvanceGate review mode, UI.

## Host injection

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

1. Implement `StorePort` (`loadState` / `read` / `write` / Progress helpers) over OPFS or IndexedDB.
2. Implement `LlmPort.complete` against your gateway / WebLLM. Return `toolCalls` when the model wants `save_book`, `save_foundation`, `plan_chapter`, `draft_chapter`, `commit_chapter`, etc.
3. Call `createEngine({ store, llm }).run({ prompt })`.

`plan_start` is a **deterministic stub** in Phase 1: short books always pick `architect_short` (no Arbiter LLM). Worker failures retry once, then pause. Identical Route instructions five times also pause (deadlock cap).

## Install / develop

```bash
npm install
npm test
npm run typecheck
npm run build
```

`pnpm test` works the same (`package.json` script is `vitest run`). Tests use **mock fixtures only** — no network, no providers.

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
  MemoryStore,
  MockLlm,
  ReplayLlm,
  route,
  type StorePort,
  type LlmPort,
} from "novel-engine";
```

## Tests

Hand-authored JSON fixtures live in `fixtures/`:

- `phase-transitions.json` / `flow-transitions.json` — validator golden tables
- `route-cases.json` — Route golden cases
- `short-book.json` — 3-chapter mock book used by the Engine integration test

The end-to-end mock run:

```bash
npm test -- tests/engine.short-book.test.ts
```

It starts from a prompt, injects `MemoryStore` + `MockLlm` (scripted tool calls, no provider), and asserts `phase === "complete"` with three committed chapters, checkpoints, and a stub `plan_start` decision.

```bash
npm test
npm run build
```

## License

Apache-2.0
