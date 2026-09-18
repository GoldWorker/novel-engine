# NovelKit (`novel-engine/kit`)

[English](guide-kit.md) | [中文文档](guide-kit.zh-CN.md)

Out-of-the-box host façade. **Create only** (`NovelKit.create` — no `new` + `init`). The package **ships a ready Worker** (`dist/novel-kit.worker.js`); hosts do not maintain their own worker source.

Session (`novel-engine/session`) remains the reference implementation. Kit is composition + defaults + the shipped worker. Business rules (confirm gate, whole-file replace, `rewriteChapters` default false, no mid-session LLM swap) stay on Session.

Contracts: [api](api.md#optional-novelkit-novel-enginekit). Internals / init handshake: [architecture](architecture.md#kit-worker-init). Copy-paste Session flows: [guide §7–8](guide.md#scenario-session).

Package version **0.5.0**.

## Defaults

| Option | Default | Opt out |
| --- | --- | --- |
| `store` | `"opfs"` | `"memory"` (Node/tests) or a `StorePort` (`runtime: "main"` only) |
| `runtime` | `"worker"` | `"main"` (Node/tests) |
| `workspace` | `true` | `false` — `createBook` / `switchBook` / `listBooks` throw |
| `bookId` | `"default"` | pass any non-empty string |
| `llmEndpoint` | `"/api/llm"` | your BFF route |
| `fallbackToMemory` | `true` | `false` throws `OpfsUnavailableError` when OPFS is missing |

Readonly on the instance: `bookId`, `storeKind` (`"opfs"` \| `"memory"` \| `"custom"`), `runtime`.

## Install

Same vendor / registry options as the [host guide](guide.md#install). Extra subpaths:

```ts
import { NovelKit } from "novel-engine/kit";
// relative dist:
import { NovelKit } from "../../vendor/novel-engine/dist/kit.js";
```

TypeScript `paths` (bundler only): `"novel-engine/kit": ["./vendor/novel-engine/src/kit/index.ts"]`.

The worker artifact is `dist/novel-kit.worker.js` (export `novel-engine/kit/worker`). Packed `files` include all of `dist/`.

## Browser (default OPFS + Worker)

```ts
import { NovelKit } from "novel-engine/kit";

const kit = await NovelKit.create({
  llmEndpoint: "/api/llm", // worker LlmPort.complete → fetch(llmEndpoint). No API keys in the worker.
  // bookId omitted → "default"
});

const { gaps, readyToWrite } = await kit.inspect({ prompt: "写一本三章短篇" });
await kit.fillFoundation({ book: { title: "无主的信", synopsis: "灯塔与潮" } });
const outcome = await kit.startBook({
  prompt: "写一本三章短篇：……",
  generateMissing: true, // may return { status: "needs_foundation", gaps }
});

kit.subscribe((event) => {
  console.log(event.type);
});
kit.dispose(); // closes the session and terminates the worker
```

`llm` is **ignored** in worker mode even if you pass it — the worker always uses `llmEndpoint`. Pass `llm` only for `runtime: "main"`.

Canonical sketch: [`examples/kit-host.ts`](../examples/kit-host.ts).

## Node / tests (main + memory)

`llm` is **required** on `runtime: "main"`.

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

## Shipped worker URL

`NovelKit.create` resolves:

```ts
new URL("./novel-kit.worker.js", import.meta.url); // relative to dist/kit.js
```

That works for vendored / `file:` copies that keep `dist/` together. If a bundler rewrites `import.meta.url` so the worker 404s, copy `node_modules/novel-engine/dist/novel-kit.worker.js` (or `vendor/.../dist/novel-kit.worker.js`) into the host **`public/`** (or equivalent) and pass `workerUrl`:

```ts
await NovelKit.create({
  workerUrl: "/novel-kit.worker.js",
  llmEndpoint: "/api/llm",
});
```

Do **not** hand-write a session worker for Kit. The published file already runs `attachSessionWorker` + `createNovelSession` + OPFS/memory after an **init** handshake (below).

## Worker LLM

On create, main posts **init** (`ns: "kit"`) with `llmEndpoint`, `bookId`, and OPFS options, waits for **ready**, then attaches the existing Session bridge (`ns: "session"`). The worker `LlmPort.complete` is `fetch(llmEndpoint)` with the completion request JSON. Put vendor keys on the BFF, not in the worker.

Init protocol: [architecture](architecture.md#kit-worker-init).

## Scenario methods

Names map 1:1 onto Session (no second copy of the rules):

| Kit | Session |
| --- | --- |
| `inspect` | `inspectFoundation` |
| `assertReady` | `assertReadyToWrite` |
| `fillFoundation` | `upsertFoundation` |
| `generateFoundation` | `generateFoundation` |
| `startBook` | `startAutoWrite` |
| `assessFoundation` | `assessFoundationImpact` |
| `applyFoundation` | `applyFoundationChange` |
| `getChapter` / `writeChapter` / `saveChapter` | `chapter.get` / `write` / `saveFinal` |
| `getMeta` / `getProgress` / `listArtifacts` | `getFoundation` / `getProgress` / `listArtifacts` |
| `createBook` / `switchBook` / `listBooks` | workspace APIs |
| `exportBook` / `importBook` | `exportSnapshot` / `importSnapshot` |
| `subscribe` / `dispose` | `subscribe` / `close` (+ `worker.terminate`) |

Preserved Session behavior:

- Assess a **proposed** patch (`assessFoundation`) **before** apply/upsert.
- `applyFoundation` without `confirmRewrite` returns `{ status: "needs_confirm" }` when severity is `rewrite_needed`. `confirmRewrite: true` never yields `needs_confirm`.
- `characters` / `worldRules` / `outline` / `layeredOutline` are **whole-file replace**.
- `rewriteChapters` default **false** — chapters never auto-rewrite.
- No mid-session LLM swap (worker endpoint is fixed at init).

`startBook` may return `{ status: "needs_foundation" }` without `Engine.run` (default `requireConfirmGaps: true`).

When `workspace: false` (or a custom `StorePort`), multi-book methods throw a clear `KitWorkspaceDisabledError`.

## What Kit is not

- Not a second Engine or a second Session. Underlying Session / Engine / Session worker protocol stay as today.
- Not `novel-engine/worker` (Engine worker). Kit’s worker is `novel-engine/kit/worker`.
- Real OPFS is not required for CI — tests use `runtime: "main"` + `store: "memory"`, plus fake-port init wiring.

Pitfalls (assess-before-apply, whole-file replace, null `getProgress()`): [guide](guide.md#pitfalls).
