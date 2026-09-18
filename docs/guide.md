# Host guide

[English](guide.md) | [中文文档](guide.zh-CN.md)

How-to for host apps. Copy a snippet, then open the linked `examples/*.ts` for the full runnable file. Internals (`route`, protocols, store layout): [architecture](architecture.md). Contracts: [api](api.md) · [session](session.md). Docs index: [README](README.md).

`examples/` is documentation — not part of `npm test`. In-repo mock runs: `npm run test:short` and `npm run test:layered`.

## Getting started

Same-thread Engine with `MemoryStore` + `MockLlm`:

```ts
import { createEngine, MemoryStore, MockLlm, inferPlanningStub } from "novel-engine";

const prompt = "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。";
const planning = inferPlanningStub(prompt); // short / architect_short
const engine = createEngine({
  store: new MemoryStore(),
  llm: MockLlm.fromHandler(shortBookHandler), // copy from examples/short-book.ts
  maxSteps: 20,
});
const result = await engine.run({ prompt });
```

Same-thread Session (optional `novel-engine/session`):

```ts
import { MemoryStore } from "novel-engine";
import { createNovelSession } from "novel-engine/session";

const session = await createNovelSession({
  store: new MemoryStore(),
  llm, // optional for inspect / S5 heuristics
  bookId: "letter",
});
const { gaps, readyToWrite } = await session.inspectFoundation({ prompt: "写一本三章短篇" });
```

