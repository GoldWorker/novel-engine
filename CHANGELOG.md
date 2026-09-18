# Changelog

## Unreleased

## 0.6.0 — 2026-09-18

### Added

- **Long-form control on Session / NovelKit** — `session.pause` / `resume` / `steer(note)` wrap the Engine instance held during `startAutoWrite` (not a second control plane). Kit names: `pauseBook` / `resumeBook` / `steerBook(message)`. Same RPCs on the Session worker bridge (`pause` / `resume` / `steer`), so `runtime: "worker"` matches `runtime: "main"`. Returns `{ status: "ok" }` or `{ status: "idle" }` (no Engine running — documented no-op, not an exception). Empty steer notes throw `EngineError`. `subscribe` emits `paused` / `resumed` / `steered`. Does **not** take the busy flag; `startBook` / `writeChapter` / `applyFoundation` / `deleteChapter` still throw `SessionBusyError` while one of those is in flight.
- **Start-writing audit gate** — `InspectResult.auditOnly` and `needs_foundation.auditOnly` when leftover gaps are only `foundation_audit`. `confirmAuditGap: true` proceeds to `Engine.run` in that case without disabling `requireConfirmGaps` for non-audit gaps. `FoundationGap.kind` is `"audit"` | `"artifact"`. Happy path: fill → if only audit → confirm with the new flag → write.
- **Chapter delete + TOC helper** — `session.chapter.delete(n, { syncOutline? })` / `kit.deleteChapter`. Removes `drafts/NN.plan.json`, `drafts/NN.draft.md`, `chapters/NN.md`, `summaries/NN.json`. Drops `n` from `completedChapters` / `pendingRewrites`; clamps `currentChapter`; `complete` → `writing` if a completed chapter was removed; `totalChapters` unchanged. `syncOutline: true` upserts flat/layered outline without that row (no renumbering; last remaining flat-outline row unsupported because upsert forbids empty arrays). Reviews (`reviews/*`) are left in place. `kit.updateOutline({ outline?, layeredOutline? })` is a thin upsert (no assess/confirm). Requires `StorePort.remove`.
- **Type re-exports from `novel-engine/kit`** — `FoundationPatch`, `FoundationMeta`, `InspectResult`, `AutoWriteResult`, `FoundationImpactAssessment`, `ChapterView`, `ChapterWriteInput`, `ChapterWriteResult`, `SessionEvent`, `SessionUnsubscribe`, apply/assess option/result types, plus new 0.6 types. Runtime Kit surface otherwise unchanged besides the new methods.

### Documentation

- README + guide 7.x + api + architecture (EN/ZH) document the new APIs, busy rules, and the fill → audit-only confirm → write path. Package version **0.6.0**.

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
