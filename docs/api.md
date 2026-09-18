# novel-engine API (0.4.0)

[English](api.md) | [中文文档](api.zh-CN.md)

Stable surface for host apps. Import from `novel-engine` unless noted. The published package only ships `dist/`, `README.md`, and `LICENSE`.

This library is a **pure-frontend ESM SDK**. It does not include UI, React bindings, a Demo SPA, Arbiter full scenes, or ChapterAdvanceGate review UI. Default entries (`.` / `./worker`) do not bundle vendor LLM clients. Optional fetch adapters: [`novel-engine/llm`](llm-adapters.md). Optional host session: [`novel-engine/session`](session.md). `src/` never imports `node:fs` / `node:path`.

Host how-to is grouped by scenario in the [root README](../README.md#usage-by-scenario) ([中文](../README.zh-CN.md#使用场景)). Runnable sources: [`examples/`](../examples/).

## Package entries

| Subpath | Module | Purpose |
| --- | --- | --- |
| `.` | `dist/index.js` | Engine, `route`, domain types, stores, mocks, main-thread client, book snapshot |
| `./worker` | `dist/worker.js` | `attachEngineWorker` plus Engine / stores / snapshot for a dedicated worker |
| `./llm` | `dist/llm.js` | Optional fetch `LlmPort` adapters (OpenAI, Anthropic, DashScope). Not pulled into `.` or `./worker`. |
| `./session` | `dist/session.js` | Optional same-thread host session (S0–S6 inspect, generate, auto-write, ChapterRunner, foundation impact, Worker bridge, workspace). Not pulled into `.` / `./worker` / `./llm`. |

```ts
import { createEngine, createEngineClient } from "novel-engine";
import { attachEngineWorker } from "novel-engine/worker";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
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

Same-thread mocks: [scenario 1 (short book)](../README.md#scenario-short-book) and [scenario 2 (layered)](../README.md#scenario-layered-book).

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

See [scenario 3 (OPFS persist)](../README.md#scenario-opfs).

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

See [scenario 5 (book snapshot)](../README.md#scenario-snapshot).

## Mock LLM

| Export | Kind | Notes |
| --- | --- | --- |
| `MockLlm` | class | Scripted `LlmPort`. Exhaustion throws. `MockLlm.fromHandler(fn)` for fixture replay. |
| `ReplayLlm` | class | Pure result-list replay. |
| `MockLlmStep` / `MockLlmHandler` | types | Script entries. |

Tests and the short/layered mock books use these only — no live providers.

## Optional vendor LLM (`novel-engine/llm`)

Not part of `.` or `./worker`. Fetch-based; no `openai` / `@anthropic-ai/sdk` dependency. Guide: [llm-adapters.md](llm-adapters.md) ([中文](llm-adapters.zh-CN.md)). Scenario: [README §6](../README.md#scenario-llm).

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

Not part of `.`, `./worker`, or `./llm`. Same-thread inspect, S2 generate/upsert/auto-write, S3 ChapterRunner, S4 Worker bridge, S5/S6 foundation impact, and multi-book workspace. Guide: [session.md](session.md) ([中文](session.zh-CN.md)). Scenarios: [README §7](../README.md#scenario-session) ([assess only](../README.md#scenario-session-impact-assess) · [meta-only](../README.md#scenario-session-impact-meta) · [forward-only](../README.md#scenario-session-impact-forward) · [confirm gate](../README.md#scenario-session-impact-confirm) · [batch rewrite](../README.md#scenario-session-impact-batch)) · [README §8.1](../README.md#scenario-session-worker-impact).

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

`generateFoundation` asks `LlmPort.complete` for **JSON in `text`** (no new tools). On the Worker bridge it runs **in the worker** (the book store lives there). `fill_missing` (default) only upserts keys that are still gaps. `assessFoundationImpact(patch)` evaluates a **proposed** patch against the current store — call it **before** `applyFoundationChange` / `upsertFoundation`; a second assess after the same content is already written typically looks like “no change.” `applyFoundationChange` is a two-step confirm gate for `rewrite_needed`: apply without `confirmRewrite`, then retry with `confirmRewrite: true` if `status === "needs_confirm"`. Passing `confirmRewrite: true` never returns `needs_confirm`. Provided `characters` / `worldRules` / `outline` / `layeredOutline` arrays **replace the whole file**. Chapters rewrite only when `rewriteChapters: true` and `mode` (or `suggestedMode`) is `"rewrite"` | `"polish"` — `suggestedMode === "none"` is a no-op unless the host also passes `mode`. Host how-to: [README §7.2a–7.2e](../README.md#scenario-session-impact) · [§8.1](../README.md#scenario-session-worker-impact). `chapter.write` is a dedicated writer loop (MockLlm `toolCalls`); it does not run `Engine.run` or drive `pendingRewrites`. Worker `LlmPort` should `fetch` a host BFF — **do not embed vendor keys**.

Sketches: [`examples/session-workspace.ts`](../examples/session-workspace.ts) (same-thread) · [`examples/session-host.ts`](../examples/session-host.ts) (Worker).

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

See [scenario 4 (Web Worker)](../README.md#scenario-worker).

## Advanced store helpers

These are exported for hosts that assemble or inspect artifacts, but they are not required to run the Engine:

`readJson`, `writeJson`, `readText`, `writeText`, `readJsonl`, `flattenOutline`, `estimatedChapterCapacity`, `checkArcBoundary`, `completedArcBoundaries`, `assembleNovelContext`, `SLIDING_SUMMARY_WINDOW`, `chapterSummaryPath`, `arcSummaryPath`, `volumeSummaryPath`, `arcReviewPath`, `globalReviewPath`, plus artifact types (`BookMetadata`, `OutlineEntry`, `VolumeOutline`, `Checkpoint`, `DecisionRecord`, …).