`plan_start` is a keyword stub: `长篇` → long, `中篇`/`分层` → mid, else short. Vendor keys belong on a BFF — see [Security](#security).

## Engine scenarios

| Scenario | When | Source |
| --- | --- | --- |
| [1. Short book](#scenario-short-book) | Same-thread mock through `phase=complete` | [`short-book.ts`](../examples/short-book.ts) |
| [2. Layered mid / long](#scenario-layered-book) | Volume/arc outline | [`layered-book.ts`](../examples/layered-book.ts) |
| [3. OPFS persist](#scenario-opfs) | Keep artifacts across reloads | [`opfs-store.ts`](../examples/opfs-store.ts) |
| [4. Engine Worker](#scenario-worker) | Loop off the UI thread | [`engine.worker.ts`](../examples/engine.worker.ts) + [`worker-host.ts`](../examples/worker-host.ts) |
| [5. Book snapshot](#scenario-snapshot) | Zip / merge-restore a store | [`snapshot-roundtrip.ts`](../examples/snapshot-roundtrip.ts) |
| [6. Real LLM adapters](#scenario-llm) | OpenAI / Anthropic / DashScope via BFF | [`llm-openai.ts`](../examples/llm-openai.ts) |

Scenarios compose: the Worker example already calls `createOpfsStore()`; snapshot works with any `StorePort`.

<a id="scenario-short-book"></a>

### 1. Short book to complete

**When:** Node tests or a same-thread host. Scripted `LlmPort` fills foundation, writes three chapters, stops at `complete`.

Each `complete()` must return Worker `toolCalls`; `audit_foundation` must reuse the `fingerprint` from `novel_context`. `ReplayLlm` only replays a fixed `{ text, toolCalls? }[]` and does not inspect the request — a short list throws when exhausted.

Full handler: [`examples/short-book.ts`](../examples/short-book.ts). In-repo: `npm run test:short`.

```ts
import {
  createEngine,
  MemoryStore,
  MockLlm,
  ReplayLlm,
  inferPlanningStub,
} from "novel-engine";

const prompt = "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。";
const planning = inferPlanningStub(prompt);
const store = new MemoryStore();
const llm = MockLlm.fromHandler(shortBookHandler); // copy from examples/short-book.ts
const engine = createEngine({ store, llm, maxSteps: 20 });
const result = await engine.run({ prompt });
// result.stoppedReason === "complete" | "idle" | "paused" | "max_steps"

const replay = new ReplayLlm([
  {
    text: "save book",
    toolCalls: [
      { id: "1", name: "save_book", arguments: { title: "无主的信", synopsis: "……" } },
    ],
  },
]);
```

<a id="scenario-layered-book"></a>

### 2. Layered mid / long book

**When:** Volume/arc structure instead of a flat outline.

Same injection as scenario 1 — only prompt keywords and tool names change. `architect_long` tools: `save_foundation(type=layered_outline|append_volume|complete_book)`, `expand_next_arc`. Editor: `save_review`, `save_arc_summary`, `save_volume_summary`. `novel_context` is a sliding window of chapter summaries plus arc/volume summaries when present.

The layered fixture is one volume / two arcs. After two expanded chapters, Route hits arc-end: editor `save_review` → `save_arc_summary` → `expand_next_arc`. After the second arc it writes a volume summary, then `complete_book`.

Full handler: [`examples/layered-book.ts`](../examples/layered-book.ts). In-repo: `npm run test:layered`.

```ts
import { createEngine, MemoryStore, MockLlm, inferPlanningStub } from "novel-engine";

const prompt =
  "写一本分层中篇：一座海上灯塔里住着守塔人林守。一卷两弧，先写接灯，再写离岸归来。";
const planning = inferPlanningStub(prompt);
// planning.tier === "mid", planning.planner === "architect_long"

const engine = createEngine({
  store: new MemoryStore(),
  llm: MockLlm.fromHandler(layeredBookHandler), // copy from examples/layered-book.ts
  maxSteps: 40,
});
const result = await engine.run({ prompt });
```

<a id="scenario-opfs"></a>

### 3. Persist in the browser (OPFS)

**When:** A browser host must keep artifacts across reloads. Node, insecure contexts, and older browsers have no OPFS.

`isOpfsAvailable()` checks `navigator.storage.getDirectory` (or an injected fake). `createOpfsStore()` opens `OpfsStore` when OPFS exists; **otherwise it returns `MemoryStore`**. Memory is ephemeral. Hosts that must persist should check the capability, call `OpfsStore.open()` (throws `OpfsUnavailableError`), or pass `{ fallbackToMemory: false }`.

Atomic write strategy: [architecture](architecture.md#opfs-write-strategy). This library never uses `node:fs`.

Full setup: [`examples/opfs-store.ts`](../examples/opfs-store.ts).

```ts
import {
  createOpfsStore,
  isOpfsAvailable,
  MemoryStore,
  OpfsStore,
  OpfsUnavailableError,
  type StorePort,
} from "novel-engine";

export async function openStoreWithFallback(): Promise<StorePort> {
  if (!isOpfsAvailable()) {
    return new MemoryStore();
  }
  return createOpfsStore(); // OpfsStore | MemoryStore
}

export async function openPersistedStore(): Promise<OpfsStore> {
  try {
    return await OpfsStore.open(); // subdirectory "novel-engine"
  } catch (err) {
    if (err instanceof OpfsUnavailableError) throw err;
    throw err;
  }
}

export async function openOrThrow(): Promise<StorePort> {
  return createOpfsStore({ fallbackToMemory: false });
}
```

<a id="scenario-worker"></a>

### 4. Embed in a Web Worker

**When:** The Engine loop should not block the UI thread.

The worker bundle is a **separate entry**. Host-owned worker file: inject your `LlmPort` there. Prefer a BFF in production ([scenario 6](#scenario-llm)). `pause` / `steer` take effect after the current Worker instruction.

Protocol overview: [architecture](architecture.md#engine-worker-protocol-engine_protocol). Full pair: [`examples/engine.worker.ts`](../examples/engine.worker.ts) + [`examples/worker-host.ts`](../examples/worker-host.ts). Copy **both**.

Worker module:

```ts
import { attachEngineWorker, createOpfsStore } from "novel-engine/worker";
import type { LlmPort } from "novel-engine/worker";

const llm: LlmPort = {
  async complete() {
    // gateway / WebLLM / novel-engine/llm behind a BFF — see scenario 6
    return { text: "", toolCalls: [] };
  },
};

attachEngineWorker(self, {
  async createPorts() {
    const store = await createOpfsStore();
    return { store, llm, maxSteps: 40 };
  },
});
```

Main thread:

```ts
import { createEngineClient, ENGINE_PROTOCOL } from "novel-engine";

const worker = new Worker(new URL("./engine.worker.js", import.meta.url), {
  type: "module",
});
const engine = createEngineClient(worker);

engine.onEvent((event) => {
  // event.kind: started | step | paused | resumed | steered | stopped
});

const result = await engine.start({
  prompt: "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。",
  maxSteps: 40,
});
await engine.pause();
await engine.steer("把结局改成和解");
await engine.resume();
const snap = await engine.snapshot();
console.log(result.stoppedReason, snap.paused, snap.running, ENGINE_PROTOCOL);
engine.close();
```

<a id="scenario-snapshot"></a>

### 5. Book snapshot export / import

**When:** Backup, transfer, or hydrate a book tree between stores (Memory ↔ OPFS, or a custom `StorePort`).

Restore is a merge: snapshot paths are overwritten; extra destination files stay. Format internals: [architecture](architecture.md#snapshot-format). Full round-trip: [`examples/snapshot-roundtrip.ts`](../examples/snapshot-roundtrip.ts).

```ts
import {
  BOOK_SNAPSHOT_FORMAT,
  BOOK_SNAPSHOT_VERSION,
  exportBookSnapshot,
  importBookSnapshot,
  MemoryStore,
  SnapshotError,
} from "novel-engine";

const source = new MemoryStore();
await source.write("meta/note.txt", "keep-me-source");
await source.write("chapters/01.md", "蜡封的瓶子");

const bytes = await exportBookSnapshot(source); // Uint8Array zip (PK magic)

const dest = new MemoryStore({ "extra/host.json": "{\"ok\":true}" });
try {
  await importBookSnapshot(dest, bytes); // merge
} catch (err) {
  if (err instanceof SnapshotError) throw err;
  throw err;
}
// dest has chapters/01.md from the snapshot; extra/host.json is kept
```

<a id="scenario-llm"></a>

### 6. Inject a real LLM (`novel-engine/llm`)

**When:** A trusted Node host, Electron, or a **server BFF** needs a real `LlmPort`. Not for shipping raw API keys in a public SPA.

Optional subpath. Fetch-based OpenAI, Anthropic, and DashScope adapters. No `openai` / `@anthropic-ai/sdk` packages. Details: [llm-adapters.md](llm-adapters.md). Sketch: [`examples/llm-openai.ts`](../examples/llm-openai.ts).

```ts
import { createEngine, MemoryStore } from "novel-engine";
import { createOpenAiLlm, createVendorLlm } from "novel-engine/llm";

const llm = createOpenAiLlm({
  apiKey: "sk-replace-me", // BFF / trusted host env — never a public SPA
  model: "gpt-4o-mini",
});
// createAnthropicLlm({ apiKey, model: "claude-sonnet-4-20250514" })
// createDashScopeLlm({ apiKey, model: "qwen-plus" })
// createVendorLlm({ provider: "dashscope", apiKey, model: "qwen-plus" })

const engine = createEngine({ store: new MemoryStore(), llm });
await engine.run({ prompt: "写一本三章短篇：……" });
```

## Session host flows

Optional `novel-engine/session`. Same-thread inspect, generate, mid-story foundation change (assess → confirm → apply), single-chapter write, multi-book workspace. Off-thread: [scenario 8](#scenario-session-worker).

Contracts and errors: [session.md](session.md). Sketch: [`examples/session-workspace.ts`](../examples/session-workspace.ts).

```ts
import { MemoryStore } from "novel-engine";
import { createNovelSession, createNovelWorkspace } from "novel-engine/session";

const store = new MemoryStore();
const session = await createNovelSession({ store, llm, bookId: "letter" });
```

`generateFoundation` is **one-shot JSON in `LlmPort.complete().text`**, not an Engine loop. `chapter.write` is a **dedicated writer loop** (not `Engine.run` / not `pendingRewrites`). `assessFoundationImpact` is **rules-first** and does not mutate. `applyFoundationChange` never auto-rewrites chapters unless `rewriteChapters: true`.

<a id="scenario-session"></a>
<a id="scenario-session-gaps"></a>

### 7.1 Inspect gaps before auto-write

Keep `requireConfirmGaps: true` (default). If anything is missing, `startAutoWrite` returns early with `needs_foundation` and does **not** run the Engine — use `gaps[].hint` in the UI.

```ts
const outcome = await session.startAutoWrite({
  prompt: "写一本三章短篇：……",
  requireConfirmGaps: true, // default
});

if (outcome.status === "needs_foundation") {
  for (const gap of outcome.gaps) {
    // gap.key / gap.path / gap.hint — e.g. book, premise, outline, characters…
  }
  return;
}
// outcome.status === "completed" | "stopped"

const { gaps, readyToWrite } = await session.inspectFoundation({ prompt: "……" });
```

<a id="scenario-session-foundation"></a>

### 7.2 Custom or LLM-generated foundation

**Custom** (form / host data) → `upsertFoundation`. **LLM fill** → `generateFoundation` (`mode: "fill_missing"` | `"overwrite"`). Or fold both into `startAutoWrite`.

```ts
await session.upsertFoundation({
  book: { title: "无主的信", synopsis: "……" },
  premise: "……",
  outline: [{ chapter: 1, title: "风暴之后", summary: "……" }], // whole-file replace
  characters: [{ name: "林守" }], // whole-file replace; omitted names are deleted
  worldRules: [{ name: "信与潮", description: "……" }], // whole-file replace
});

await session.generateFoundation({
  prompt: "写一本三章短篇：……",
  keys: ["outline", "characters", "world_rules"], // also: book | premise | layered_outline
  mode: "fill_missing", // default; use "overwrite" to replace
});

await session.startAutoWrite({
  prompt: "……",
  foundation: { book: { title: "无主的信", synopsis: "……" } }, // upsert first
  generateMissing: true, // then generate remaining gaps
  requireConfirmGaps: true, // still return needs_foundation if anything left
});
```

Fingerprint file changes invalidate `foundation_audit`. Mid/long can supply `layeredOutline` instead of flat `outline`. Mid-story upsert/generate is allowed anytime; chapters do **not** auto-rewrite — walk [7.2a–7.2e](#scenario-session-impact) before touching finals.

<a id="scenario-session-impact"></a>

### 7.2a–7.2e Mid-story foundation change (assess → apply)

**Assess a proposed patch first** (`assessFoundationImpact(patch)` vs the current store), then decide whether to apply, confirm a rewrite, and (separately) opt in to chapter sync. Do **not** upsert first — a second assess of the same content then looks like “no change.”

**Patch shape:** omitted keys are left unchanged. A provided `characters`, `worldRules`, `outline`, or `layeredOutline` array **replaces the whole file** — omitted names/chapters are deleted, not merged or renamed in place. `{ characters: [{ name: "林深" }] }` removes 林守.

Sketch: [`examples/session-workspace.ts`](../examples/session-workspace.ts). Same calls over a Worker: [8.1](#scenario-session-worker-impact).

| Job | Severity | Writes chapters? |
| --- | --- | --- |
| [7.2a Assess only](#scenario-session-impact-assess) | any | **Never** |
| [7.2b Meta-only apply](#scenario-session-impact-meta) | `meta_only` | No (`suggestedMode: "none"`) |
| [7.2c Forward-only apply](#scenario-session-impact-forward) | `forward_only` | No |
| [7.2d Confirm gate](#scenario-session-impact-confirm) | `rewrite_needed` | No until confirm, and still no unless [7.2e](#scenario-session-impact-batch) |
| [7.2e Batch chapter sync](#scenario-session-impact-batch) | `rewrite_needed` | Only if `rewriteChapters: true` |

<a id="scenario-session-impact-assess"></a>

#### 7.2a Assess only (no write)

Call `assessFoundationImpact(patch)` on a **proposed** patch **before** `applyFoundationChange` / `upsertFoundation`.

```ts
const patch = {
  // whole-file replace: 林守 is deleted, not renamed in place
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
};

const assessment = await session.assessFoundationImpact(patch);
assessment.severity;          // "meta_only" | "forward_only" | "rewrite_needed"
assessment.suggestedChapters; // e.g. [] or [1, 2]
assessment.suggestedMode;     // "none" | "polish" | "rewrite"
assessment.reasons;           // bilingual strings for the host UI
assessment.notes;
assessment.changedKeys;       // e.g. ["characters"]

if (assessment.severity === "rewrite_needed") {
  // show assessment.reasons + suggestedChapters; wait for the user
} else {
  // meta_only / forward_only can apply without a rewrite confirm
}
```

`llm` is optional here. Pass `{ refineWithLlm: true }` only for a MockLlm/BFF JSON refine; heuristics still set a severity floor.

<a id="scenario-session-impact-meta"></a>

#### 7.2b Meta-only apply (title / tags / synopsis)

```ts
const patch = {
  book: { title: "无主的信（修订）", synopsis: "灯塔与潮的简介改写，不改情节。" },
};

const assessment = await session.assessFoundationImpact(patch);
// assessment.severity === "meta_only"
// assessment.suggestedMode === "none"

const outcome = await session.applyFoundationChange({
  patch,
  rewriteChapters: false, // default; title/tags must not rewrite chapters
});
// outcome.status === "applied"
```

`confirmRewrite` is not required for `meta_only`. `rewriteChapters: true` also does nothing here unless you pass `mode: "rewrite" | "polish"` — `suggestedMode` is `"none"`.

<a id="scenario-session-impact-forward"></a>

#### 7.2c Forward-only (future outline / new characters)

```ts
const patch = {
  // whole-file replace: keep written-chapter rows, then append the future chapter
  outline: [
    { chapter: 1, title: "风暴之后", summary: "林守在礁石缝里捡到那封信。" },
    { chapter: 2, title: "岸边的地址", summary: "按地址找到一座空屋。" },
    { chapter: 3, title: "回信", summary: "把守夜写进回信，放回海里。" },
    { chapter: 4, title: "灯塔之外", summary: "尚未写下的后续。" },
  ],
  // whole-file replace: keep 林守 when adding 潮
  characters: [
    { name: "林守", role: "主角" },
    { name: "潮", role: "未出场", bio: "只在后续出现。" },
  ],
};

const assessment = await session.assessFoundationImpact(patch);
const outcome = await session.applyFoundationChange({
  patch,
  rewriteChapters: false,
});
```

Keep existing written-chapter outline rows intact so heuristics stay `forward_only`. Changing a **written** chapter's plot is [7.2d](#scenario-session-impact-confirm). Same pitfall: `suggestedMode === "none"` writes no chapters unless the host also passes `mode`.

<a id="scenario-session-impact-confirm"></a>

#### 7.2d Rewrite needed + confirm gate

Default gate: `applyFoundationChange` **does not write** until the host passes `confirmRewrite: true`. Prefer the two-step apply — do **not** pass `confirmRewrite: true` and then expect `needs_confirm`.

```ts
const patch = {
  premise: "林深从未离开灯塔。",
  // whole-file replace: 林守 is removed from characters.json
  characters: [{ name: "林深", role: "主角", bio: "改名后的灯塔看守人。" }],
};

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  // show outcome.assessment.reasons in the UI — store is still unchanged
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,    // host acknowledged the blast radius
    rewriteChapters: false,  // still no auto chapter rewrite (see 7.2e)
  });
}
// outcome.status === "applied"
```

Skipping the gate (`requireConfirmRewrite: false`) is for tests/tools — a workbench UI should keep the default.

<a id="scenario-session-impact-batch"></a>

#### 7.2e Batch chapter sync (`rewriteChapters: true`)

After confirm, chapters **still** do not rewrite unless the host opts in with `rewriteChapters: true` on the **confirmed** retry. `rewriteChapters: true` with `suggestedMode === "none"` writes no chapters unless the host also passes `mode: "rewrite" | "polish"`.

```ts
import { MemoryStore, MockLlm } from "novel-engine";

const llm = new MockLlm([
  {
    text: "write",
    toolCalls: [
      { id: "plan-1", name: "plan_chapter", arguments: { chapter: 1, title: "风暴之后", goal: "g", conflict: "c", hook: "h" } },
      { id: "draft-1", name: "draft_chapter", arguments: { chapter: 1, content: "重写：林深守着灯塔。", mode: "write" } },
      { id: "commit-1", name: "commit_chapter", arguments: { chapter: 1 } },
    ],
  },
  { text: "done" },
]);

const session = await createNovelSession({ store, llm, bookId: "letter" });
const patch = { characters: [{ name: "林深", role: "主角" }] }; // replaces the whole table

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,
    rewriteChapters: true, // host opt-in — never the default; only on the confirmed retry
    instruction: "按新设定对齐本章",
  });
}
```

Omit `rewriteChapters` (or pass `false`) to update foundation only. `pendingRewrites` is not used.

<a id="scenario-session-chapter"></a>

### 7.3 Single-chapter create / continue / rewrite / polish

`session.chapter` is a dedicated writer loop — not full-book `Engine.run`.

| Intent | `mode` | Prerequisite |
| --- | --- | --- |
| New chapter | `create` | No final (or `force: true`) |
| Continue draft | `continue` | Draft exists, no final |
| Rewrite finished chapter | `rewrite` | Final exists + `instruction` |
| Light polish | `polish` | Final exists |

```ts
const view = await session.chapter.get(1); // plan / draft / final / summary, or null

await session.chapter.write({
  chapter: 1,
  mode: "create", // | "continue" | "rewrite" | "polish"
  title: "风暴之后",
  instruction: "灯塔视角",
});

await session.chapter.saveFinal(1, "# 风暴之后\n\n……");
```

<a id="scenario-session-read"></a>

### 7.4 Read the latest foundation metadata

Session does **not** cache artifacts — every call reads the store.

```ts
const foundation = await session.getFoundation();
// { book, premise, outline, layeredOutline, characters, worldRules, audit, progress }

const progress = await session.getProgress();
session.subscribe((event) => {
  // foundation_updated | auto_write_step | chapter_step | stopped
});
```

<a id="scenario-session-toc"></a>

### 7.5 Read outline / TOC and chapters

There is no separate “TOC API”: the outline lives in `getFoundation()`, and chapter bodies are loaded with `chapter.get(n)`.

```ts
import { flattenOutline, latestCompleted, nextChapter } from "novel-engine";

const { outline, layeredOutline, progress } = await session.getFoundation();
const flat = layeredOutline ? flattenOutline(layeredOutline) : (outline ?? []);
const finals = await session.listArtifacts("chapters/");

const view = await session.chapter.get(1);
if (view == null) {
  // no plan / draft / final / summary yet
}

const stored = await session.getProgress();
if (stored == null) {
  // no meta/progress.json yet
} else {
  const n = latestCompleted(stored); // max completed chapter; 0 if none
  const latest = n > 0 ? await session.chapter.get(n) : null;
  const next = nextChapter(stored);  // n + 1
  const current = stored.currentChapter;
  const inProgress = current ? await session.chapter.get(current) : null;
}
```

Chapter numbers start at **1**. Guard `getProgress()` null before `latestCompleted`.

<a id="scenario-session-workspace"></a>

### 7.6 Switch books and restore context

One `StorePort` per `bookId`. `switchTo` / `open` **closes** the previous session — discard the old reference.

```ts
const stores = new Map<string, MemoryStore>();
const ws = createNovelWorkspace({
  createStore(bookId) {
    const existing = stores.get(bookId);
    if (existing) return existing;
    const next = new MemoryStore();
    stores.set(bookId, next);
    return next;
  },
  llm,
});

await ws.createBook({ bookId: "a", title: "无主的信" });
await ws.createBook({ bookId: "b", title: "两弧灯塔" });

const sessionA = await ws.switchTo("a");
const restored = await sessionA.getFoundation();
```

Cold start with `indexStore`: `listBooks()` restores the catalog but does **not** auto-open. No Workspace-over-Worker — keep the workspace on the UI thread; one session Worker per book if needed ([scenario 8](#scenario-session-worker)).

<a id="scenario-session-worker"></a>

### 8. Session over Worker (`createSessionClient`)

**When:** Auto-write / chapter ops / foundation apply must not block the UI, and vendor keys must stay on a BFF.

Import `attachSessionWorker` from `novel-engine/session` (not `novel-engine/worker`). `LlmPort.complete` should `fetch("/api/llm")`. Protocol: [architecture](architecture.md#session-bridge-session_protocol) · [session S4](session.md#s4--worker-bridge).

Pair: [`examples/session.worker.ts`](../examples/session.worker.ts) + [`examples/session-host.ts`](../examples/session-host.ts).

```ts
import { createSessionClient } from "novel-engine/session";

const worker = new Worker(new URL("./session.worker.ts", import.meta.url), { type: "module" });
const session = createSessionClient(worker, { bookId: "letter" });
await session.inspectFoundation({ prompt: "写一本三章短篇" });
await session.startAutoWrite({ prompt: "……", generateMissing: true });
await session.chapter.write({ chapter: 1, mode: "create" });
```

<a id="scenario-session-worker-impact"></a>

#### 8.1 Assess + apply over the Worker bridge

Same [7.2a–7.2e](#scenario-session-impact) flows: the client is still a `NovelSession`. Prefer the two-step apply for `rewrite_needed`.

```ts
const patch = { characters: [{ name: "林深", role: "主角" }] }; // whole-file replace

const assessment = await session.assessFoundationImpact(patch);
// assessment.severity / suggestedChapters / suggestedMode / reasons — UI thread, no write

let outcome = await session.applyFoundationChange({ patch });
if (outcome.status === "needs_confirm") {
  // show outcome.assessment.reasons — store unchanged
  outcome = await session.applyFoundationChange({
    patch,
    confirmRewrite: true,
    rewriteChapters: false, // host opt-in on the worker too; never auto-rewrite
  });
}
```

Busy (`SessionBusyError`) is the worker-side session flag: an in-flight `applyFoundationChange` blocks `chapter.write` across the bridge.

<a id="pitfalls"></a>

## Practical pitfalls

- **Assess the proposed patch** with `assessFoundationImpact(patch)` **before** `applyFoundationChange` / `upsertFoundation`. After the same content is already written, a second assess typically looks like “no change.”
- **`characters` / `worldRules` / `outline` / `layeredOutline` are whole-file replace.** `{ characters: [{ name: "林深" }] }` deletes 林守; it does not rename in place. Include every row you want to keep.
- **`rewriteChapters: true` with `suggestedMode === "none"`** (typical `meta_only` / `forward_only`) writes no chapters unless the host also passes `mode: "rewrite" | "polish"`.
- **Guard `getProgress()` null** before `latestCompleted(progress)` / `nextChapter(progress)`.
- **Two-step confirm:** apply without `confirmRewrite`; if `status === "needs_confirm"`, retry with `confirmRewrite: true`. Passing `confirmRewrite: true` never returns `needs_confirm`.
- **Keys on a BFF.** Do not embed vendor API keys in a public SPA or Worker bundle.

<a id="security"></a>

## Security

**Do not put raw provider API keys in a public web app.** Production (including a Next.js workbench) should keep keys on a BFF and have the worker `fetch` that route. Adapter details: [llm-adapters.md](llm-adapters.md).
