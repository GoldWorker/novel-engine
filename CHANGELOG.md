# Changelog

## Unreleased

### Documentation

- Consolidate host docs to **three bodies** (plus thin indexes): [guide](docs/guide.md) (how-to — Kit first, install, LLM adapters, Engine / Session copy-paste flows), [api](docs/api.md) (stable exports plus Session S0–S6 contracts, errors, protocol), [architecture](docs/architecture.md) (internals). Removed `docs/guide-kit.md`, `docs/session.md`, `docs/llm-adapters.md` and ZH counterparts; in-repo links updated. No package version bump.
- Root README is a host landing a newcomer can use alone: **(1) usage scenarios** (install, `NovelKit.create`, short/long Kit paths, mid-story assess→apply, read meta, chapter CRUD that exists — **no delete-chapter API**, export/import, subscribe/dispose, multi-book, Worker notes) with copy-paste Kit snippets; **(2) API catalog by surface** (package entries, `NovelKit.create` options + readonly fields + every public method, Session/Engine pointer table). EN/ZH stay in parity. Deep audited 7.2a–e flows stay in the [guide](docs/guide.md).
- Kit **Initialize** (root README + guide Kit defaults) now documents how to **wire the LLM at `NovelKit.create`**: when `llm` vs `llmEndpoint` is required/ignored, init-time only (no mid-session swap), worker `llmEndpoint` snippet, and main-thread `llm` via `createOpenAiLlm` / `createAnthropicLlm` / `createDashScopeLlm` or a custom `LlmPort` / `MockLlm`. Create-options tables in the README API catalog match. EN/ZH stay in parity.
- Doc/code corrections while rewriting the landing: `BookMetadata` is `{ title, synopsis }` only (no tags); `writeChapter` `rewrite` `instruction` is optional; `startBook` leftover gap after a complete fill is often `foundation_audit` (`generateMissing` cannot write it); Kit does not expose Engine `pause`/`resume`/`steer` or a delete-chapter API; `./kit` does not re-export Session types. Guide/API headings that said otherwise were aligned with code.

## 0.5.0 — 2026-09-18

### Added

- **Optional `novel-engine/kit`** — host façade `NovelKit.create` only (no `new` + `init`). Defaults **ON**: `store: "opfs"`, `runtime: "worker"`, `workspace: true`, `bookId: "default"`, `llmEndpoint: "/api/llm"`, `fallbackToMemory: true`. Node/tests opt out with `store: "memory"` / `runtime: "main"` (`llm` required on main). Readonly `storeKind` / `runtime` / `bookId` on the instance.
- **Shipped kit worker** — build publishes `dist/novel-kit.worker.js` (`novel-engine/kit/worker`). Hosts do **not** maintain worker source. Default URL: `new URL("./novel-kit.worker.js", import.meta.url)` relative to `dist/kit.js` (vendored/`file:` copies). Documented `public/` copy + `workerUrl` fallback.
- **Worker LLM** — `LlmPort.complete` → `fetch(llmEndpoint)`. No API keys in the worker. On create, main sends a kit **init** handshake (`ns: "kit"`) with `llmEndpoint`, `bookId`, OPFS options, then attaches the existing Session bridge (`SESSION_PROTOCOL`). If both `llm` and `llmEndpoint` are passed in worker mode, the worker uses `llmEndpoint`.
- Scenario methods wrap Session 1:1 (`inspect` → `inspectFoundation`, `applyFoundation` → `applyFoundationChange`, …). Confirm gate, whole-file replace, `rewriteChapters` default false, and no mid-session LLM swap are unchanged. Multi-book methods throw when `workspace: false`.

### Documentation

