# Host Session API (`novel-engine/session`) — S0–S6

[English](session.md) | [中文文档](session.zh-CN.md)

Same-thread host façade for inspecting a book's foundation and switching between books. Import from the **optional** subpath so the default `novel-engine` / `novel-engine/worker` / `novel-engine/llm` bundles stay free of session code.

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

Package version **0.4.0**. This document covers **S0–S6**.

## Status

| Phase | What | This release |
| --- | --- | --- |
| **S0** | Types, gap table, `foundationMissing` layered-outline fix | Done |
| **S1** | `createNovelSession` read/inspect + `createNovelWorkspace` | Done |
| **S2** | `generateFoundation` / upsert / auto-write (structured LLM) | Done |
| **S3** | ChapterRunner / `chapter.get` / `saveFinal` / `write` | Done |
| **S4** | Worker session bridge (`createSessionClient` / `attachSessionWorker`) | Done |
| **S5** | `assessFoundationImpact` (rules-first, optional LLM refine) | Done |
| **S6** | `applyFoundationChange` (assess → confirm → upsert → optional writes) | Done |

S1–S3 stay on a **same-thread** `NovelSession` (source of truth). **S4** is an adapter over that same object via `postMessage` — not a second copy of the business rules. **S5/S6** live on that same object (and the Worker bridge).

## S0 — `foundationMissing`

Mid/long books with a valid non-empty `layered_outline.json` (volume/arc shape accepted by `parseLayeredVolumes`) **do not** need a flat `outline.json`. Short books still do.

The helper lives in `src/store/foundation.ts` (Engine / `route` / Session share it):

```ts
foundationMissing(store: StorePort, tier?: PlanningTier): Promise<string[]>
```

- Pass `tier` when the host already knows the scale (`inspectFoundation({ prompt })` does this via `inferPlanningStub`).
- When `tier` is omitted, scale is inferred in order: `meta/run_meta.json` `planningTier` → `progress.planningTier` → `progress.layered` → a valid layered outline (treated as mid) → **short**.
- Empty or invalid `layered_outline.json` does **not** satisfy the outline requirement.
- `world_rules` / `characters` / `book` / `premise` / `foundation_audit` are unchanged. `foundation_audit` is reported only when the other artifacts exist and `progress.phase` is not `writing` or `complete`.

Fingerprint: a missing `outline.json` is skipped when a valid layered outline is present, so `audit_foundation` / `novel_context` still work for layered-only stores.

## S1 — `NovelSession`

```ts
import { MemoryStore } from "novel-engine";
import { createNovelSession } from "novel-engine/session";

const store = new MemoryStore();
const session = await createNovelSession({ store, llm, bookId: "letter" });

await session.getFoundation();
await session.inspectFoundation({ prompt: "写一本分层中篇：……" });
await session.assertReadyToWrite();
```

`llm` is optional for inspect-only / S5 heuristics. **S2** `generateFoundation` / `startAutoWrite`, **S3** `chapter.write`, and **S6** `rewriteChapters` require it (`SessionLlmRequiredError` if missing). Every read is **store read-through** (no Session cache of artifacts).

