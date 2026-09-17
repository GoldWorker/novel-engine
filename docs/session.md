# Host Session API (`novel-engine/session`) — S0 / S1

[English](session.md) | [中文文档](session.zh-CN.md)

Same-thread host façade for inspecting a book's foundation and switching between books. Import from the **optional** subpath so the default `novel-engine` / `novel-engine/worker` / `novel-engine/llm` bundles stay free of session code.

```ts
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";
```

Package version **0.3.0**. This document covers **S0 + S1 only**.

## Status

| Phase | What | This release |
| --- | --- | --- |
| **S0** | Types, gap table, `foundationMissing` layered-outline fix | Done |
| **S1** | `createNovelSession` read/inspect + `createNovelWorkspace` | Done |
| **S2** | `generateFoundation` / upsert / auto-write (structured LLM) | Not yet |
| **S3** | ChapterRunner / chapter write APIs | Not yet |
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

`llm` is optional in S1 (unused, accepted for S2). Every read is **store read-through** (no Session cache of artifacts).

| Method | Notes |
| --- | --- |
| `bookId` | Host-assigned id. |
| `getFoundation()` | `{ book, premise, outline, layeredOutline, characters, worldRules, audit, progress }` — each field `null` when absent. |
| `getProgress()` | `store.loadProgress()`. |
| `inspectFoundation({ prompt? })` | `{ meta, gaps, readyToWrite, planning }`. `prompt` (or `run_meta` / progress) picks the planning tier for the gap table. |
| `assertReadyToWrite({ prompt? })` | Throws `FoundationIncompleteError` with `gaps` when not ready. |
| `listArtifacts(prefix?)` | `listStorePaths`. |
| `exportSnapshot()` / `importSnapshot(bytes)` | Thin wrappers around the existing book-snapshot APIs. |
| `close()` | Further calls throw `SessionClosedError`. |

**Not in S1:** `upsertFoundation`, `generateFoundation`, `startAutoWrite`, `chapter.*`.

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

## Errors

| Error | When |
| --- | --- |
| `FoundationIncompleteError` | `assertReadyToWrite` — `.gaps` is the inspect table. |
| `SessionClosedError` | Method on a closed session (including after `switchTo`). |
| `WorkspaceClosedError` | Workspace method after `close()`. |
| `BookNotFoundError` | `open` / `switchTo` unknown `bookId`. |

## Coming later

- **S2** — structured LLM `generateFoundation` / upsert / auto-write
- **S3** — ChapterRunner
- **S4** — Worker session bridge

Sketch: [`examples/session-workspace.ts`](../examples/session-workspace.ts).
