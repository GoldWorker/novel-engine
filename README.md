# novel-engine

[English](README.md) | [中文文档](README.zh-CN.md)

**[Guide](docs/guide.md)** · **[API](docs/api.md)** · **[Architecture](docs/architecture.md)** · [中文](README.zh-CN.md)

Reusable **TypeScript** Novel Engine SDK for hosts that want to generate novels in the browser (or Node tests). Pure ESM, no UI, no React bindings, no TUI.

**0.5.0** adds optional **`novel-engine/kit`**: `NovelKit.create` only (no `new` + `init`), defaults **OPFS + Worker**, and a **shipped** `dist/novel-kit.worker.js` so hosts do not maintain worker source. Session (`novel-engine/session`) remains the reference API. Default `.` / `./worker` / `./llm` bundles still ship no vendor clients.

The default `novel-engine` / `novel-engine/worker` entries never talk to a real model. `src/` never uses `node:fs` / `node:path`.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/host/engine.go`).

**How-to:** [guide](docs/guide.md). **Contracts:** [api](docs/api.md). **Internals:** [architecture](docs/architecture.md). Index: [docs/README.md](docs/README.md).

## Out of the box (`NovelKit`)

**Create only** (`NovelKit.create` — no `new` + `init`). Defaults **OPFS + Worker**. The package **ships** `dist/novel-kit.worker.js`. Worker `LlmPort.complete` is `fetch(llmEndpoint)` — put vendor keys on a BFF, not in the worker. Omit `bookId` → `"default"`.

| Option | Default | Opt out |
| --- | --- | --- |
| `store` | `"opfs"` | `"memory"` (Node/tests) |
| `runtime` | `"worker"` | `"main"` (Node/tests; `llm` required) |
| `llmEndpoint` | `"/api/llm"` | your BFF route |
| `bookId` | `"default"` | any non-empty string |
| `fallbackToMemory` | `true` | `false` throws if OPFS is missing |

Browser (recommended):

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  llmEndpoint: "/api/llm", // worker fetch — no API keys in the worker
  // bookId omitted → "default"
});

const { gaps, readyToWrite } = await kit.inspect({ prompt: "写一本三章短篇" });
await kit.fillFoundation({ book: { title: "无主的信", synopsis: "灯塔与潮" } });
const outcome = await kit.startBook({
  prompt: "写一本三章短篇：……",
  generateMissing: true, // may return { status: "needs_foundation", gaps }
});
kit.subscribe((event) => console.log(event.type));
kit.dispose();
```

Node / tests (`runtime: "main"` + `store: "memory"`; `llm` is required):

```ts
import { MockLlm } from "novel-engine";
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  runtime: "main",
  store: "memory",
  llm: new MockLlm([{ text: JSON.stringify({ premise: "……" }) }]),
  bookId: "letter",
});
```

