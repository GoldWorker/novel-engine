# novel-engine

[English](README.md) | [中文文档](README.zh-CN.md)

**[Guide](docs/guide.md)** · **[Kit](docs/guide-kit.md)** · **[API](docs/api.md)** · **[Session](docs/session.md)** · **[Architecture](docs/architecture.md)** · [中文](README.zh-CN.md)

Reusable **TypeScript** Novel Engine SDK for hosts that want to generate novels in the browser (or Node tests). Pure ESM, no UI, no React bindings, no TUI.

**0.5.0** adds optional **`novel-engine/kit`**: `NovelKit.create` only (no `new` + `init`), defaults **OPFS + Worker**, and a **shipped** `dist/novel-kit.worker.js` so hosts do not maintain worker source. Session (`novel-engine/session`) remains the reference API. Default `.` / `./worker` / `./llm` bundles still ship no vendor clients.

The default `novel-engine` / `novel-engine/worker` entries never talk to a real model. `src/` never uses `node:fs` / `node:path`.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/host/engine.go`).

Docs index: [docs/README.md](docs/README.md). Ports, `route`, and Worker protocols: [architecture](docs/architecture.md) (one-line: **`route` is a pure function**; Engine/Session adapters do the IO).

## What's not included

- Vendor LLM clients in the default `novel-engine` / `novel-engine/worker` bundles — inject `LlmPort`, or import optional [`novel-engine/llm`](docs/llm-adapters.md) (fetch adapters; **do not put API keys in a public browser app**)
- Host session in the default bundles — import optional [`novel-engine/kit`](docs/guide-kit.md) (out-of-the-box façade) or [`novel-engine/session`](docs/session.md) (S0–S6 inspect, generate, auto-write, ChapterRunner, foundation impact, Worker bridge, workspace)
- React package, Demo SPA, or any visual app
- Arbiter full semantic scenes (`plan_start` is a keyword stub)
- ChapterAdvanceGate review-mode UI
- Node filesystem adapters — implement `StorePort` outside this library if you need `fs`

## Install

**Copy into the host (recommended for Next.js《小说工作台》):** vendor this package under the app (`vendor/novel-engine/`, `packages/novel-engine/`, …), build `dist/`, then import with **relative paths** (or `file:./vendor/novel-engine` to keep the package name). Details: [guide — Install](docs/guide.md#install).

```ts
// from my-app/src/lib/engine.ts
import { createEngine, MemoryStore } from "../../vendor/novel-engine/dist/index.js";
import { createNovelSession } from "../../vendor/novel-engine/dist/session.js";
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
import { attachEngineWorker } from "../../vendor/novel-engine/dist/worker.js";
import { createOpenAiLlm } from "../../vendor/novel-engine/dist/llm.js";
```

**Registry (other option):**

```bash
npm install novel-engine
```

Also possible: depend on a sibling checkout with `file:../novel-engine` after that checkout is built.

Package exports:

| Entry | Import | Role |
| --- | --- | --- |
| `.` | `novel-engine` | Engine, stores, client, mocks, snapshot, `route` |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores for a dedicated worker |
| `./llm` | `novel-engine/llm` | Optional fetch `LlmPort` adapters (OpenAI, Anthropic, DashScope) |
| `./session` | `novel-engine/session` | Optional same-thread host session + Worker session bridge |
| `./kit` | `novel-engine/kit` | Out-of-the-box `NovelKit.create` (defaults OPFS + Worker) |
| `./kit/worker` | `novel-engine/kit/worker` | Shipped kit worker (`dist/novel-kit.worker.js`) |

Published `files`: `dist/`, `README.md`, `LICENSE`.

## Usage by scenario

Host how-to (copy-paste snippets, including audited Session **7.2a–e** / **8.1** confirm-gate flows) lives in the **[guide](docs/guide.md)**. Each row is a job you might actually run; open the linked `examples/*.ts` for the full runnable file. `examples/` is documentation — not part of `npm test`. Supported in-repo mock runs: `npm run test:short` and `npm run test:layered`.

| Scenario | When to use | Guide | Canonical source |
| --- | --- | --- | --- |
| 0. **NovelKit (recommended)** | Browser workbench: OPFS + shipped Worker; Node/tests: `runtime: "main"` + `store: "memory"` | [kit](docs/guide-kit.md) | [`kit-host.ts`](examples/kit-host.ts) |
| 1. Short book to complete | Same-thread mock of a 3-chapter book through `phase=complete` | [§1](docs/guide.md#scenario-short-book) | [`short-book.ts`](examples/short-book.ts) |
| 2. Layered mid / long book | Volume/arc outline, arc-end review → `expand_next_arc` | [§2](docs/guide.md#scenario-layered-book) | [`layered-book.ts`](examples/layered-book.ts) |
| 3. Persist in the browser (OPFS) | Keep artifacts across reloads | [§3](docs/guide.md#scenario-opfs) | [`opfs-store.ts`](examples/opfs-store.ts) |
| 4. Embed in a Web Worker | Dedicated Engine worker + main-thread client | [§4](docs/guide.md#scenario-worker) | [`engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) |
| 5. Book snapshot export / import | Zip every store path and merge-restore | [§5](docs/guide.md#scenario-snapshot) | [`snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) |
| 6. Inject a real LLM | `novel-engine/llm` behind a BFF | [§6](docs/guide.md#scenario-llm) | [`llm-openai.ts`](examples/llm-openai.ts) |
| 7. Host session | Inspect, foundation upsert/generate, **assess → apply** ([7.2a](docs/guide.md#scenario-session-impact-assess) · [7.2b](docs/guide.md#scenario-session-impact-meta) · [7.2c](docs/guide.md#scenario-session-impact-forward) · [7.2d confirm gate](docs/guide.md#scenario-session-impact-confirm) · [7.2e batch rewrite](docs/guide.md#scenario-session-impact-batch)), chapter write, TOC, workspace | [§7](docs/guide.md#scenario-session) | [`session-workspace.ts`](examples/session-workspace.ts) |
| 8. Session over Worker | Same Session API off the UI thread; [8.1 assess + apply](docs/guide.md#scenario-session-worker-impact) | [§8](docs/guide.md#scenario-session-worker) | [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts) |

Getting started and pitfalls (assess-before-apply, whole-file replace, `rewriteChapters` + `suggestedMode: "none"`, null `getProgress()`): [guide](docs/guide.md) · [pitfalls](docs/guide.md#pitfalls).

Folder index: [`examples/README.md`](examples/README.md) · [中文](examples/README.zh-CN.md).

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
import { NovelKit } from "novel-engine/kit";
```

Stable surface: [docs/api.md](docs/api.md). Kit how-to: [docs/guide-kit.md](docs/guide-kit.md). Session contracts: [docs/session.md](docs/session.md).

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