- `docs/guide-kit.md` / `docs/guide-kit.zh-CN.md`: create-only, shipped worker, `llmEndpoint`, optional `bookId`, defaults OPFS+Worker. Kit is the new out-of-the-box path; Session remains reference.
- Split host usage from internals: [guide](docs/guide.md) (copy-paste scenarios, including audited S5/S6 confirm-gate flows), [architecture](docs/architecture.md) (Ports, `route`, protocols, store layout), [docs/README.md](docs/README.md) index. Root README is the product hub; `docs/session.md` / `docs/api.md` stay reference. EN/ZH stay in sync.
- Host install: **copy** this package into the app (`vendor/novel-engine/` etc.), `npm install && npm run build`, then relative `dist/` imports (or `file:./vendor/novel-engine` to keep the package name). Registry `npm install novel-engine` remains the other option. `exports` includes `./package.json`.
- Session S5/S6 host-call audit: assess a **proposed** patch before apply/upsert; two-step `applyFoundationChange` for `rewrite_needed` (`confirmRewrite: true` never yields `needs_confirm`); `characters` / `worldRules` / `outline` / `layeredOutline` are whole-file replace; `rewriteChapters` is a no-op when `suggestedMode` is `"none"` unless `mode` is passed; guide §7.5 guards `getProgress()` null; §8.1 Worker example includes the confirm-gate apply. EN/ZH stay in sync.

## 0.4.0 — 2026-09-18

### Added

- **Session S5 `assessFoundationImpact`** — rules-first, deterministic heuristics (optional MockLlm JSON refinement) that classify a proposed foundation patch as `meta_only` | `forward_only` | `rewrite_needed`. Returns `suggestedChapters` / `suggestedRanges`, `suggestedMode` (`none` | `polish` | `rewrite`), bilingual `reasons` / `notes`. Pure assessment: **does not mutate the store or rewrite chapters**. LLM refinement cannot downgrade heuristic severity.
- **Session S6 `applyFoundationChange`** — assess → confirm gate for `rewrite_needed` (`needs_confirm` unless `confirmRewrite: true`) → `upsertFoundation` → optional sequential `chapter.write` for suggested chapters (`rewriteChapters`, default false). Chapters never auto-rewrite; host must opt in. Reuses existing Session APIs. Busy-flag shared with `startAutoWrite` / `chapter.write`.
- Worker protocol stays **`SESSION_PROTOCOL === 1`** with additive commands `assessFoundationImpact` / `applyFoundationChange`.

### Documentation

- Root README **§7.2a–7.2e** copy-pasteable mid-story foundation-change scenarios (assess only, meta-only, forward-only, `needs_confirm` gate, batch `rewriteChapters`) plus **§8.1** Worker assess/apply. `docs/session.md` / `docs/api.md` and ZH counterparts point at those scenarios. Package version **0.4.0**.

## 0.3.0 — 2026-09-17

### Added

- **Optional `novel-engine/session` (0.3.0)** — same-thread host façade: `createNovelSession` / `createNovelWorkspace`. S0/S1: `getFoundation` / `inspectFoundation` / `assertReadyToWrite` / workspace. **S2:** `upsertFoundation`, structured one-shot `generateFoundation` (JSON in `LlmPort.complete().text` → upsert; not an Engine loop), and `startAutoWrite` (optional generate, then `needs_foundation` or `createEngine().run`). **S3:** Session ChapterRunner `session.chapter.get` / `saveFinal` / `write` (`create` / `continue` / `rewrite` / `polish`) — dedicated writer loop reusing `src/workers/tools.ts`; not `Engine.run` and not `pendingRewrites`. Mutual exclusion via `SessionBusyError`. **S4:** Worker bridge `createSessionClient` / `attachSessionWorker` — adapter over the same `NovelSession` (`ns: "session"` protocol); `generateFoundation` stays in the worker with the store; `LlmPort` should `fetch` a host BFF (no vendor keys in the worker). `subscribe` for `foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`. Default `.` / `./worker` / `./llm` bundles do not import session. Docs: `docs/session.md` / `docs/session.zh-CN.md`.

### Fixed

- **`foundationMissing`** — mid/long with a valid non-empty `layered_outline.json` (volume/arc shape) no longer requires a flat `outline.json`. Short tier still does. Optional `tier` argument; otherwise inferred from `run_meta.planningTier` / `progress.planningTier` / `progress.layered` / presence of a valid layered outline. Fingerprint skips a missing `outline.json` when the layered outline is valid so `novel_context` / `audit_foundation` still work.
- **`StorePort.remove?`** — optional delete (`MemoryStore`, `OpfsStore`). Session uses it to drop a stale `meta/foundation_audit.json` after fingerprint files change.

