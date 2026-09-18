# novel-engine API (0.7.0)

[English](api.md) | [中文文档](api.zh-CN.md)

Stable surface for host apps. Import from `novel-engine` unless noted. The published package only ships `dist/`, `README.md`, and `LICENSE`. Vendored copies import `dist/*.js` by relative path or `"novel-engine": "file:./vendor/novel-engine"` after build — [guide — Install](guide.md#install).

This library is a **pure-frontend ESM SDK**. It does not include UI, React bindings, a Demo SPA, Arbiter full scenes, or ChapterAdvanceGate review UI. Default entries (`.` / `./worker`) do not bundle vendor LLM clients. Optional fetch adapters: [`novel-engine/llm`](guide.md#scenario-llm). Optional out-of-the-box host: [`novel-engine/kit`](guide.md#scenario-kit). Optional host session (reference): [`novel-engine/session`](#optional-host-session-novel-enginesession). `src/` never imports `node:fs` / `node:path`.

Host how-to: [guide](guide.md) ([中文](guide.zh-CN.md)). Internals: [architecture](architecture.md). Docs index: [README](README.md). Runnable sources: [`examples/`](../examples/).

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

<a id="engine"></a>

## Engine

| Export | Kind | Notes |
| --- | --- | --- |
| `createEngine(deps)` | fn | Builds an `Engine`. Required: `store`, `llm`. Optional: `maxSteps` (40), `maxWorkerTurns` (16), `onEvent`. |
| `Engine` | class | Serial loop: load state → `route` → Worker tools → repeat. |
| `EngineError` | class | Invalid `steer` / double-`run`. |
| `AbortedError` | class | **Added (0.7.0).** `engine.cancel()` / `run({ signal })` abort. Not an `EngineResult` stop reason. |
| `EngineDeps` | type | Constructor input. |
| `EngineResult` | type | `{ phase, steps, stoppedReason, lastInstruction, error? }`. |
| `EngineStopReason` | type | `"complete" \| "max_steps" \| "paused" \| "idle"`. |
| `EngineLoopEvent` | type | `step` / `paused` / `resumed` / `steered` / `stopped`. |
| `inferPlanningStub(prompt)` | fn | Keyword stub: `长篇` → long, `中篇`/`分层` → mid, else short. |

`Engine.run({ prompt, maxSteps, signal? })` bootstraps Progress, then loops until complete / idle / pause / cap. `pause` / `resume` / `steer` are cooperative (next loop boundary). `steer` persists a decision and sets `flow=steering`. **Added (0.7.0):** optional `signal` and `engine.cancel()` abort the in-flight run with `AbortedError` (idle cancel is a no-op). **Compatible:** omitting `signal` matches 0.6.0.

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
| `StorePort` | type | `loadState`, `loadProgress`, `saveProgress`, `read`, `write`, `has`, optional `list` / `remove`. |
| `LlmPort` | type | `complete(request) → { text, toolCalls? }`. Optional `request.signal`. |
| `LlmCompletionRequest` / `LlmCompletionResult` / `LlmToolCall` / `LlmMessage` / `LlmToolSpec` / `LlmRole` | types | Completion wire types. Optional `signal` on the request (**Added 0.7.0**). |
| `LlmError` | class | **Added (0.7.0).** Portable `complete` failure (`status?`, `body?`). Kit `llmEndpoint` fetch throws this. |
| `StoreError` / `StoreRemoveUnsupportedError` | class | **Added (0.7.0).** Store failures hosts hit. `chapter.delete` throws `StoreRemoveUnsupportedError` when `remove` is missing (before progress mutation). |

Hosts implement `LlmPort` against a gateway or WebLLM, or import optional fetch adapters from [`novel-engine/llm`](guide.md#scenario-llm). Default entries never ship a provider client. **Do not expose raw API keys in a public browser app.**

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

<a id="optional-vendor-llm-novel-enginellm"></a>

## Optional vendor LLM (`novel-engine/llm`)

Not part of `.` or `./worker`. Fetch-based; no `openai` / `@anthropic-ai/sdk` dependency. How-to (factories, mapping, BFF): [guide](guide.md#scenario-llm) ([中文](guide.zh-CN.md#scenario-llm)).

| Export | Kind | Notes |
| --- | --- | --- |
| `createOpenAiLlm(options)` | fn | Chat Completions. Default base `https://api.openai.com/v1`. |
| `createAnthropicLlm(options)` | fn | Messages API. Default base `https://api.anthropic.com`. `maxTokens` default 4096. |
| `createDashScopeLlm(options)` | fn | OpenAI-compatible DashScope (`compatible-mode/v1`). Reuses the OpenAI client. |
| `createVendorLlm({ provider, ... })` | fn | `provider`: `"openai"` \| `"anthropic"` \| `"dashscope"`. |
| `LlmAdapterError` | class | HTTP / mapping failures (`status?`, `body?`). **Compatible:** still this class. **Added:** subclass of `LlmError` (also re-exported). |
| `OPENAI_DEFAULT_BASE_URL` / `ANTHROPIC_DEFAULT_BASE_URL` / `DASHSCOPE_COMPAT_BASE_URL` | const | Documented defaults. |
| `LlmAdapterOptions` / `OpenAiLlmOptions` / `AnthropicLlmOptions` / `DashScopeLlmOptions` / `VendorLlmOptions` / `LlmVendor` / `FetchLike` | types | `apiKey`, `model`, optional `baseUrl`, `fetch`, `headers`. |

Tool call `arguments` are always a parsed object. **Do not put API keys in a public browser bundle** — use a BFF in production.

Sketch: [`examples/llm-openai.ts`](../examples/llm-openai.ts).

<a id="optional-host-session-novel-enginesession"></a>

## Optional host session (`novel-engine/session`)

Not part of `.`, `./worker`, or `./llm`. Same-thread inspect, S2 generate/upsert/auto-write, S3 ChapterRunner, S4 Worker bridge, S5/S6 foundation impact, and multi-book workspace. This section is the **Session contract** (methods, errors, S0–S6, protocol). How-to: [guide §7](guide.md#scenario-session) ([assess](guide.md#scenario-session-impact-assess) · [meta](guide.md#scenario-session-impact-meta) · [forward](guide.md#scenario-session-impact-forward) · [confirm](guide.md#scenario-session-impact-confirm) · [batch](guide.md#scenario-session-impact-batch)) · [guide §8.1](guide.md#scenario-session-worker-impact). Internals: [architecture](architecture.md#session-bridge-session_protocol). Kit names wrap these 1:1: [guide](guide.md#scenario-kit).

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

S1–S3 stay on a **same-thread** `NovelSession` (source of truth). **S4** is an adapter over that same object via `postMessage` — not a second copy of the business rules. **S5/S6** live on that same object (and the Worker bridge).

| Export | Kind | Notes |
| --- | --- | --- |
| `createNovelSession({ store, llm?, bookId })` | fn | Same-thread session. `llm` required for S2 generate / auto-write, S3 `chapter.write`, and S6 `rewriteChapters`. |
| `NovelSession` | type | Inspect + generate / apply / auto-write / `chapter` / `pause`/`resume`/`steer` / **Added:** `cancel` / `getRunState` / snapshot / `close`. |
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
| `SessionBusyError` | class | `startAutoWrite` / `chapter.write` / `chapter.delete` / `applyFoundationChange` already in flight (including over the bridge). |
| `AbortedError` | class | **Added (0.7.0).** In-flight cancel / aborted `signal`. Dedicated class; non-abort success paths unchanged. |
| `LlmError` / `StoreError` / `StoreRemoveUnsupportedError` | class | **Added (0.7.0).** LLM complete / store delete failures (Worker-serializable). |
| `SessionRunState` / `SESSION_RUN_STATES` | type / const | **Added (0.7.0).** `"idle" \| "generating_missing" \| "running" \| "paused" \| "busy"`. |
| `ChapterConflictError` / `ChapterRunnerError` | class | Chapter mode precondition; writer loop / `saveFinal` failure. |
| `SessionClosedError` / `WorkspaceClosedError` / `BookNotFoundError` | class | Closed session/workspace; unknown `bookId`. |
| `WORKSPACE_INDEX_PATH` | const | `"_index.json"`. |

`generateFoundation` asks `LlmPort.complete` for **JSON in `text`** (no new tools). On the Worker bridge it runs **in the worker**. `assessFoundationImpact(patch)` evaluates a **proposed** patch — call it **before** apply/upsert. `applyFoundationChange` is a two-step confirm gate for `rewrite_needed` (`confirmRewrite: true` never returns `needs_confirm`). Provided arrays replace the whole file. Chapters rewrite only when `rewriteChapters: true` and mode is `"rewrite"` | `"polish"`. `chapter.write` is a dedicated writer loop (not `Engine.run` / not `pendingRewrites`). Worker `LlmPort` should `fetch` a host BFF.

Sketches: [`examples/session-workspace.ts`](../examples/session-workspace.ts) (same-thread) · [`examples/session-host.ts`](../examples/session-host.ts) (Worker).

### Status (S0–S6)

| Phase | What | This release |
| --- | --- | --- |
| **S0** | Types, gap table, `foundationMissing` layered-outline fix | Done |
| **S1** | `createNovelSession` read/inspect + `createNovelWorkspace` | Done |
| **S2** | `generateFoundation` / upsert / auto-write (structured LLM) | Done |
| **S3** | ChapterRunner / `chapter.get` / `saveFinal` / `write` | Done |
| **S4** | Worker session bridge (`createSessionClient` / `attachSessionWorker`) | Done |
| **S5** | `assessFoundationImpact` (rules-first, optional LLM refine) | Done |
| **S6** | `applyFoundationChange` (assess → confirm → upsert → optional writes) | Done |

### S0 — `foundationMissing`

Mid/long books with a valid non-empty `layered_outline.json` **do not** need a flat `outline.json`. Short books still do. Shared helper: `foundationMissing(store, tier?)` in `src/store/foundation.ts` (Engine / `route` / Session).

Inference order, fingerprint skip, and audit reporting: [architecture](architecture.md#foundationmissing--fingerprint--audit). Host gap UI: [guide §7.1](guide.md#scenario-session-gaps).

### S1 — `NovelSession`

`llm` is optional for inspect-only / S5 heuristics. **S2** `generateFoundation` / `startAutoWrite`, **S3** `chapter.write`, and **S6** `rewriteChapters` require it (`SessionLlmRequiredError` if missing). Every read is **store read-through** (no Session cache of artifacts).

| Method | Notes |
| --- | --- |
| `bookId` | Host-assigned id. |
| `getFoundation()` | `{ book, premise, outline, layeredOutline, characters, worldRules, audit, progress }` — each field `null` when absent. |
| `getProgress()` | `store.loadProgress()`. May be `null` (no `meta/progress.json` yet). |
| `inspectFoundation({ prompt? })` | `{ meta, gaps, readyToWrite, planning, auditOnly }`. `prompt` (or `run_meta` / progress) picks the planning tier for the gap table. |
| `assertReadyToWrite({ prompt? })` | Throws `FoundationIncompleteError` with `gaps` when not ready. |
| `listArtifacts(prefix?)` | `listStorePaths`. |
| `exportSnapshot()` / `importSnapshot(bytes)` | Thin wrappers around the existing book-snapshot APIs. |
| `upsertFoundation(patch)` | Partial write of `book` / `premise` / `outline` / `layeredOutline` / `characters` / `worldRules` (omitted keys unchanged; provided arrays replace the whole file). Invalidates `meta/foundation_audit.json` when fingerprint files change. |
| `generateFoundation({ prompt, keys, mode?, signal? })` | Structured one-shot `LlmPort.complete`; parse JSON from `text`; `upsertFoundation`. **Not** an Engine loop. **Added:** optional `signal`. |
| `assessFoundationImpact(patch, { refineWithLlm? })` | S5: rules-first impact of a **proposed** patch. Optional LLM JSON refine. **Does not mutate**. |
| `applyFoundationChange({ patch, confirmRewrite?, rewriteChapters?, … })` | S6: assess → confirm gate → upsert → optional sequential `chapter.write`. |
| `startAutoWrite({ prompt, foundation?, generateMissing?, requireConfirmGaps?, confirmAuditGap?, maxSteps?, signal? })` | Optional upsert/generate, then either `{ status: "needs_foundation", gaps, meta, auditOnly }` or `createEngine(...).run`. Mutually exclusive with `chapter.write` / `chapter.delete` / `applyFoundationChange` (`SessionBusyError`). **Added:** optional `signal`. **Compatible:** omitting `signal` matches 0.6.0. |
| `pause()` / `resume()` / `steer(note)` | Forward to the Engine held during `startAutoWrite`. `{ status: "ok" \| "idle" }`. `idle` when no Engine is running (no-op). Empty steer throws `EngineError`. Do **not** take the busy flag. |
| `cancel()` | **Added (0.7.0).** Abort in-flight `startAutoWrite` / `generateFoundation` / `chapter.write` (and other busy work). `{ status: "ok" \| "idle" }`. In-flight promise rejects `AbortedError`. Idle is a no-op. Does **not** take the busy flag. |
| `getRunState()` | **Added (0.7.0).** `"idle" \| "generating_missing" \| "running" \| "paused" \| "busy"`. Pure observation. `running`/`paused` ↔ pause/steer would be `ok`. |
| `chapter` | S3 ChapterRunner: `get` / `saveFinal` / `write` / `delete`. Same-thread; not an Engine book Route. |
| `subscribe(listener)` | `foundation_updated` / `auto_write_step` / `chapter_step` / `stopped` / `paused` / `resumed` / `steered`. Returns unsubscribe. |
| `close()` | Further calls throw `SessionClosedError`. |

**Not in S4:** `NovelWorkspace` over Worker (keep workspace on the UI thread, one book session per worker).

`readyToWrite` is `true` iff `foundationMissing` is empty (same audit / writing-phase rule as the Engine).

#### Gaps

```ts
interface FoundationGap {
  key: string;          // foundationMissing key: book | premise | outline | characters | world_rules | foundation_audit
  path: string;         // logical store path
  requiredFor: string;  // "write" | "short" | "mid" | "long"
  hint: string;         // Chinese + short English
  kind: "artifact" | "audit";
}
```

For mid/long, a missing outline gap points at `layered_outline.json` and explains that a flat `outline.json` also satisfies the requirement.

### S2 — generate / upsert / auto-write

`generateFoundation` is a **structured one-shot LLM call + `upsertFoundation`**. It does not run a restricted Engine loop and does not write chapters or drafts. Host how-to: [guide §7.2](guide.md#scenario-session-foundation).

<a id="upsertfoundationpatch"></a>

#### `upsertFoundation(patch)`

Light shape checks, then `writeJson` / `writeText` on existing `PATHS`. **Omitted patch keys stay unchanged.** A provided `characters`, `worldRules`, `outline`, or `layeredOutline` array **replaces the whole file** (omitted names/chapters are deleted, not merged or renamed). `book` / `premise` replace those artifacts when present. Any write to fingerprint files (`book`, `premise`, `outline`, `characters`, `world_rules`, `layered_outline`) **invalidates** `meta/foundation_audit.json` (`StorePort.remove` when implemented; otherwise a cleared audit record). Returns a fresh `getFoundation()`.

#### `generateFoundation({ prompt, keys, mode? })`

- `keys`: subset of `book | premise | outline | layered_outline | characters | world_rules`
- `mode`: `fill_missing` (default) — only keys that `inspectFoundation` still reports as gaps — or `overwrite`
- Requires `llm` on `createNovelSession`
- One `LlmPort.complete` with **no tools**. The model must return a **JSON object in `text`** (optional ` ```json ` fence). Parsed fields are passed to `upsertFoundation`.
- **Added (0.7.0):** optional `signal`. Abort / `session.cancel()` rejects with `AbortedError`. **Compatible:** omitting `signal` matches 0.6.0.
- MockLlm: `{ text: JSON.stringify({ premise: "…", outline: [/* … */] }) }`

#### `startAutoWrite`

1. Optional `foundation` → `upsertFoundation`
2. Optional `generateMissing: true` → `generateFoundation({ prompt, keys: missing, mode: "fill_missing" })`
3. `inspectFoundation({ prompt })`
4. If `requireConfirmGaps !== false` (default **true**) and `gaps.length > 0`:
   - If leftover gaps are **only** `foundation_audit` **and** `confirmAuditGap: true` → proceed to Engine
   - Else → `{ status: "needs_foundation", gaps, meta, auditOnly }` **without** `Engine.run`
5. If ready (or confirm disabled / audit confirmed) → `createEngine({ store, llm }).run({ prompt, maxSteps, signal? })` → `{ status: "completed" | "stopped", result, meta }` (`completed` when `stoppedReason === "complete"`)

**Added (0.7.0):** optional `signal`; `cancel()` aborts generateMissing + Engine.run with `AbortedError` (does **not** add an abort status to `AutoWriteResult`). **Compatible:** without `signal` / `cancel()`, 0.6.0 shapes stand.

`subscribe` emits `foundation_updated` after upsert, `auto_write_step` for each Engine `step`, `paused` / `resumed` / `steered` from the held Engine, `chapter_step` during `chapter.write`, and `stopped` for both needs-foundation and Engine outcomes (not on abort — the promise rejects).

`startAutoWrite`, `chapter.write`, `chapter.delete`, and `applyFoundationChange` share a session busy flag: a second call while one is in flight throws `SessionBusyError`. `pause` / `resume` / `steer` / **`cancel` / `getRunState`** do **not** take that flag (`pause`/`steer` only apply once `Engine.run` has started). See [architecture](architecture.md#busy--session-lifecycle).

### S1 — `NovelWorkspace`

One `StorePort` per `bookId`, injected by the host. How-to: [guide §7.6](guide.md#scenario-session-workspace).

| Method | Notes |
| --- | --- |
| `createBook({ bookId?, title? })` | Allocates an id when omitted. Opens the new book (closes the previous session). |
| `open(bookId)` / `switchTo(bookId)` | Returns the session. Previous session is closed (`SessionClosedError` if reused). Unknown id → `BookNotFoundError`. |
| `listBooks()` | In-memory index; persisted to `_index.json` when `indexStore` is set. |
| `close()` | Closes the current session and the workspace. |
| `currentBookId` | Active book, or `null`. |

The workspace **caches** the first store returned for each `bookId`. Memory tests should still use one `MemoryStore` per book (Map or factory cache). Path-prefix-in-one-store is not the supported convention.

### S3 — ChapterRunner

Single-chapter create / continue / rewrite / polish on the **same-thread** session. Reuses writer tools (`plan_chapter` / `draft_chapter` / `commit_chapter` / `novel_context` / `read_chapter`) from `src/workers/tools.ts`. It does **not** run `Engine.run`, does **not** drive `pendingRewrites`, and is **not** a full-book Route. Distinction: [architecture](architecture.md#chapterrunner-vs-enginerun-vs-pendingrewrites). How-to: [guide §7.3](guide.md#scenario-session-chapter).

| Method | Notes |
| --- | --- |
| `chapter.get(n)` | `{ chapter, plan, draft, final, summary }` from `drafts/NN.*`, `chapters/NN.md`, `summaries/NN.json`. `null` when none exist. |
| `chapter.saveFinal(n, markdown)` | Writes `chapters/NN.md`, updates `progress.completedChapters` / checkpoint. No LLM. |
| `chapter.write({ chapter, mode, instruction?, title?, force?, signal? })` | Dedicated writer loop over `LlmPort` + existing writer tools. Requires `llm`. **Added:** optional `signal`. |
| `chapter.delete(n, { syncOutline? })` | Removes plan/draft/final/summary. Drops `n` from `completedChapters` / `pendingRewrites`; clamps `currentChapter`; `complete` → `writing` if a completed chapter was removed. `totalChapters` unchanged. `syncOutline` upserts outline files without that row (no renumbering; last remaining flat-outline row unsupported). Busy. Reviews (`reviews/*`) are left in place. **Requires `StorePort.remove`** — throws `StoreRemoveUnsupportedError` before mutating progress when absent. MemoryStore / OpfsStore success path unchanged. |

#### Modes

| Mode | Precondition | Behavior |
| --- | --- | --- |
| `create` | No final (unless `force: true`) | `plan_chapter` → `draft_chapter(write)` → `commit_chapter`. Existing final → `ChapterConflictError`. |
| `continue` | Draft present, no final | Resume via `draft_chapter(append)` then commit. |
| `rewrite` | Final present | New plan/draft/commit (`instruction` optional). Overwrites the completed chapter (session override; **not** `pendingRewrites`). |
| `polish` | Final present | Lighter rewrite of the existing final (same tool path, polish-oriented prompt). |

`chapter.write` injects an internal `sessionOverride` only on `plan_chapter` / `commit_chapter` so a completed chapter can be overwritten. Engine sequential saga is unchanged when that flag is absent.

MockLlm: script `toolCalls` (unlike S2 `generateFoundation`, which uses JSON in `text`).

<a id="s4--worker-bridge"></a>

### S4 — Worker bridge

Workbench how-to: [guide §8](guide.md#scenario-session-worker). Wire details: [architecture](architecture.md#session-bridge-session_protocol).

Same-thread `NovelSession` remains the implementation. `attachSessionWorker` constructs one inside the worker; `createSessionClient` is a `NovelSession`-shaped RPC client. **Do not import this from `novel-engine/worker`.**

| Piece | Notes |
| --- | --- |
| `attachSessionWorker(port, { createSession })` | Worker adapter. `createSession` injects `StorePort` + `LlmPort` and returns `createNovelSession(...)`. |
| `createSessionClient(port, { bookId })` | Main-thread `NovelSession`. `bookId` must match the worker session. |
| Protocol | `SESSION_PROTOCOL === 1`, `ns: "session"`. Commands: `inspectFoundation` / `getFoundation` / `getProgress` / `assertReadyToWrite` / `listArtifacts` / `exportSnapshot` / `importSnapshot` / `upsertFoundation` / `generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` / `startAutoWrite` / `pause` / `resume` / `steer` / **`cancel` / `getRunState`** / `chapterGet` / `chapterSaveFinal` / `chapterWrite` / `chapterDelete` / `close`. Notices: `result` / `event` / `error`. **Compatible:** protocol version still `1`; new commands are additive. `AbortSignal` is **not** posted (host `signal` → client sends `cancel`). |
| Busy | Worker-side `SessionBusyError` — `startAutoWrite` / `applyFoundationChange` / `chapter.delete` in flight blocks `chapter.write` across the bridge. `pause` / `resume` / `steer` / `cancel` / `getRunState` are allowed during `startAutoWrite`. |
| Events | Worker forwards `subscribe` events (`foundation_updated` / `auto_write_step` / `chapter_step` / `stopped` / `paused` / `resumed` / `steered`). |
| `generateFoundation` / S5–S6 | **Run in the worker** (the book `StorePort` lives there). |
| `LlmPort` | `fetch` a host BFF. **Do not embed vendor API keys** in a public worker bundle. |

### S5 — `assessFoundationImpact`

Call this on a **proposed** `FoundationPatch` against the current store, **before** `applyFoundationChange` / `upsertFoundation`. Do not assess after the same patch is already written — a second call then typically looks like “no change.” **Rules-first** heuristics are deterministic. When `refineWithLlm: true` and an `LlmPort` is present, a structured one-shot JSON completion may refine the result — it **cannot downgrade** heuristic `severity`.

Host how-to: [guide §7.2a](guide.md#scenario-session-impact-assess).

| Field | Meaning |
| --- | --- |
| `severity` | `meta_only` — title/synopsis-style `meta/book.json` (`BookMetadata` has no tags field). `forward_only` — changes mainly for unwritten future chapters. `rewrite_needed` — character / world / past-plot contradictions with written finals. |
| `suggestedChapters` | Sorted unique written chapters that may need rewrite/polish (`chapters/NN.md` present). |
| `suggestedRanges` | Inclusive compact ranges derived from `suggestedChapters` (e.g. `{ start: 1, end: 3 }`). |
| `suggestedMode` | `none` \| `polish` \| `rewrite`. |
| `reasons` / `notes` | Bilingual strings for the host UI. |
| `changedKeys` | Foundation keys whose content actually differs. |
| `source` | `"heuristics"` or `"llm"`. |

Heuristics look at `meta/*`, `premise.md`, `outline.json`, `layered_outline.json`, `characters.json`, `world_rules.json`, plus written `chapters/` (and mention `drafts/` in notes). This API **must not** mutate the store or rewrite chapters. Host order: `assess(patch)` → optional UI → `applyFoundationChange({ patch, … })`.

### S6 — `applyFoundationChange`

Orchestrates: assess → confirm gate for `rewrite_needed` → `upsertFoundation` → optional sequential `chapter.write` for `suggestedChapters`. Chapters **do not auto-rewrite** — the host must pass `rewriteChapters: true`.

Passing `confirmRewrite: true` **never** returns `needs_confirm`. Two-step host how-to: [guide §7.2d](guide.md#scenario-session-impact-confirm). Kit: `applyFoundation` ([guide](guide.md#scenario-kit)).

| Option | Notes |
| --- | --- |
| `patch` | Same `FoundationPatch` as `upsertFoundation`. Provided `characters` / `worldRules` / `outline` / `layeredOutline` arrays replace the whole file. |
| `requireConfirmRewrite` | Default **true**. When severity is `rewrite_needed` and `confirmRewrite` is not true → `{ status: "needs_confirm" }` with **no writes**. Passing `confirmRewrite: true` never returns `needs_confirm`. |
| `confirmRewrite` | Host acknowledgement of a rewrite-needed patch. Only on the retry after `needs_confirm`. |
| `rewriteChapters` | Default **false**. When true, sequential `chapter.write` (`rewrite` or `polish`) for suggested (or `chapters` override) finals. No-op when `suggestedMode` is `"none"` unless the host also passes `mode`. |
| `mode` | Optional override of `suggestedMode` (`rewrite` \| `polish`). |
| `refineWithLlm` | Forwarded to S5. |

`meta_only` / `forward_only` apply without confirm. Fingerprint files still invalidate `foundation_audit` via `upsertFoundation`. Shares the session busy flag with `startAutoWrite` / `chapter.write`.

Host scenarios: [§7.2a](guide.md#scenario-session-impact-assess) · [§7.2b](guide.md#scenario-session-impact-meta) · [§7.2c](guide.md#scenario-session-impact-forward) · [§7.2d](guide.md#scenario-session-impact-confirm) · [§7.2e](guide.md#scenario-session-impact-batch) · [§8.1](guide.md#scenario-session-worker-impact) · [pitfalls](guide.md#pitfalls).

### Errors

| Error | When |
| --- | --- |
| `FoundationIncompleteError` | `assertReadyToWrite` — `.gaps` is the inspect table. |
| `SessionLlmRequiredError` | `generateFoundation` / Engine `startAutoWrite` / `chapter.write` / `applyFoundationChange({ rewriteChapters: true })` without `llm`. |
| `FoundationGenerateError` | Bad `keys`, or `complete().text` is not a JSON object. |
| `SessionBusyError` | `startAutoWrite`, `chapter.write`, `chapter.delete`, or `applyFoundationChange` while another is in flight (same-thread and over the Worker bridge). |
| `AbortedError` | **Added (0.7.0).** Host called `cancel()` / aborted `signal` during a long task. |
| `LlmError` | **Added (0.7.0).** `LlmPort.complete` / kit `llmEndpoint` HTTP or mapping failure (`status?`, `body?`). |
| `StoreRemoveUnsupportedError` | **Added (0.7.0).** `chapter.delete` when `StorePort.remove` is missing. No progress mutation. |
| `ChapterConflictError` | Mode precondition failed (create on existing final, continue without draft, rewrite/polish without final). |
| `ChapterRunnerError` | Invalid chapter number, empty `saveFinal`, or the writer loop produced no final. |
| `SessionClosedError` | Method on a closed session (including after `switchTo`). |
| `WorkspaceClosedError` | Workspace method after `close()`. |
| `BookNotFoundError` | `open` / `switchTo` unknown `bookId`. |

Workspace-over-Worker is not provided: keep `createNovelWorkspace` on the UI thread and open one session worker per book.

<a id="optional-novelkit-novel-enginekit"></a>

## Optional NovelKit (`novel-engine/kit`)

Not part of `.`, `./worker`, `./llm`, or `./session`. Out-of-the-box façade: **`NovelKit.create` only**. Defaults `store: "opfs"` + `runtime: "worker"`. Hosts get a ready worker from the package (`dist/novel-kit.worker.js`). How-to: [guide](guide.md#scenario-kit) ([中文](guide.zh-CN.md#scenario-kit)). Init handshake: [architecture](architecture.md#kit-worker-init). Session remains the reference API.

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
| Session types | type | Re-exported: `FoundationPatch`, `FoundationMeta`, `InspectResult`, `AutoWriteResult`, `FoundationImpactAssessment`, `ChapterView`, `ChapterWriteInput`, `ChapterWriteResult`, `SessionEvent`, `SessionUnsubscribe`, apply/assess options/results, `BookControlResult`, `ChapterDeleteResult`, … |

`llm` is required for `runtime: "main"`, optional for worker (worker uses `llmEndpoint`; if both are passed, worker uses `llmEndpoint`). `bookId` default `"default"`. OPFS missing → `MemoryStore` when `fallbackToMemory` is true (default).

Kit methods wrap Session 1:1 including `pauseBook` / `resumeBook` / `steerBook`, **`cancelBook` / `getRunState`**, `deleteChapter`, `updateOutline` (upsert, no assess/confirm). `startBook` accepts `confirmAuditGap` and optional `signal`.

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
