# Usage examples

Canonical runnable TypeScript for the **[root README scenario map](../README.md#usage-by-scenario)** ([中文](../README.zh-CN.md#使用场景)).

These files import `novel-engine` / `novel-engine/worker` the way a real app would. They are **documentation** (not part of `npm test`); the supported in-repo mock runs remain `npm test`, `npm run test:short`, and `npm run test:layered`.

Do not duplicate the how-to here — the root README is the hub. This folder is the deep-link target.

[English](README.md) · [简体中文](README.zh-CN.md)

## Files

| Scenario (root README) | File |
| --- | --- |
| [1. Short book to complete](../README.md#scenario-short-book) | [`short-book.ts`](short-book.ts) |
| [2. Layered mid / long book](../README.md#scenario-layered-book) | [`layered-book.ts`](layered-book.ts) |
| [3. Persist in the browser (OPFS)](../README.md#scenario-opfs) | [`opfs-store.ts`](opfs-store.ts) |
| [4. Embed in a Web Worker](../README.md#scenario-worker) | [`engine.worker.ts`](engine.worker.ts) + [`worker-host.ts`](worker-host.ts) |
| [5. Book snapshot export / import](../README.md#scenario-snapshot) | [`snapshot-roundtrip.ts`](snapshot-roundtrip.ts) |
| [6. Inject a real LLM](../README.md#scenario-llm) | [`llm-openai.ts`](llm-openai.ts) |
| [7. Host session](../README.md#scenario-session) | [`session-workspace.ts`](session-workspace.ts) |
| [8. Session over Worker](../README.md#scenario-session-worker) | [`session.worker.ts`](session.worker.ts) + [`session-host.ts`](session-host.ts) |

Worker embed needs **both** files. Replace the `LlmPort` stub in the worker file with a gateway, WebLLM, or `novel-engine/llm` behind a BFF. See [docs/llm-adapters.md](../docs/llm-adapters.md).

Optional typecheck from this repo (path-maps `novel-engine` → `src/`):

```bash
npx tsc -p tsconfig.examples.json
```