## 0.2.0 — 2026-09-17

### Added

- **Optional `novel-engine/llm`** — fetch-based `LlmPort` adapters for OpenAI Chat Completions, Anthropic Messages, and DashScope OpenAI-compatible mode (`compatible-mode/v1`). Factories: `createOpenAiLlm`, `createAnthropicLlm`, `createDashScopeLlm`, `createVendorLlm`. No `openai` / `@anthropic-ai/sdk` dependency. Default `.` / `./worker` bundles stay vendor-free.

### Documentation

- Reorganize host usage in the root README **by scenario** (short book, layered mid/long, OPFS, Worker, snapshot, real LLM adapters). `README.zh-CN.md` mirrors the same map. `examples/` stays the canonical runnable sources; its READMEs now point at the root hub instead of repeating the how-to.
- Add Chinese README (`README.zh-CN.md`) and API docs (`docs/api.zh-CN.md`).
- Add copy-pasteable usage examples under `examples/`.
- Add `docs/llm-adapters.md` / `docs/llm-adapters.zh-CN.md` and `examples/llm-openai.ts` (no secrets). Security note: do not expose raw API keys in a public browser app; prefer a Next.js BFF.

## 0.1.0 — 2026-09-17

First usable semver for host apps. Pure-frontend ESM library: no UI, no real LLM providers, no `node:fs` in `src/`.

### Added

- **Book snapshot** — `exportBookSnapshot(store)` / `importBookSnapshot(store, bytes)` pack every store path into a browser-safe zip (fflate) and restore into any `StorePort`. MemoryStore fixture round-trip plus a short-book Engine round-trip.
- **`StorePort.list?`** — optional path listing. Implemented on `MemoryStore` and `OpfsStore` (OPFS `keys()` walk; skips `.*.tmp`). Export probes the known book layout when `list` is absent.
- **`docs/api.md`** — stable exports for `.` and `./worker`.
- npm script aliases `test:short` and `test:layered`.

### Documentation

- README quickstart (mock short book), layered mock, OPFS + Worker embed snippets, snapshot, and an explicit “what's not included” list.
- `package.json` `exports` map covers `.` and `./worker`; `files` remains `dist`, `README.md`, `LICENSE`.

### Out of scope (unchanged)

React package, Demo SPA, real LLM adapters, Arbiter full scenes, ChapterAdvanceGate review UI.

---

## 0.0.1 — 2026-09-17 (pre-semver)

Phases 0–3 landed on `main` before the 0.1.0 cut. Summarized here so hosts can see how the SDK grew.

### Phase 0 — domain + pure `route`

- TypeScript ESM package skeleton (`tsup` dual entry later).
- Domain types: Phase, Flow, PlanningTier, Progress, agents.
- Forward-only Phase / Flow validators with golden JSON tables.
- Pure `route(state) → Instruction | null` (no Store/LLM IO).

### Phase 1 — runnable Engine

- `createEngine` serial loop: load state → route → Worker tools → repeat.
- `MemoryStore` path-keyed `StorePort`.
- `MockLlm` / `ReplayLlm`.
- Deterministic `plan_start` stub (keyword → short/mid/long).
- 3-chapter short-book mock reaching `phase === "complete"`.

### Phase 2 — OPFS + Worker host

- `OpfsStore` / `createOpfsStore` / `isOpfsAvailable` (MemoryStore fallback).
- Atomic writes (temp + `move`, or copy-then-unlink).
- `createEngineClient` + `attachEngineWorker` (`novel-engine/worker`).
- Cooperative `pause` / `resume` / `steer` (`flow=steering`).
- Protocol `v: 1` (`start` / `steer` / `pause` / `resume` / `snapshot` / `event` / `error`).

### Phase 3 — layered mid/long-book tools

- `architect_long`: `layered_outline` / `expand_next_arc` / `append_volume` / `complete_book`.
- Editor `save_review` (arc/global), `save_arc_summary`, `save_volume_summary`.
- `novel_context` sliding chapter summaries + arc/volume summaries.
- 1-volume / 2-arc layered mock run to `Phase.complete`.
