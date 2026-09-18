# Usage examples

Canonical runnable TypeScript for the **[host guide](../docs/guide.md)** ([中文](../docs/guide.zh-CN.md)). The root [README](../README.md) is the product landing (out-of-the-box Kit, usage scenarios, this folder); internals live in [architecture](../docs/architecture.md).

These files import `novel-engine` / `novel-engine/worker` the way a real app would. They are **documentation** (not part of `npm test`); the supported in-repo mock runs remain `npm test`, `npm run test:short`, and `npm run test:layered`.

Do not duplicate the how-to here — the guide is the hub. This folder is the deep-link target.

[English](README.md) · [简体中文](README.zh-CN.md)

## Files

| Scenario (guide) | File |
| --- | --- |
| [0. NovelKit (recommended)](../docs/guide.md#scenario-kit) | [`kit-host.ts`](kit-host.ts) |
| [1. Short book to complete](../docs/guide.md#scenario-short-book) | [`short-book.ts`](short-book.ts) |
| [2. Layered mid / long book](../docs/guide.md#scenario-layered-book) | [`layered-book.ts`](layered-book.ts) |
| [3. Persist in the browser (OPFS)](../docs/guide.md#scenario-opfs) | [`opfs-store.ts`](opfs-store.ts) |
| [4. Embed in a Web Worker](../docs/guide.md#scenario-worker) | [`engine.worker.ts`](engine.worker.ts) + [`worker-host.ts`](worker-host.ts) |
| [5. Book snapshot export / import](../docs/guide.md#scenario-snapshot) | [`snapshot-roundtrip.ts`](snapshot-roundtrip.ts) |
| [6. Inject a real LLM](../docs/guide.md#scenario-llm) | [`llm-openai.ts`](llm-openai.ts) |
| [7. Host session](../docs/guide.md#scenario-session) | [`session-workspace.ts`](session-workspace.ts) (incl. [7.2a–7.2e](../docs/guide.md#scenario-session-impact) assess / apply) |
| [8. Session over Worker](../docs/guide.md#scenario-session-worker) | [`session.worker.ts`](session.worker.ts) + [`session-host.ts`](session-host.ts) (incl. [8.1](../docs/guide.md#scenario-session-worker-impact)) |

Worker embed needs **both** files. Replace the `LlmPort` stub in the worker file with a gateway, WebLLM, or `novel-engine/llm` behind a BFF. See [guide — LLM adapters](../docs/guide.md#scenario-llm).

Optional typecheck from this repo (path-maps `novel-engine` → `src/`):

```bash
npx tsc -p tsconfig.examples.json
```