Runnable file: [`examples/kit-host.ts`](examples/kit-host.ts). Full Kit how-to (worker URL, method map, two-step `applyFoundation`): [guide](docs/guide.md#scenario-kit). Contracts: [api](docs/api.md#optional-novelkit-novel-enginekit).

Kit names wrap Session 1:1 (`inspect` → `inspectFoundation`, `applyFoundation` → `applyFoundationChange`, …). Assess a **proposed** patch before apply. `rewriteChapters` default **false**. Long audited Session flows (7.2a–e confirm gate): [guide §7.2a–e](docs/guide.md#scenario-session-impact).

## Install

**Copy into the host (recommended):** vendor this package under the app (`vendor/novel-engine/`, `packages/novel-engine/`, …), build `dist/`, then import with **relative paths** (or `file:./vendor/novel-engine` to keep the package name). Details: [guide — Install](docs/guide.md#install). Registry `npm install novel-engine` is the other option.

```ts
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
```

Package entries:

| Entry | Import | Role |
| --- | --- | --- |
| `.` | `novel-engine` | Engine, stores, client, mocks, snapshot, `route` |
| `./worker` | `novel-engine/worker` | `attachEngineWorker` + Engine/stores for a dedicated worker |
| `./llm` | `novel-engine/llm` | Optional fetch `LlmPort` adapters (OpenAI, Anthropic, DashScope) |
| `./session` | `novel-engine/session` | Optional same-thread host session + Worker session bridge |
| `./kit` | `novel-engine/kit` | Out-of-the-box `NovelKit.create` (defaults OPFS + Worker) |
| `./kit/worker` | `novel-engine/kit/worker` | Shipped kit worker (`dist/novel-kit.worker.js`) |

Published `files`: `dist/`, `README.md`, `LICENSE`.

## Usage scenarios

Each row is a job you might actually run. Open the linked `examples/*.ts` to copy; open the [guide](docs/guide.md) when you need the surrounding how-to (including audited Session **7.2a–e** / **8.1** confirm-gate flows). `examples/` is documentation — not part of `npm test`. In-repo mock runs: `npm run test:short` and `npm run test:layered`.

| Scenario | When to use | Guide | Example |
| --- | --- | --- | --- |
| 0. **NovelKit (recommended)** | Browser workbench: OPFS + shipped Worker; Node/tests: `runtime: "main"` + `store: "memory"` | [Kit](docs/guide.md#scenario-kit) | [`kit-host.ts`](examples/kit-host.ts) |
| 1. Short book to complete | Same-thread mock of a 3-chapter book through `phase=complete` | [§1](docs/guide.md#scenario-short-book) | [`short-book.ts`](examples/short-book.ts) |
| 2. Layered mid / long book | Volume/arc outline, arc-end review → `expand_next_arc` | [§2](docs/guide.md#scenario-layered-book) | [`layered-book.ts`](examples/layered-book.ts) |
| 3. Persist in the browser (OPFS) | Keep artifacts across reloads | [§3](docs/guide.md#scenario-opfs) | [`opfs-store.ts`](examples/opfs-store.ts) |
| 4. Embed in a Web Worker | Dedicated Engine worker + main-thread client | [§4](docs/guide.md#scenario-worker) | [`engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) |
| 5. Book snapshot export / import | Zip every store path and merge-restore | [§5](docs/guide.md#scenario-snapshot) | [`snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) |
| 6. Inject a real LLM | `novel-engine/llm` behind a BFF | [§6](docs/guide.md#scenario-llm) | [`llm-openai.ts`](examples/llm-openai.ts) |
| 7. Host session | Inspect, foundation upsert/generate, **assess → apply**, chapter write, TOC, workspace | [§7](docs/guide.md#scenario-session) ([7.2a–e](docs/guide.md#scenario-session-impact)) | [`session-workspace.ts`](examples/session-workspace.ts) |
| 8. Session over Worker | Same Session API off the UI thread | [§8](docs/guide.md#scenario-session-worker) ([8.1](docs/guide.md#scenario-session-worker-impact)) | [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts) |

Pitfalls (assess-before-apply, whole-file replace, `rewriteChapters` + `suggestedMode: "none"`, null `getProgress()`): [guide](docs/guide.md#pitfalls).

## Examples

Canonical runnable TypeScript lives in [`examples/`](examples/). Copy the file that matches the row above. Worker embeds need **both** files.

| File | Copy this when |
| --- | --- |
| [`kit-host.ts`](examples/kit-host.ts) | Out-of-the-box Kit host |
| [`short-book.ts`](examples/short-book.ts) | Scripted 3-chapter Engine mock |
| [`layered-book.ts`](examples/layered-book.ts) | Volume/arc Engine mock |
| [`opfs-store.ts`](examples/opfs-store.ts) | Browser OPFS store |
| [`engine.worker.ts`](examples/engine.worker.ts) + [`worker-host.ts`](examples/worker-host.ts) | Host-owned Engine worker |
| [`snapshot-roundtrip.ts`](examples/snapshot-roundtrip.ts) | Book snapshot zip / merge |
| [`llm-openai.ts`](examples/llm-openai.ts) | `novel-engine/llm` on a trusted host / BFF |
| [`session-workspace.ts`](examples/session-workspace.ts) | Same-thread Session (incl. assess / apply) |
| [`session.worker.ts`](examples/session.worker.ts) + [`session-host.ts`](examples/session-host.ts) | Session over Worker |

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

Stable surface: [docs/api.md](docs/api.md). Session contracts (S0–S6, errors, protocol): [api — Session](docs/api.md#optional-host-session-novel-enginesession).

## What's not included

- Vendor LLM clients in the default `novel-engine` / `novel-engine/worker` bundles — inject `LlmPort`, or import optional [`novel-engine/llm`](docs/guide.md#scenario-llm) (fetch adapters; **do not put API keys in a public browser app**)
- Host session in the default bundles — import optional [`novel-engine/kit`](docs/guide.md#scenario-kit) (out-of-the-box façade) or [`novel-engine/session`](docs/api.md#optional-host-session-novel-enginesession) (S0–S6 inspect, generate, auto-write, ChapterRunner, foundation impact, Worker bridge, workspace)
- React package, Demo SPA, or any visual app
- Arbiter full semantic scenes (`plan_start` is a keyword stub)
- ChapterAdvanceGate review-mode UI
- Node filesystem adapters — implement `StorePort` outside this library if you need `fs`

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