| Method | Notes |
| --- | --- |
| `bookId` | Host-assigned id. |
| `getFoundation()` | `{ book, premise, outline, layeredOutline, characters, worldRules, audit, progress }` — each field `null` when absent. |
| `getProgress()` | `store.loadProgress()`. |
| `inspectFoundation({ prompt? })` | `{ meta, gaps, readyToWrite, planning }`. `prompt` (or `run_meta` / progress) picks the planning tier for the gap table. |
| `assertReadyToWrite({ prompt? })` | Throws `FoundationIncompleteError` with `gaps` when not ready. |
| `listArtifacts(prefix?)` | `listStorePaths`. |
| `exportSnapshot()` / `importSnapshot(bytes)` | Thin wrappers around the existing book-snapshot APIs. |
| `upsertFoundation(patch)` | Partial write of `book` / `premise` / `outline` / `layeredOutline` / `characters` / `worldRules`. Invalidates `meta/foundation_audit.json` when fingerprint files change. |
| `generateFoundation({ prompt, keys, mode? })` | Structured one-shot `LlmPort.complete`; parse JSON from `text`; `upsertFoundation`. **Not** an Engine loop. |
| `assessFoundationImpact(patch, { refineWithLlm? })` | S5: rules-first impact of a **proposed** patch. Optional LLM JSON refine. **Does not mutate**. |
| `applyFoundationChange({ patch, confirmRewrite?, rewriteChapters?, … })` | S6: assess → confirm gate → upsert → optional sequential `chapter.write`. |
| `startAutoWrite({ prompt, foundation?, generateMissing?, requireConfirmGaps?, maxSteps? })` | Optional upsert/generate, then either `{ status: "needs_foundation" }` or `createEngine(...).run`. Mutually exclusive with `chapter.write` / `applyFoundationChange` (`SessionBusyError`). |
| `chapter` | S3 ChapterRunner: `get` / `saveFinal` / `write`. Same-thread; not an Engine book Route. |
| `subscribe(listener)` | `foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`. Returns unsubscribe. |
| `close()` | Further calls throw `SessionClosedError`. |

**Not in S4:** `NovelWorkspace` over Worker (keep workspace on the UI thread, one book session per worker).

`readyToWrite` is `true` iff `foundationMissing` is empty (same audit / writing-phase rule as the Engine).

### Gaps

```ts
interface FoundationGap {
  key: string;          // foundationMissing key: book | premise | outline | characters | world_rules | foundation_audit
  path: string;         // logical store path
  requiredFor: string;  // "write" | "short" | "mid" | "long"
  hint: string;         // Chinese + short English
}
```

For mid/long, a missing outline gap points at `layered_outline.json` and explains that a flat `outline.json` also satisfies the requirement.

## S2 — generate / upsert / auto-write

`generateFoundation` is a **structured one-shot LLM call + `upsertFoundation`**. It does not run a restricted Engine loop and does not write chapters or drafts.

### `upsertFoundation(patch)`

```ts
await session.upsertFoundation({
  book: { title: "无主的信", synopsis: "……" },
  premise: "……",
  outline: [{ chapter: 1, title: "风暴之后", summary: "……" }],
  characters: [{ name: "林守" }],
  worldRules: [{ name: "信与潮", description: "……" }],
});
```

Light shape checks, then `writeJson` / `writeText` on existing `PATHS`. Any write to fingerprint files (`book`, `premise`, `outline`, `characters`, `world_rules`, `layered_outline`) **invalidates** `meta/foundation_audit.json` (`StorePort.remove` when implemented; otherwise a cleared audit record). Returns a fresh `getFoundation()`.

### `generateFoundation({ prompt, keys, mode? })`

