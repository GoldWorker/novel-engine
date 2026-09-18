# Architecture

[English](architecture.md) | [中文文档](architecture.zh-CN.md)

Internals for contributors and deep integrators. Host how-to: [guide](guide.md). Stable exports: [api](api.md).

## Ports & Adapters

```
┌─────────────────────────────────────────────┐
│  Host (browser main thread / Node / tests)  │
│   createEngineClient  →  postMessage        │
└──────────────────────┬──────────────────────┘
                       │ start / steer / pause / resume / snapshot
                       ▼
┌─────────────────────────────────────────────┐
│  Dedicated Worker (`novel-engine/worker`)   │
│  StorePort (OpfsStore | MemoryStore)        │
│  LlmPort  (host-injected)                   │
│  Engine.run → route(state) → Worker tools   │
└─────────────────────────────────────────────┘
```

Same-thread hosts skip the Worker and call `createEngine({ store, llm })` directly. Session (`novel-engine/session`) is a same-thread façade over the same store; its Worker bridge (`createSessionClient` / `attachSessionWorker`) is a second adapter, not a second copy of the rules.

- **`route` is a pure function.** Input is an explicit `State` snapshot. It performs no IO and does not call `StorePort` or `LlmPort`.
- **`StorePort`** loads that snapshot and persists artifacts. Hosts inject `MemoryStore`, `OpfsStore`, IndexedDB, or Node fs *outside* this library.
- **`LlmPort`** runs architect / writer / editor completions (optional structured `toolCalls`). Default entries ship `MockLlm` / `ReplayLlm` only. Optional fetch adapters: `novel-engine/llm`.

`src/` never uses `node:fs` / `node:path`.

## Engine loop vs `route`

`Engine.run` is a serial loop: load state → `route(state)` → Worker tools → persist → repeat, until `complete` / `idle` / `pause` / `maxSteps`.

`route` only chooses the next `Instruction | null`. `null` is valid: the Engine then tries the `plan_start` stub, or stops (`complete` / `idle`).

`plan_start` is a **deterministic keyword stub** (no Arbiter LLM): prompts containing `长篇` pick `architect_long` / `long`; `中篇` or `分层` pick `architect_long` / `mid`; otherwise `architect_short` / `short`. Worker instruction failures retry once, then pause. Identical Route instructions five times also pause (deadlock cap).

`pause` / `steer` take effect **after the current Worker instruction**, not mid-tool. `steer` records a decision and sets `flow=steering` so `route` returns null until `resume()` restores the previous flow.

### How `route` decides

Priority is first-match, matching ainovel-cli `internal/flow/router.go`:

1. `phase === "complete"` → `null`
2. Foundation missing and `planningTier` known → architect fill
3. `pendingRewrites` non-empty → writer rewrite / polish
4. `flow === "reviewing"` → `null`
5. `flow === "steering"` → `null`
6. Aggregate refresh → editor
7. Immediate external feedback → architect
8. Layered arc-end → review / summary / expand / new volume
9. Non-layered global review due → editor
10. Non-layered outline exhausted → architect (`complete_book` / continue)
11. Else → writer next chapter

## StorePort / LlmPort contracts

```ts
interface StorePort {
  loadState(): Promise<State>;
  loadProgress(): Promise<Progress | null>;
  saveProgress(progress: Progress): Promise<void>;
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  has(path: string): Promise<boolean>;
  list?(prefix?: string): readonly string[] | Promise<readonly string[]>;
  remove?(path: string): Promise<void>;
}

interface LlmPort {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
```

`list` is optional: `MemoryStore` / `OpfsStore` implement it so snapshot export packs every file; custom adapters without `list` still export the known book layout via `has()`. `remove` is optional: Session uses it to drop a stale `meta/foundation_audit.json` after fingerprint files change (otherwise it writes a cleared audit record).

`LlmCompletionResult.toolCalls[].arguments` is always a parsed object. Default bundles never ship a vendor client.

## MemoryStore layout / `PATHS`

Logical paths (no filesystem in this library):

| Path | Artifact |
| --- | --- |
| `meta/progress.json` | Cursor, completed chapters, `layered`, `planningTier` |
| `meta/book.json` | Title / synopsis |
| `meta/run_meta.json` | Run metadata including `planningTier` |
| `meta/checkpoints.jsonl` | Checkpoints |
| `meta/decisions.jsonl` | Host steer / decisions |
| `meta/foundation_audit.json` | Foundation audit (fingerprint + issues) |
| `premise.md` | Premise |
| `outline.json` | Flat short-book outline |
| `layered_outline.json` | Volume/arc outline (mid/long) |
| `characters.json` | Character table |
| `world_rules.json` | World-rule table |
| `drafts/NN.plan.json` / `drafts/NN.draft.md` | Chapter plan / draft |
| `chapters/NN.md` | Chapter final |
| `summaries/NN.json` | Chapter summary |
| `summaries/arc-vNNaNN.json` / `summaries/vol-vNN.json` | Arc / volume summaries |
| `reviews/global_N.json` / `reviews/arc_N.json` | Reviews |
| `meta/snapshots/vNNaNN.json` | Character snapshots |

