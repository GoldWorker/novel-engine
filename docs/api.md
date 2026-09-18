# novel-engine API (0.5.0)

[English](api.md) | [中文文档](api.zh-CN.md)

Stable surface for host apps. Import from `novel-engine` unless noted. The published package only ships `dist/`, `README.md`, and `LICENSE`. Vendored copies import `dist/*.js` by relative path or `"novel-engine": "file:./vendor/novel-engine"` after build — [guide — Install](guide.md#install).

This library is a **pure-frontend ESM SDK**. It does not include UI, React bindings, a Demo SPA, Arbiter full scenes, or ChapterAdvanceGate review UI. Default entries (`.` / `./worker`) do not bundle vendor LLM clients. Optional fetch adapters: [`novel-engine/llm`](llm-adapters.md). Optional out-of-the-box host: [`novel-engine/kit`](guide-kit.md). Optional host session (reference): [`novel-engine/session`](session.md). `src/` never imports `node:fs` / `node:path`.

Host how-to: [guide](guide.md) ([中文](guide.zh-CN.md)) · [kit](guide-kit.md). Internals: [architecture](architecture.md). Docs index: [README](README.md). Runnable sources: [`examples/`](../examples/).

## Package entries

| Subpath | Module | Purpose |
| --- | --- | --- |
| `.` | `dist/index.js` | Engine, `route`, domain types, stores, mocks, main-thread client, book snapshot |
| `./worker` | `dist/worker.js` | `attachEngineWorker` plus Engine / stores / snapshot for a dedicated worker |
| `./llm` | `dist/llm.js` | Optional fetch `LlmPort` adapters (OpenAI, Anthropic, DashScope). Not pulled into `.` or `./worker`. |
| `./session` | `dist/session.js` | Optional same-thread host session (S0–S6 inspect, generate, auto-write, ChapterRunner, foundation impact, Worker bridge, workspace). Not pulled into `.` / `./worker` / `./llm`. |
| `./kit` | `dist/kit.js` | Out-of-the-box `NovelKit.create` (defaults OPFS + Worker). Not pulled into `.` / `./worker` / `./llm` / `./session`. |
| `./kit/worker` | `dist/novel-kit.worker.js` | Shipped kit Dedicated Worker. Init handshake then Session bridge. |

```ts
import { createEngine, createEngineClient } from "novel-engine";
import { attachEngineWorker } from "novel-engine/worker";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
import { NovelKit } from "novel-engine/kit";
```

## Engine

| Export | Kind | Notes |
| --- | --- | --- |
| `createEngine(deps)` | fn | Builds an `Engine`. Required: `store`, `llm`. Optional: `maxSteps` (40), `maxWorkerTurns` (16), `onEvent`. |
| `Engine` | class | Serial loop: load state → `route` → Worker tools → repeat. |
| `EngineError` | class | Invalid `steer` / double-`run`. |
| `EngineDeps` | type | Constructor input. |
| `EngineResult` | type | `{ phase, steps, stoppedReason, lastInstruction, error? }`. |
| `EngineStopReason` | type | `"complete" \| "max_steps" \| "paused" \| "idle"`. |
| `EngineLoopEvent` | type | `step` / `paused` / `resumed` / `steered` / `stopped`. |
| `inferPlanningStub(prompt)` | fn | Keyword stub: `长篇` → long, `中篇`/`分层` → mid, else short. |

`Engine.run({ prompt, maxSteps })` bootstraps Progress, then loops until complete / idle / pause / cap. `pause` / `resume` / `steer` are cooperative (next loop boundary). `steer` persists a decision and sets `flow=steering`.

Same-thread host:

```ts
const engine = createEngine({ store, llm });
await engine.run({ prompt: "写一本三章短篇：……" });
```

Same-thread mocks: [guide §1 (short book)](guide.md#scenario-short-book) and [guide §2 (layered)](guide.md#scenario-layered-book). `route` internals: [architecture](architecture.md#engine-loop-vs-route).

## `route` and domain

| Export | Kind | Notes |
| --- | --- | --- |
| `route(state)` | fn | Pure. Returns `Instruction \| null`. No IO. |
| `State` | type | Explicit snapshot `route` consumes. |
| `Instruction` | type | `{ agent, task, reason, chapter? }`. |
| `Phase` / `PHASES` | type / const | `init` → `premise` → `outline` → `writing` → `complete`. |
| `Flow` / `FLOWS` | type / const | `writing` / `reviewing` / `rewriting` / `polishing` / `steering`. |
| `PlanningTier` / `PLANNING_TIERS` | type / const | `short` / `mid` / `long`. |
| `Progress` | type | Cursor + completed chapters + `layered`. |
| `AgentId` / `AGENTS` | type / const | `architect_short` / `architect_long` / `writer` / `editor`. |
| `canTransitionPhase` / `validatePhaseTransition` / `PhaseTransitionError` | fn / class | Forward-only Phase. |
| `canTransitionFlow` / `validateFlowTransition` / `FlowTransitionError` | fn / class | Illegal Flow jumps fail. |
| `plannerForTier` | fn | short → `architect_short`; mid/long → `architect_long`. |
| `isPlanningTier` | fn | Type guard for `"short" \| "mid" \| "long"`. |
| `latestCompleted` / `nextChapter` / `isResumable` | fn | Progress helpers. |
| `REVIEW_INTERVAL` / `shouldReview` | const / fn | Non-layered global review every 5 chapters. |
| `ArcBoundary` | type | Layered arc/volume-end facts. |

## Ports

| Export | Kind | Notes |
| --- | --- | --- |
| `StorePort` | type | `loadState`, `loadProgress`, `saveProgress`, `read`, `write`, `has`, optional `list`. |
| `LlmPort` | type | `complete(request) → { text, toolCalls? }`. |
| `LlmCompletionRequest` / `LlmCompletionResult` / `LlmToolCall` / `LlmMessage` / `LlmToolSpec` / `LlmRole` | types | Completion wire types. |

Hosts implement `LlmPort` against a gateway or WebLLM, or import optional fetch adapters from [`novel-engine/llm`](llm-adapters.md). Default entries never ship a provider client. **Do not expose raw API keys in a public browser app.**

## Stores

| Export | Kind | Notes |
| --- | --- | --- |
| `MemoryStore` | class | In-memory `StorePort` (path → bytes). `list()` is sync. |
| `OpfsStore` | class | OPFS `StorePort`. `OpfsStore.open(options)` throws `OpfsUnavailableError` if missing. |
| `createOpfsStore(options?)` | fn | OPFS when available; otherwise `MemoryStore` (set `fallbackToMemory: false` to throw). |
| `isOpfsAvailable(storage?)` | fn | `navigator.storage.getDirectory` or an injected fake. |
| `OpfsUnavailableError` | class | Thrown by strict open. |
| `PATHS` | const | Logical layout (`meta/progress.json`, `outline.json`, …). |

`MemoryStore` and `OpfsStore` implement `list()` so snapshot export includes every file. Custom adapters may omit `list`; export then probes the known book layout. Optional `remove(path)` deletes a path (no-op if missing); Session uses it to invalidate a stale foundation audit.

See [guide §3 (OPFS persist)](guide.md#scenario-opfs). Write strategy: [architecture](architecture.md#opfs-write-strategy).

## Book snapshot

| Export | Kind | Notes |
| --- | --- | --- |
| `exportBookSnapshot(store)` | fn | `Promise<Uint8Array>` zip of all store paths (plus a manifest). |
| `importBookSnapshot(store, bytes)` | fn | Restore into `StorePort` (merge; does not delete extra dest files). |
| `SnapshotError` | class | Invalid zip, missing/unknown manifest, path escape. |
| `BOOK_SNAPSHOT_FORMAT` | const | `"novel-engine-book-snapshot"`. |
| `BOOK_SNAPSHOT_VERSION` | const | `1`. |
| `BOOK_SNAPSHOT_MANIFEST_PATH` | const | `.novel-engine-snapshot.json` inside the zip (not written to the store). |
| `BookSnapshotManifest` | type | `{ format, version, files }`. |

Zip is built with [fflate](https://github.com/101arrowz/fflate) (browser build). Temp files matching `.*.tmp` are skipped.

See [guide §5 (book snapshot)](guide.md#scenario-snapshot). Format: [architecture](architecture.md#snapshot-format).

## Mock LLM

| Export | Kind | Notes |
| --- | --- | --- |
| `MockLlm` | class | Scripted `LlmPort`. Exhaustion throws. `MockLlm.fromHandler(fn)` for fixture replay. |
| `ReplayLlm` | class | Pure result-list replay. |
| `MockLlmStep` / `MockLlmHandler` | types | Script entries. |

Tests and the short/layered mock books use these only — no live providers.

## Optional vendor LLM (`novel-engine/llm`)

Not part of `.` or `./worker`. Fetch-based; no `openai` / `@anthropic-ai/sdk` dependency. Guide: [llm-adapters.md](llm-adapters.md) ([中文](llm-adapters.zh-CN.md)). How-to: [guide §6](guide.md#scenario-llm).

| Export | Kind | Notes |
| --- | --- | --- |
| `createOpenAiLlm(options)` | fn | Chat Completions. Default base `https://api.openai.com/v1`. |
| `createAnthropicLlm(options)` | fn | Messages API. Default base `https://api.anthropic.com`. `maxTokens` default 4096. |
| `createDashScopeLlm(options)` | fn | OpenAI-compatible DashScope (`compatible-mode/v1`). Reuses the OpenAI client. |
| `createVendorLlm({ provider, ... })` | fn | `provider`: `"openai"` \| `"anthropic"` \| `"dashscope"`. |
| `LlmAdapterError` | class | HTTP / mapping failures (`status?`, `body?`). |
| `OPENAI_DEFAULT_BASE_URL` / `ANTHROPIC_DEFAULT_BASE_URL` / `DASHSCOPE_COMPAT_BASE_URL` | const | Documented defaults. |
| `LlmAdapterOptions` / `OpenAiLlmOptions` / `AnthropicLlmOptions` / `DashScopeLlmOptions` / `VendorLlmOptions` / `LlmVendor` / `FetchLike` | types | `apiKey`, `model`, optional `baseUrl`, `fetch`, `headers`. |

Tool call `arguments` are always a parsed object. **Do not put API keys in a public browser bundle** — use a BFF in production.

Sketch: [`examples/llm-openai.ts`](../examples/llm-openai.ts).

## Optional host session (`novel-engine/session`)

Not part of `.`, `./worker`, or `./llm`. Same-thread inspect, S2 generate/upsert/auto-write, S3 ChapterRunner, S4 Worker bridge, S5/S6 foundation impact, and multi-book workspace. Contracts: [session.md](session.md) ([中文](session.zh-CN.md)). How-to: [guide §7](guide.md#scenario-session) ([assess](guide.md#scenario-session-impact-assess) · [meta](guide.md#scenario-session-impact-meta) · [forward](guide.md#scenario-session-impact-forward) · [confirm](guide.md#scenario-session-impact-confirm) · [batch](guide.md#scenario-session-impact-batch)) · [guide §8.1](guide.md#scenario-session-worker-impact). Internals: [architecture](architecture.md#session-bridge-session_protocol).

| Export | Kind | Notes |
| --- | --- | --- |
| `createNovelSession({ store, llm?, bookId })` | fn | Same-thread session. `llm` required for S2 generate / auto-write, S3 `chapter.write`, and S6 `rewriteChapters`. |
| `NovelSession` | type | Inspect + `upsertFoundation` / `generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` / `startAutoWrite` / `chapter` / `subscribe` / snapshot wrappers / `close`. |
| `createNovelWorkspace({ createStore, llm?, indexStore? })` | fn | One store per `bookId`. Optional `indexStore` persists `_index.json`. |
| `NovelWorkspace` | type | `createBook` / `open` / `switchTo` / `listBooks` / `close` / `currentBookId`. |
| `createSessionClient(port, { bookId })` | fn | S4 main-thread `NovelSession` over messages. |
| `attachSessionWorker(port, { createSession })` | fn | S4 worker adapter; `createSession` returns a same-thread `NovelSession`. |
| `SESSION_PROTOCOL` / `SESSION_NS` / `isSessionCommand` / `isSessionNotice` | const / fn | Session protocol (`v: 1`, `ns: "session"`). |
| `FoundationMeta` / `FoundationGap` / `InspectResult` / `PlanningInfo` | types | Inspect payload. Gaps include bilingual hints. |
| `FoundationPatch` / `FoundationKey` / `FOUNDATION_KEYS` / `GenerateFoundationOptions` / `StartAutoWriteOptions` / `AutoWriteResult` / `SessionEvent` | types | S2 generate / auto-write. |
| `FoundationImpactAssessment` / `FoundationImpactSeverity` / `FoundationImpactMode` / `FOUNDATION_IMPACT_SEVERITIES` / `FOUNDATION_IMPACT_MODES` / `AssessFoundationImpactOptions` / `ApplyFoundationChangeOptions` / `ApplyFoundationChangeResult` | types / const | S5 assess + S6 apply. Severity: `meta_only` / `forward_only` / `rewrite_needed`. Mode: `none` / `polish` / `rewrite`. |
| `ChapterRunner` / `ChapterView` / `ChapterWriteInput` / `ChapterWriteResult` / `ChapterWriteMode` / `CHAPTER_WRITE_MODES` | type / const | S3 ChapterRunner. Modes: `create` / `continue` / `rewrite` / `polish`. |
| `FoundationIncompleteError` | class | `assertReadyToWrite` — `.gaps`. |
| `SessionLlmRequiredError` / `FoundationGenerateError` | class | Missing `llm`; bad generate JSON / keys. |
| `SessionBusyError` | class | `startAutoWrite` / `chapter.write` / `applyFoundationChange` already in flight (including over the bridge). |
| `ChapterConflictError` / `ChapterRunnerError` | class | Chapter mode precondition; writer loop / `saveFinal` failure. |
| `SessionClosedError` / `WorkspaceClosedError` / `BookNotFoundError` | class | Closed session/workspace; unknown `bookId`. |
| `WORKSPACE_INDEX_PATH` | const | `"_index.json"`. |

`generateFoundation` asks `LlmPort.complete` for **JSON in `text`** (no new tools). On the Worker bridge it runs **in the worker**. `assessFoundationImpact(patch)` evaluates a **proposed** patch — call it **before** apply/upsert. `applyFoundationChange` is a two-step confirm gate for `rewrite_needed` (`confirmRewrite: true` never returns `needs_confirm`). Provided arrays replace the whole file. Chapters rewrite only when `rewriteChapters: true` and mode is `"rewrite"` | `"polish"`. How-to: [guide §7.2a–e](guide.md#scenario-session-impact) · [§8.1](guide.md#scenario-session-worker-impact). Pitfalls: [guide](guide.md#pitfalls). `chapter.write` is a dedicated writer loop (not `Engine.run` / not `pendingRewrites`). Worker `LlmPort` should `fetch` a host BFF.

Sketches: [`examples/session-workspace.ts`](../examples/session-workspace.ts) (same-thread) · [`examples/session-host.ts`](../examples/session-host.ts) (Worker).

<a id="optional-novelkit-novel-enginekit"></a>

## Optional NovelKit (`novel-engine/kit`)

Not part of `.`, `./worker`, `./llm`, or `./session`. Out-of-the-box façade: **`NovelKit.create` only**. Defaults `store: "opfs"` + `runtime: "worker"`. Hosts get a ready worker from the package (`dist/novel-kit.worker.js`). How-to: [guide-kit](guide-kit.md) ([中文](guide-kit.zh-CN.md)). Init handshake: [architecture](architecture.md#kit-worker-init). Session remains the reference API.

| Export | Kind | Notes |
| --- | --- | --- |
| `NovelKit.create(options?)` | fn | Async factory. No public constructor. |
| `NovelKit` | class | Scenario methods wrap Session. Readonly `bookId`, `storeKind`, `runtime`. |
| `NovelKitOptions` | type | `runtime`, `store`, `llm`, `llmEndpoint`, `bookId`, `workerUrl`, `workspace`, `fallbackToMemory`, `opfs`. |
| `KitStoreKind` / `KitRuntime` | type | `"opfs" \| "memory" \| "custom"` / `"worker" \| "main"`. |
| `defaultKitWorkerUrl()` | fn | `new URL("./novel-kit.worker.js", import.meta.url)` relative to `dist/kit.js`. |
| `KIT_PROTOCOL` / `KIT_NS` / `isKitInitCommand` / `isKitNotice` | const / fn | Kit init handshake (`v: 1`, `ns: "kit"`). Distinct from Session. |
| `attachKitWorker(port)` | fn | Worker-side init + session attach (also the shipped worker entry). |
| `KitLlmRequiredError` | class | `runtime: "main"` without `llm`. |
| `KitWorkerError` | class | Missing `Worker`, bad custom store on worker, init timeout. |
| `KitWorkspaceDisabledError` | class | Multi-book methods with `workspace: false` or a custom `StorePort`. |
| `KitClosedError` | class | Calls after `dispose()`. |

`llm` is required for `runtime: "main"`, optional for worker (worker uses `llmEndpoint`; if both are passed, worker uses `llmEndpoint`). `bookId` default `"default"`. OPFS missing → `MemoryStore` when `fallbackToMemory` is true (default).

Sketch: [`examples/kit-host.ts`](../examples/kit-host.ts).

## Worker host

From `novel-engine`:

| Export | Kind | Notes |
| --- | --- | --- |
| `createEngineClient(port)` | fn | Main-thread wrapper over a `Worker` / message port. |
| `EngineClient` | type | `start` / `pause` / `resume` / `steer` / `snapshot` / `onEvent` / `close`. |
| `ENGINE_PROTOCOL` | const | `1`. |
| `isEngineCommand` / `isEngineNotice` / `loopEventToHost` | fn | Protocol guards / mapping. |
| `EngineCommand` / `EngineNotice` / `EngineHostEvent` / `EngineSnapshot` | types | Typed messages. |

From `novel-engine/worker`:

| Export | Kind | Notes |
| --- | --- | --- |
| `attachEngineWorker(port, { createPorts })` | fn | Worker entry. `createPorts` injects `StorePort` + `LlmPort`. |
| `EngineWorkerOptions` / `EngineWorkerPorts` | types | Worker setup. |
| `createEngine`, stores, `MockLlm`, snapshot helpers | re-exports | So the worker bundle does not import the main-thread client. |

Commands: `start`, `steer`, `pause`, `resume`, `snapshot`. Notices: `event`, `snapshot`, `error`.

See [guide §4 (Web Worker)](guide.md#scenario-worker). Protocol: [architecture](architecture.md#engine-worker-protocol-engine_protocol).

## Advanced store helpers

These are exported for hosts that assemble or inspect artifacts, but they are not required to run the Engine:

`readJson`, `writeJson`, `readText`, `writeText`, `readJsonl`, `flattenOutline`, `estimatedChapterCapacity`, `checkArcBoundary`, `completedArcBoundaries`, `assembleNovelContext`, `SLIDING_SUMMARY_WINDOW`, `chapterSummaryPath`, `arcSummaryPath`, `volumeSummaryPath`, `arcReviewPath`, `globalReviewPath`, plus artifact types (`BookMetadata`, `OutlineEntry`, `VolumeOutline`, `Checkpoint`, `DecisionRecord`, …).