- `keys`: subset of `book | premise | outline | layered_outline | characters | world_rules`
- `mode`: `fill_missing` (default) — only keys that `inspectFoundation` still reports as gaps — or `overwrite`
- Requires `llm` on `createNovelSession`
- One `LlmPort.complete` with **no tools**. The model must return a **JSON object in `text`** (optional ` ```json ` fence). Parsed fields are passed to `upsertFoundation`.
- MockLlm: `{ text: JSON.stringify({ premise: "…", outline: [/* … */] }) }`

### `startAutoWrite`

```ts
const outcome = await session.startAutoWrite({
  prompt: "写一本三章短篇：……",
  foundation: { book: { title: "无主的信", synopsis: "……" } },
  generateMissing: true,
  requireConfirmGaps: true, // default
  maxSteps: 20,
});
```

1. Optional `foundation` → `upsertFoundation`
2. Optional `generateMissing: true` → `generateFoundation({ prompt, keys: missing, mode: "fill_missing" })`
3. `inspectFoundation({ prompt })`
4. If `requireConfirmGaps !== false` (default **true**) and `gaps.length > 0` → `{ status: "needs_foundation", gaps, meta }` **without** `Engine.run`
5. If ready (or confirm disabled) → `createEngine({ store, llm }).run({ prompt, maxSteps })` → `{ status: "completed" | "stopped", result, meta }` (`completed` when `stoppedReason === "complete"`)

`subscribe` emits `foundation_updated` after upsert, `auto_write_step` for each Engine `step`, `chapter_step` during `chapter.write`, and `stopped` for both needs-foundation and Engine outcomes.

`startAutoWrite`, `chapter.write`, and `applyFoundationChange` share a session busy flag: a second call while one is in flight throws `SessionBusyError`.

## S1 — `NovelWorkspace`

One `StorePort` per `bookId`, injected by the host:

```ts
const stores = new Map<string, MemoryStore>();
const ws = createNovelWorkspace({
  createStore(bookId) {
    const existing = stores.get(bookId);
    if (existing) return existing;
    const store = new MemoryStore();
    stores.set(bookId, store);
    return store;
  },
  // indexStore: optional StorePort for `_index.json`
});

await ws.createBook({ bookId: "a", title: "无主的信" });
await ws.open("a");
await ws.switchTo("b");
await ws.listBooks();
await ws.close();
```

| Method | Notes |
| --- | --- |
| `createBook({ bookId?, title? })` | Allocates an id when omitted. Opens the new book (closes the previous session). |
| `open(bookId)` / `switchTo(bookId)` | Returns the session. Previous session is closed (`SessionClosedError` if reused). Unknown id → `BookNotFoundError`. |
| `listBooks()` | In-memory index; persisted to `_index.json` when `indexStore` is set. |
| `close()` | Closes the current session and the workspace. |
| `currentBookId` | Active book, or `null`. |

The workspace **caches** the first store returned for each `bookId`. Memory tests should still use one `MemoryStore` per book (Map or factory cache). Path-prefix-in-one-store is not the supported convention.

## S3 — ChapterRunner

Single-chapter create / continue / rewrite / polish on the **same-thread** session. Reuses writer tools (`plan_chapter` / `draft_chapter` / `commit_chapter` / `novel_context` / `read_chapter`) from `src/workers/tools.ts`. It does **not** run `Engine.run`, does **not** drive `pendingRewrites`, and is **not** a full-book Route.

```ts
const view = await session.chapter.get(1);
await session.chapter.saveFinal(1, "# 风暴之后\n\n……");
const written = await session.chapter.write({
  chapter: 1,
  mode: "create", // or continue | rewrite | polish
  title: "风暴之后",
  instruction: "灯塔视角",
});
```

| Method | Notes |
| --- | --- |
| `chapter.get(n)` | `{ chapter, plan, draft, final, summary }` from `drafts/NN.*`, `chapters/NN.md`, `summaries/NN.json`. `null` when none exist. |
| `chapter.saveFinal(n, markdown)` | Writes `chapters/NN.md`, updates `progress.completedChapters` / checkpoint. No LLM. |
| `chapter.write({ chapter, mode, instruction?, title?, force? })` | Dedicated writer loop over `LlmPort` + existing writer tools. Requires `llm`. |

### Modes

| Mode | Precondition | Behavior |
| --- | --- | --- |
| `create` | No final (unless `force: true`) | `plan_chapter` → `draft_chapter(write)` → `commit_chapter`. Existing final → `ChapterConflictError`. |
| `continue` | Draft present, no final | Resume via `draft_chapter(append)` then commit. |
| `rewrite` | Final present | New plan/draft/commit with `instruction`. Overwrites the completed chapter (session override; **not** `pendingRewrites`). |
| `polish` | Final present | Lighter rewrite of the existing final (same tool path, polish-oriented prompt). |

`chapter.write` injects an internal `sessionOverride` only on `plan_chapter` / `commit_chapter` so a completed chapter can be overwritten. Engine sequential saga is unchanged when that flag is absent.

MockLlm: script `toolCalls` (unlike S2 `generateFoundation`, which uses JSON in `text`).

## S4 — Worker bridge

For a workbench UI: run `startAutoWrite` / `chapter.write` off the main thread, and keep vendor API keys out of the worker.

Same-thread `NovelSession` remains the implementation. `attachSessionWorker` constructs one inside the worker; `createSessionClient` is a `NovelSession`-shaped RPC client (mirrors `createEngineClient`). **Do not import this from `novel-engine/worker`** — that entry stays Engine-only so default Engine workers do not pull session.

```ts
// session.worker.ts
import { createOpfsStore } from "novel-engine/worker";
import { attachSessionWorker, createNovelSession } from "novel-engine/session";

attachSessionWorker(self, {
  async createSession() {
    const store = await createOpfsStore();
    const llm = {
      complete: (request) =>
        fetch("/api/llm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }).then((res) => res.json()),
    };
    return createNovelSession({ store, llm, bookId: "letter" });
  },
});

// main thread
import { createSessionClient } from "novel-engine/session";

const worker = new Worker(new URL("./session.worker.ts", import.meta.url), { type: "module" });
const session = createSessionClient(worker, { bookId: "letter" });
await session.inspectFoundation({ prompt: "写一本三章短篇" });
await session.startAutoWrite({ prompt: "……", generateMissing: true });
await session.chapter.write({ chapter: 1, mode: "create" });
```

| Piece | Notes |
| --- | --- |
| `attachSessionWorker(port, { createSession })` | Worker adapter. `createSession` injects `StorePort` + `LlmPort` and returns `createNovelSession(...)`. |
| `createSessionClient(port, { bookId })` | Main-thread `NovelSession`. `bookId` must match the worker session. |
| Protocol | `SESSION_PROTOCOL === 1`, `ns: "session"` (does not collide with Engine `v: 1` commands). Additive S5/S6 commands: `assessFoundationImpact` / `applyFoundationChange`. Commands → `result` / `event` / `error`. |
| Busy | Worker-side `SessionBusyError` — `startAutoWrite` / `applyFoundationChange` in flight blocks `chapter.write` across the bridge. |
| `generateFoundation` | **Runs in the worker** (not on the UI thread) because the book `StorePort` lives there (typically OPFS). A main-thread generate would write a different store. |
| `LlmPort` | `fetch` a host BFF. **Do not embed vendor API keys** in a public worker bundle. No Next.js code ships in this package. |
| Events | Worker forwards `subscribe` events (`foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`). |

Sketch: [`examples/session.worker.ts`](../examples/session.worker.ts) + [`examples/session-host.ts`](../examples/session-host.ts).

## S5 — `assessFoundationImpact`

Before rewriting chapters after a foundation change, ask the session how wide the blast radius is. **Rules-first** heuristics are deterministic (MemoryStore tests, no LLM). When `refineWithLlm: true` and an `LlmPort` is present, a structured one-shot JSON completion may refine the result — it **cannot downgrade** heuristic `severity`. Real providers are never required (`MockLlm` in tests).

```ts
const assessment = await session.assessFoundationImpact({
  book: { title: "无主的信（修订）", synopsis: "……" },
  characters: [{ name: "林深", role: "主角" }],
});
// assessment.severity: "meta_only" | "forward_only" | "rewrite_needed"
```

| Field | Meaning |
| --- | --- |
| `severity` | `meta_only` — title/tags/synopsis-style `meta/book.json`. `forward_only` — changes mainly for unwritten future chapters. `rewrite_needed` — character / world / past-plot contradictions with written finals. |
| `suggestedChapters` | Sorted unique written chapters that may need rewrite/polish (`chapters/NN.md` present). |
| `suggestedRanges` | Inclusive compact ranges derived from `suggestedChapters` (e.g. `{ start: 1, end: 3 }`). |
| `suggestedMode` | `none` \| `polish` \| `rewrite`. |
| `reasons` / `notes` | Bilingual strings for the host UI. |
| `changedKeys` | Foundation keys whose content actually differs. |
| `source` | `"heuristics"` or `"llm"`. |

Heuristics look at `meta/*`, `premise.md`, `outline.json`, `layered_outline.json`, `characters.json`, `world_rules.json`, plus written `chapters/` (and mention `drafts/` in notes). Mid-story foundation upsert/generate remains allowed anytime; this API only **assesses**. It **must not** mutate the store or rewrite chapters.

## S6 — `applyFoundationChange`

Orchestrates: assess → confirm gate for `rewrite_needed` → `upsertFoundation` → optional sequential `chapter.write` for `suggestedChapters`. Reuses S2/S3 APIs. Chapters **do not auto-rewrite** — the host must pass `rewriteChapters: true`.

```ts
const outcome = await session.applyFoundationChange({
  patch: { premise: "……", characters: [{ name: "林深" }] },
  confirmRewrite: true,     // required when severity is rewrite_needed (default gate)
  rewriteChapters: true,    // host opt-in; default false
  instruction: "按新设定对齐本章",
});

if (outcome.status === "needs_confirm") {
  // show outcome.assessment.reasons in the UI, then retry with confirmRewrite: true
  return;
}
// outcome.status === "applied"
// outcome.assessment / outcome.meta / outcome.writes
```

| Option | Notes |
| --- | --- |
| `patch` | Same `FoundationPatch` as `upsertFoundation`. |
| `requireConfirmRewrite` | Default **true**. When severity is `rewrite_needed` and `confirmRewrite` is not true → `{ status: "needs_confirm" }` with **no writes**. |
| `confirmRewrite` | Host acknowledgement of a rewrite-needed patch. |
| `rewriteChapters` | Default **false**. When true, sequential `chapter.write` (`rewrite` or `polish`) for suggested (or `chapters` override) finals. |
| `mode` | Optional override of `suggestedMode` (`rewrite` \| `polish`). |
| `refineWithLlm` | Forwarded to S5. |

`meta_only` / `forward_only` apply without confirm. Fingerprint files still invalidate `foundation_audit` via `upsertFoundation`. Shares the session busy flag with `startAutoWrite` / `chapter.write`.

## Errors

| Error | When |
| --- | --- |
| `FoundationIncompleteError` | `assertReadyToWrite` — `.gaps` is the inspect table. |
| `SessionLlmRequiredError` | `generateFoundation` / Engine `startAutoWrite` / `chapter.write` / `applyFoundationChange({ rewriteChapters: true })` without `llm`. |
| `FoundationGenerateError` | Bad `keys`, or `complete().text` is not a JSON object. |
| `SessionBusyError` | `startAutoWrite`, `chapter.write`, or `applyFoundationChange` while another is in flight (same-thread and over the Worker bridge). |
| `ChapterConflictError` | Mode precondition failed (create on existing final, continue without draft, rewrite/polish without final). |
| `ChapterRunnerError` | Invalid chapter number, empty `saveFinal`, or the writer loop produced no final. |
| `SessionClosedError` | Method on a closed session (including after `switchTo`). |
| `WorkspaceClosedError` | Workspace method after `close()`. |
| `BookNotFoundError` | `open` / `switchTo` unknown `bookId`. |

## Coming later

Workspace-over-Worker is not provided: keep `createNovelWorkspace` on the UI thread and open one session worker per book.

Sketches: [`examples/session-workspace.ts`](../examples/session-workspace.ts) (same-thread) · [`examples/session-host.ts`](../examples/session-host.ts) (Worker).
