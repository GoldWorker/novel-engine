# novel-engine

Reusable **TypeScript** Novel Engine SDK. Pure frontend-capable (ESM), no UI, no React bindings, no TUI.

Phase 0 is a **Ports & Adapters** core: domain types, a pure `route` function, and injection ports. Host apps (browser, Node, workers) will later supply storage and LLM adapters. This package never talks to a real model and never touches `node:fs` in library runtime source.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/domain`).

## Ports & Adapters

```
┌─────────────────────────────────────────────┐
│  Host (browser / Node / worker)             │
│   StorePort adapter    LlmPort adapter      │
└──────────────┬───────────────┬──────────────┘
               │ inject        │ inject
               ▼               ▼
┌─────────────────────────────────────────────┐
│  novel-engine (this package)                │
│   domain  ·  route(state) → Instruction     │
│   StorePort / LlmPort  (interfaces only)    │
└─────────────────────────────────────────────┘
```

- **`route` is a pure function.** Input is an explicit `State` snapshot. It performs no IO and does not call `StorePort` or `LlmPort`.
- **`StorePort`** is how a future Engine will load that snapshot (OPFS, IndexedDB, in-memory, or Node fs *outside* this library).
- **`LlmPort`** is how a future Engine will run architect / writer / editor completions. Phase 0 does not implement the Engine loop.

Until Engine exists, hosts can still:

1. Assemble a `State` from their own storage.
2. Call `route(state)`.
3. Dispatch the returned `Instruction` (or handle `null`).

## Phase 0 contents

| Export | Role |
| --- | --- |
| `Phase`, `canTransitionPhase`, `validatePhaseTransition` | Forward-only: `init → premise → outline → writing → complete` |
| `Flow`, `canTransitionFlow`, `validateFlowTransition` | Writing-period flows; illegal jumps (e.g. `rewriting → reviewing`) fail |
| `PlanningTier`, `plannerForTier` | `short → architect_short`; `mid` / `long → architect_long` |
| `Progress`, `nextChapter`, `latestCompleted` | Facts `route` needs |
| `route(state)` | Deterministic next `Instruction \| null` |
| `StorePort`, `LlmPort` | Injection contracts only — no implementations |

**Not in Phase 0:** Engine loop, Workers tool-loop, Arbiter, OPFS, Web Worker wrapper, real LLM clients, UI.

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
10. Non-layered outline exhausted → architect
11. Else → writer next chapter

`null` is valid: the host should summarize, wait for the user, or run a semantic bootstrap (planner selection) — Route does not guess.

## Public API

```ts
import {
  route,
  canTransitionPhase,
  canTransitionFlow,
  nextChapter,
  plannerForTier,
  type State,
  type Instruction,
  type Progress,
  type StorePort,
  type LlmPort,
} from "novel-engine";

const instruction = route({
  progress: {
    phase: "writing",
    flow: "writing",
    totalChapters: 20,
    completedChapters: [1, 2, 3],
    pendingRewrites: [],
    layered: false,
  },
  lastCompleted: 3,
});
// → { agent: "writer", task: "写第 4 章", reason: "续写下一章", chapter: 4 }
```

Future Engine sketch (not implemented):

```ts
class Engine {
  constructor(
    private readonly store: StorePort,
    private readonly llm: LlmPort,
  ) {}

  async next(): Promise<Instruction | null> {
    const state = await this.store.loadState(); // IO in the adapter
    return route(state);                        // still pure
  }
}
```

## Tests

Hand-authored JSON fixtures live in `fixtures/`:

- `phase-transitions.json` / `flow-transitions.json` — validator golden tables
- `route-cases.json` — Route golden cases (complete, foundation fill, rewrite, arc-end review, next chapter, steering, …)

```bash
npm test
```

## License

Apache-2.0
