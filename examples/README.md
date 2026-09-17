# Usage examples

Copy-pasteable TypeScript for hosts. These files import `novel-engine` / `novel-engine/worker` the way a real app would. They are **documentation** (not part of `npm test`); the supported in-repo mock runs remain:

```bash
npm test
npm run test:short
npm run test:layered
```

[English](README.md) · [简体中文](README.zh-CN.md)

## Files

| File | What it shows |
| --- | --- |
| [`short-book.ts`](short-book.ts) | `createEngine` + `MemoryStore` + `MockLlm.fromHandler` through a 3-chapter book to `phase=complete`. Also sketches `ReplayLlm`. |
| [`layered-book.ts`](layered-book.ts) | Mid-book `architect_long` path: `layered_outline`, arc-end `save_review` → `save_arc_summary` → `expand_next_arc`, then `complete_book`. |
| [`opfs-store.ts`](opfs-store.ts) | `isOpfsAvailable` / `createOpfsStore` with MemoryStore fallback, plus strict `OpfsStore.open()`. |
| [`engine.worker.ts`](engine.worker.ts) | Dedicated Worker entry (`attachEngineWorker` from `novel-engine/worker`). |
| [`worker-host.ts`](worker-host.ts) | Main-thread `createEngineClient`: `start` / `steer` / `pause` / `resume` / `snapshot`. |
| [`snapshot-roundtrip.ts`](snapshot-roundtrip.ts) | `exportBookSnapshot` / `importBookSnapshot` merge round-trip. |

Optional typecheck from this repo (path-maps `novel-engine` → `src/`):

```bash
npx tsc -p tsconfig.examples.json
```

## How to read / run

1. Install the package in a host (`npm install novel-engine`) or build this repo (`npm run build`) and depend on `dist/`.
2. Copy the file you need. Worker embed needs **both** `engine.worker.ts` (worker thread) and `worker-host.ts` (main thread).
3. Replace the `LlmPort` stub in the worker file with your gateway / WebLLM adapter. This library never talks to a real model.
4. `plan_start` is a keyword stub (no Arbiter LLM): `长篇` → long / `architect_long`; `中篇` or `分层` → mid / `architect_long`; otherwise short / `architect_short`.
5. `MockLlm.fromHandler` is the way to drive a full book: Worker tools echo results back, and `audit_foundation` must reuse the `fingerprint` from `novel_context`. `ReplayLlm` only replays a fixed `{ text, toolCalls? }[]` and will exhaust if the list is short.

Golden fixtures used by tests (same tool names as the examples):

- `fixtures/short-book.json` + `tests/helpers/short-book-llm.ts`
- `fixtures/layered-book.json` + `tests/helpers/layered-book-llm.ts`
