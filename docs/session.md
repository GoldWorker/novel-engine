# Session API (`novel-engine/session`) — S0–S6

[English](session.md) | [中文文档](session.zh-CN.md)

Reference and implementation notes for the optional host session. **Copy-paste host flows:** [guide §7–8](guide.md#scenario-session) ([中文](guide.zh-CN.md#scenario-session)). Internals (busy flag, fingerprint, protocols): [architecture](architecture.md). Export table: [api](api.md).

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

Mid/long books with a valid non-empty `layered_outline.json` **do not** need a flat `outline.json`. Short books still do. Shared helper: `foundationMissing(store, tier?)` in `src/store/foundation.ts` (Engine / `route` / Session).

Inference order, fingerprint skip, and audit reporting: [architecture](architecture.md#foundationmissing--fingerprint--audit). Host gap UI: [guide §7.1](guide.md#scenario-session-gaps).

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
| `getProgress()` | `store.loadProgress()`. May be `null` (no `meta/progress.json` yet). |
| `inspectFoundation({ prompt? })` | `{ meta, gaps, readyToWrite, planning }`. `prompt` (or `run_meta` / progress) picks the planning tier for the gap table. |
| `assertReadyToWrite({ prompt? })` | Throws `FoundationIncompleteError` with `gaps` when not ready. |
| `listArtifacts(prefix?)` | `listStorePaths`. |
| `exportSnapshot()` / `importSnapshot(bytes)` | Thin wrappers around the existing book-snapshot APIs. |
| `upsertFoundation(patch)` | Partial write of `book` / `premise` / `outline` / `layeredOutline` / `characters` / `worldRules` (omitted keys unchanged; provided arrays replace the whole file). Invalidates `meta/foundation_audit.json` when fingerprint files change. |
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

`generateFoundation` is a **structured one-shot LLM call + `upsertFoundation`**. It does not run a restricted Engine loop and does not write chapters or drafts. Host how-to: [guide §7.2](guide.md#scenario-session-foundation).

### `upsertFoundation(patch)`

```ts
await session.upsertFoundation({
  book: { title: "无主的信", synopsis: "……" },
  premise: "……",
  outline: [{ chapter: 1, title: "风暴之后", summary: "……" }], // whole-file replace
  characters: [{ name: "林守" }], // whole-file replace; omitted names are deleted
  worldRules: [{ name: "信与潮", description: "……" }], // whole-file replace
});
```

Light shape checks, then `writeJson` / `writeText` on existing `PATHS`. **Omitted patch keys stay unchanged.** A provided `characters`, `worldRules`, `outline`, or `layeredOutline` array **replaces the whole file** (omitted names/chapters are deleted, not merged or renamed). `book` / `premise` replace those artifacts when present. Any write to fingerprint files (`book`, `premise`, `outline`, `characters`, `world_rules`, `layered_outline`) **invalidates** `meta/foundation_audit.json` (`StorePort.remove` when implemented; otherwise a cleared audit record). Returns a fresh `getFoundation()`.

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

`startAutoWrite`, `chapter.write`, and `applyFoundationChange` share a session busy flag: a second call while one is in flight throws `SessionBusyError`. See [architecture](architecture.md#busy--session-lifecycle).

## S1 — `NovelWorkspace`

One `StorePort` per `bookId`, injected by the host. How-to: [guide §7.6](guide.md#scenario-session-workspace).

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

Single-chapter create / continue / rewrite / polish on the **same-thread** session. Reuses writer tools (`plan_chapter` / `draft_chapter` / `commit_chapter` / `novel_context` / `read_chapter`) from `src/workers/tools.ts`. It does **not** run `Engine.run`, does **not** drive `pendingRewrites`, and is **not** a full-book Route. Distinction: [architecture](architecture.md#chapterrunner-vs-enginerun-vs-pendingrewrites). How-to: [guide §7.3](guide.md#scenario-session-chapter).

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

Workbench how-to: [guide §8](guide.md#scenario-session-worker). Wire details: [architecture](architecture.md#session-bridge-session_protocol).

Same-thread `NovelSession` remains the implementation. `attachSessionWorker` constructs one inside the worker; `createSessionClient` is a `NovelSession`-shaped RPC client. **Do not import this from `novel-engine/worker`.**

| Piece | Notes |
| --- | --- |
| `attachSessionWorker(port, { createSession })` | Worker adapter. `createSession` injects `StorePort` + `LlmPort` and returns `createNovelSession(...)`. |
| `createSessionClient(port, { bookId })` | Main-thread `NovelSession`. `bookId` must match the worker session. |
| Protocol | `SESSION_PROTOCOL === 1`, `ns: "session"`. Commands: `inspectFoundation` / `getFoundation` / `getProgress` / `assertReadyToWrite` / `listArtifacts` / `exportSnapshot` / `importSnapshot` / `upsertFoundation` / `generateFoundation` / `assessFoundationImpact` / `applyFoundationChange` / `startAutoWrite` / `chapterGet` / `chapterSaveFinal` / `chapterWrite` / `close`. Notices: `result` / `event` / `error`. |
| Busy | Worker-side `SessionBusyError` — `startAutoWrite` / `applyFoundationChange` in flight blocks `chapter.write` across the bridge. |
| `generateFoundation` / S5–S6 | **Run in the worker** (the book `StorePort` lives there). |
| `LlmPort` | `fetch` a host BFF. **Do not embed vendor API keys** in a public worker bundle. |
| Events | Worker forwards `subscribe` events (`foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`). |

Sketch: [`examples/session.worker.ts`](../examples/session.worker.ts) + [`examples/session-host.ts`](../examples/session-host.ts).

## S5 — `assessFoundationImpact`

Call this on a **proposed** `FoundationPatch` against the current store, **before** `applyFoundationChange` / `upsertFoundation`. Do not assess after the same patch is already written — a second call then typically looks like “no change.” **Rules-first** heuristics are deterministic. When `refineWithLlm: true` and an `LlmPort` is present, a structured one-shot JSON completion may refine the result — it **cannot downgrade** heuristic `severity`.

Host how-to: [guide §7.2a](guide.md#scenario-session-impact-assess).

```ts
const assessment = await session.assessFoundationImpact({
  book: { title: "无主的信（修订）", synopsis: "……" },
  characters: [{ name: "林深", role: "主角" }], // whole-file replace; 林守 is removed
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

Heuristics look at `meta/*`, `premise.md`, `outline.json`, `layered_outline.json`, `characters.json`, `world_rules.json`, plus written `chapters/` (and mention `drafts/` in notes). This API **must not** mutate the store or rewrite chapters. Host order: `assess(patch)` → optional UI → `applyFoundationChange({ patch, … })`.

## S6 — `applyFoundationChange`

Orchestrates: assess → confirm gate for `rewrite_needed` → `upsertFoundation` → optional sequential `chapter.write` for `suggestedChapters`. Chapters **do not auto-rewrite** — the host must pass `rewriteChapters: true`.

Passing `confirmRewrite: true` **never** returns `needs_confirm`. Two-step host how-to: [guide §7.2d](guide.md#scenario-session-impact-confirm).

```ts
let outcome = await session.applyFoundationChange({
  patch: { premise: "……", characters: [{ name: "林深" }] }, // whole-file replace
});
if (outcome.status === "needs_confirm") {
  // show outcome.assessment.reasons in the UI — store unchanged
  outcome = await session.applyFoundationChange({
    patch: { premise: "……", characters: [{ name: "林深" }] },
    confirmRewrite: true,
    // rewriteChapters: true only when the host opts in to sync chapters
  });
}
// outcome.status === "applied"
// outcome.assessment / outcome.meta / outcome.writes
```

| Option | Notes |
| --- | --- |
| `patch` | Same `FoundationPatch` as `upsertFoundation`. Provided `characters` / `worldRules` / `outline` / `layeredOutline` arrays replace the whole file. |
| `requireConfirmRewrite` | Default **true**. When severity is `rewrite_needed` and `confirmRewrite` is not true → `{ status: "needs_confirm" }` with **no writes**. Passing `confirmRewrite: true` never returns `needs_confirm`. |
| `confirmRewrite` | Host acknowledgement of a rewrite-needed patch. Only on the retry after `needs_confirm`. |
| `rewriteChapters` | Default **false**. When true, sequential `chapter.write` (`rewrite` or `polish`) for suggested (or `chapters` override) finals. No-op when `suggestedMode` is `"none"` unless the host also passes `mode`. |
| `mode` | Optional override of `suggestedMode` (`rewrite` \| `polish`). |
| `refineWithLlm` | Forwarded to S5. |

`meta_only` / `forward_only` apply without confirm. Fingerprint files still invalidate `foundation_audit` via `upsertFoundation`. Shares the session busy flag with `startAutoWrite` / `chapter.write`.

### Host scenarios

| Job | Guide |
| --- | --- |
| Assess only (no write) | [§7.2a](guide.md#scenario-session-impact-assess) |
| Meta-only apply | [§7.2b](guide.md#scenario-session-impact-meta) |
| Forward-only | [§7.2c](guide.md#scenario-session-impact-forward) |
| `rewrite_needed` + `needs_confirm` gate | [§7.2d](guide.md#scenario-session-impact-confirm) |
| Batch `chapter.write` after confirm | [§7.2e](guide.md#scenario-session-impact-batch) |
| Same flows over `createSessionClient` | [§8.1](guide.md#scenario-session-worker-impact) |
| Pitfalls | [guide pitfalls](guide.md#pitfalls) |

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