`MemoryStore` is an in-memory path → bytes map. Tests and same-thread hosts use it. Session workspace convention is **one `StorePort` per `bookId`**, not a path-prefix-in-one-store.

## OPFS write strategy

`OpfsStore` writes through a sibling temp file (`.name.tmp`) then `move` (or copy-then-unlink) so a crash mid-write does not truncate the previous artifact. `list()` skips those temp files. Snapshot export also skips `.*.tmp`.

`createOpfsStore()` opens OPFS when `navigator.storage.getDirectory` exists; **otherwise it returns `MemoryStore`** unless `{ fallbackToMemory: false }` (then `OpfsUnavailableError`). Subdirectory default: `novel-engine`.

## Snapshot format

Browser-safe zip of every store path ([fflate](https://github.com/101arrowz/fflate)). Restore is a **merge**: snapshot paths are overwritten; extra files already in the destination stay. Manifest `.novel-engine-snapshot.json` lives **inside the zip only** — it is not written to the store.

- `BOOK_SNAPSHOT_FORMAT === "novel-engine-book-snapshot"`
- `BOOK_SNAPSHOT_VERSION === 1`

Invalid zip / missing or unknown manifest / path escape throws `SnapshotError`. Host how-to: [guide §5](guide.md#scenario-snapshot).

## Engine Worker protocol (`ENGINE_PROTOCOL`)

`ENGINE_PROTOCOL === 1`. Distinct from Session (`ns: "session"`).

Main → worker commands: `start` / `steer` / `pause` / `resume` / `snapshot`.

Worker → main notices: `event` / `snapshot` / `error`.

Event kinds: `started` | `step` | `paused` | `resumed` | `steered` | `stopped`.

`attachEngineWorker` lives on `novel-engine/worker` so bundlers can tree-shake the main-thread client out of the worker. Host how-to: [guide §4](guide.md#scenario-worker).

## Session bridge (`SESSION_PROTOCOL`)

`SESSION_PROTOCOL === 1`, `ns: "session"` — does not collide with Engine `v: 1` commands. Same-thread `NovelSession` remains the implementation; the bridge is an adapter (`createSessionClient` / `attachSessionWorker`). **Do not import this from `novel-engine/worker`.**

Commands (additive S5/S6 included):

`inspectFoundation` | `getFoundation` | `getProgress` | `assertReadyToWrite` | `listArtifacts` | `exportSnapshot` | `importSnapshot` | `upsertFoundation` | `generateFoundation` | `assessFoundationImpact` | `applyFoundationChange` | `startAutoWrite` | `pause` | `resume` | `steer` | `cancel` | `getRunState` | `chapterGet` | `chapterSaveFinal` | `chapterWrite` | `chapterDelete` | `close`

Notices: `result` | `event` | `error`. **Compatible (0.7.0):** `SESSION_PROTOCOL` stays `1`; `cancel` / `getRunState` are additive. `AbortSignal` is not structured-cloned — the client maps host `signal` to a `cancel` RPC.

`generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` **run in the worker** because the book `StorePort` lives there (typically OPFS). A main-thread generate/apply would write a different store.

There is no Workspace-over-Worker: keep `createNovelWorkspace` on the UI thread and open one session worker per book. **Kit** (`novel-engine/kit`) does that composition for you (and ships the worker).

Contracts: [api](api.md#s4--worker-bridge). Host how-to: [guide §8](guide.md#scenario-session-worker). Kit: [guide](guide.md#scenario-kit).

<a id="kit-worker-init"></a>

## Kit worker init (`KIT_PROTOCOL`)

`KIT_PROTOCOL === 1`, `ns: "kit"` — does not collide with Engine or Session. Used **once** before session commands.

Main → worker `init`: `{ v, ns, type: "init", id, bookId, llmEndpoint, store: "opfs" | "memory", fallbackToMemory, opfsDirectory? }`.

Worker → main `ready`: `{ v, ns, type: "ready", id, bookId, storeKind }` or `error`.

Then the existing Session bridge (`SESSION_PROTOCOL`, `ns: "session"`) takes over. The shipped `dist/novel-kit.worker.js` calls `attachKitWorker(self)`: create store + `fetch(llmEndpoint)` `LlmPort`, `createNovelSession`, `attachSessionWorker`. No API keys in the worker. Default `workerUrl` is `new URL("./novel-kit.worker.js", import.meta.url)` next to `dist/kit.js`; copy that file to `public/` if the bundler 404s.

Kit is composition + defaults. It does **not** change Session/Engine protocols.

## Busy / session lifecycle

`startAutoWrite`, `chapter.write`, `chapter.delete`, and `applyFoundationChange` share one session busy flag. A second call while one is in flight throws `SessionBusyError` (same-thread and over the Worker bridge). Worker-side busy means an in-flight `applyFoundationChange` / `startAutoWrite` / `chapter.delete` blocks `chapter.write` across the bridge.

`pause` / `resume` / `steer` do **not** take the busy flag. They forward to the Engine instance held during `startAutoWrite` → `Engine.run`. When no Engine is running they return `{ status: "idle" }`. During `generateMissing` (before `Engine.run`) they are idle. Empty steer notes throw `EngineError`.

**Added (0.7.0):** `cancel()` / `cancelBook()` also skip the busy flag. Idle cancel is `{ status: "idle" }`. An in-flight long task (`startAutoWrite`, `generateFoundation`, `chapter.write`, …) rejects with `AbortedError`, then busy and `runningEngine` are cleared. `getRunState()` is a pure read (`"idle" | "generating_missing" | "running" | "paused" | "busy"`): `running` / `paused` means pause/steer would be `ok`; other states mean they would be `idle`. Optional `signal` on start/generate/write is host opt-in; omitting it matches 0.6.0.

Reads (`getFoundation`, `inspectFoundation`, `assessFoundationImpact`, `chapter.get`, `getRunState`, …) do not take the busy flag. Session does **not** cache artifacts — every read is store read-through.

`close()` / workspace `switchTo` / `open` close the previous session. Reusing the old reference throws `SessionClosedError`.

## `foundationMissing` / fingerprint / audit

Shared helper in `src/store/foundation.ts` (Engine / `route` / Session):

```ts
foundationMissing(store: StorePort, tier?: PlanningTier): Promise<string[]>
```

- Mid/long with a valid non-empty `layered_outline.json` (volume/arc shape accepted by `parseLayeredVolumes`) **do not** need a flat `outline.json`. Short books still do.
- When `tier` is omitted, scale is inferred: `meta/run_meta.json` `planningTier` → `progress.planningTier` → `progress.layered` → a valid layered outline (treated as mid) → **short**.
- Empty or invalid `layered_outline.json` does **not** satisfy the outline requirement.
- `foundation_audit` is reported only when the other artifacts exist and `progress.phase` is not `writing` or `complete`.

Fingerprint: a missing `outline.json` is skipped when a valid layered outline is present, so `audit_foundation` / `novel_context` still work for layered-only stores.

`upsertFoundation` / `applyFoundationChange` **invalidate** `meta/foundation_audit.json` when any fingerprint file changes (`book`, `premise`, `outline`, `characters`, `world_rules`, `layered_outline`): `StorePort.remove` when implemented, otherwise a cleared audit record.

Provided `characters` / `worldRules` / `outline` / `layeredOutline` arrays **replace the whole JSON file**. Omitted patch keys stay unchanged. See [api](api.md#upsertfoundationpatch) and [guide pitfalls](guide.md#pitfalls).

## ChapterRunner vs `Engine.run` vs `pendingRewrites`

| Path | What it is | What it is not |
| --- | --- | --- |
| `Engine.run` / `startAutoWrite` (when ready) | Full-book Route loop (`route` → Worker tools) | Single-chapter rewrite API |
| `session.chapter.write` | Dedicated writer loop reusing `plan_chapter` / `draft_chapter` / `commit_chapter` | `Engine.run`; does **not** drive `pendingRewrites` |
| `pendingRewrites` | Engine Route queue for rewrite/polish after review | Session ChapterRunner |
| `applyFoundationChange({ rewriteChapters: true })` | After upsert, sequential `chapter.write` for suggested finals | Auto-rewrite; default `rewriteChapters` is false; no-op when `suggestedMode === "none"` unless host passes `mode` |

`chapter.write` injects an internal `sessionOverride` only on `plan_chapter` / `commit_chapter` so a completed chapter can be overwritten. Engine sequential saga is unchanged when that flag is absent.

## Packaging (`exports` / local consume)

Host how-to: [guide — Install](guide.md#install).

`package.json` `exports` map the public subpaths to **built** files (not `src/`):

| Subpath | JS | Types |
| --- | --- | --- |
| `.` | `dist/index.js` | `dist/index.d.ts` |
| `./worker` | `dist/worker.js` | `dist/worker.d.ts` |
| `./llm` | `dist/llm.js` | `dist/llm.d.ts` |
| `./session` | `dist/session.js` | `dist/session.d.ts` |
| `./kit` | `dist/kit.js` | `dist/kit.d.ts` |
| `./kit/worker` | `dist/novel-kit.worker.js` | `dist/novel-kit.worker.d.ts` |
| `./package.json` | `package.json` | — |

Hosts that **copy** this tree into `vendor/novel-engine/` (etc.) import `dist/*.js` by relative path, or keep the package name with `"novel-engine": "file:./vendor/novel-engine"` after `npm install && npm run build` in the copy. `src/*.ts` is not an `exports` condition; bundlers may compile it via `tsconfig` `paths` (see the guide). Node cannot execute the TypeScript tree (`.js` specifiers in `.ts` files).

`files` for `npm pack` / registry: `dist/`, `README.md`, `LICENSE` (`dist/` is gitignored — `npm run build` is required). ESM only (`"type": "module"`). `fflate` stays external on `.` / `./worker` / `./session` / `./kit` so hosts resolve it from `node_modules`. The shipped `./kit/worker` bundle inlines `fflate` so a `public/` copy of `novel-kit.worker.js` does not need a bare specifier inside a Dedicated Worker.


