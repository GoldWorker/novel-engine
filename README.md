# novel-engine

[English](README.md) | [中文文档](README.zh-CN.md)

**[Guide](docs/guide.md)** · **[API](docs/api.md)** · **[Architecture](docs/architecture.md)** · [中文](README.zh-CN.md)

Reusable **TypeScript** Novel Engine SDK for hosts that want to generate novels in the browser (or Node tests). Pure ESM, no UI, no React bindings, no TUI.

**0.5.0** adds optional **`novel-engine/kit`**: `NovelKit.create` only (no `new` + `init`), defaults **OPFS + Worker**, and a **shipped** `dist/novel-kit.worker.js` so hosts do not maintain worker source. Session (`novel-engine/session`) remains the reference API. Default `.` / `./worker` / `./llm` bundles still ship no vendor clients.

The default `novel-engine` / `novel-engine/worker` entries never talk to a real model. `src/` never uses `node:fs` / `node:path`.

Inspired by the routing model in [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) (`internal/flow/router.go`, `internal/host/engine.go`).

**How-to:** [guide](docs/guide.md). **Contracts:** [api](docs/api.md). **Internals:** [architecture](docs/architecture.md). Index: [docs/README.md](docs/README.md). Runnable sketches: [`examples/`](examples/).

## What's not included

- Vendor LLM clients in the default `novel-engine` / `novel-engine/worker` bundles — inject `LlmPort`, or import optional [`novel-engine/llm`](docs/guide.md#scenario-llm) (fetch adapters; **do not put API keys in a public browser app**)
- Host session in the default bundles — import optional [`novel-engine/kit`](docs/guide.md#scenario-kit) (out-of-the-box façade) or [`novel-engine/session`](docs/api.md#optional-host-session-novel-enginesession) (S0–S6 inspect, generate, auto-write, ChapterRunner, foundation impact, Worker bridge, workspace)
- React package, Demo SPA, or any visual app
- Arbiter full semantic scenes (`plan_start` is a keyword stub)
- ChapterAdvanceGate review-mode UI
- Node filesystem adapters — implement `StorePort` outside this library if you need `fs`

## Install

**Copy into the host (recommended):** vendor this package under the app (`vendor/novel-engine/`, `packages/novel-engine/`, …), build `dist/`, then import with **relative paths** (or `file:./vendor/novel-engine` to keep the package name). Details: [guide — Install](docs/guide.md#install). Registry `npm install novel-engine` is the other option.

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({ llmEndpoint: "/api/llm" });
const { gaps, readyToWrite } = await kit.inspect({ prompt: "写一本三章短篇" });
```

Package entries: `.` / `./worker` / `./llm` / `./session` / `./kit` / `./kit/worker`. Published `files`: `dist/`, `README.md`, `LICENSE`. Stable surface: [docs/api.md](docs/api.md).

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
