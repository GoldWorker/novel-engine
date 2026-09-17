# Host Session API (`novel-engine/session`) — S0 / S1 / S2 / S3

[English](session.md) | [中文文档](session.zh-CN.md)

Same-thread host façade for inspecting a book's foundation and switching between books. Import from the **optional** subpath so the default `novel-engine` / `novel-engine/worker` / `novel-engine/llm` bundles stay free of session code.

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

Package version **0.3.0**. This document covers **S0 + S1 + S2 + S3**.

## Status

| Phase | What | This release |
| --- | --- | --- |
| **S0** | Types, gap table, `foundationMissing` layered-outline fix | Done |
| **S1** | `createNovelSession` read/inspect + `createNovelWorkspace` | Done |
| **S2** | `generateFoundation` / upsert / auto-write (structured LLM) | Done |
| **S3** | ChapterRunner / `chapter.get` / `saveFinal` / `write` | Done |
| **S4** | Worker session bridge | Not yet |

S1–S3 stay on a **same-thread** `NovelSession`. Do not look for a Worker-backed session here.

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

`llm` is optional for inspect-only. **S2** `generateFoundation` / `startAutoWrite` and **S3** `chapter.write` require it (`SessionLlmRequiredError` if missing). Every read is **store read-through** (no Session cache of artifacts).

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
| `startAutoWrite({ prompt, foundation?, generateMissing?, requireConfirmGaps?, maxSteps? })` | Optional upsert/generate, then either `{ status: "needs_foundation" }` or `createEngine(...).run`. Mutually exclusive with `chapter.write` (`SessionBusyError`). |
| `chapter` | S3 ChapterRunner: `get` / `saveFinal` / `write`. Same-thread; not an Engine book Route. |
| `subscribe(listener)` | `foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`. Returns unsubscribe. |
| `close()` | Further calls throw `SessionClosedError`. |

**Not in S3:** Worker session bridge (S4).

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

`startAutoWrite` and `chapter.write` share a session busy flag: a second call while one is in flight throws `SessionBusyError`.

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

## Errors

| Error | When |
| --- | --- |
| `FoundationIncompleteError` | `assertReadyToWrite` — `.gaps` is the inspect table. |
| `SessionLlmRequiredError` | `generateFoundation` / Engine `startAutoWrite` / `chapter.write` without `llm`. |
| `FoundationGenerateError` | Bad `keys`, or `complete().text` is not a JSON object. |
| `SessionBusyError` | `startAutoWrite` or `chapter.write` while the other (or itself) is in flight. |
| `ChapterConflictError` | Mode precondition failed (create on existing final, continue without draft, rewrite/polish without final). |
| `ChapterRunnerError` | Invalid chapter number, empty `saveFinal`, or the writer loop produced no final. |
| `SessionClosedError` | Method on a closed session (including after `switchTo`). |
| `WorkspaceClosedError` | Workspace method after `close()`. |
| `BookNotFoundError` | `open` / `switchTo` unknown `bookId`. |

## Coming later

- **S4** — Worker session bridge

Sketch: [`examples/session-workspace.ts`](../examples/session-workspace.ts).
