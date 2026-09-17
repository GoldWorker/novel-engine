# Changelog

## Unreleased

### Added

- **Optional `novel-engine/session` (0.3.0)** — same-thread host façade: `createNovelSession` / `createNovelWorkspace`. S0/S1: `getFoundation` / `inspectFoundation` / `assertReadyToWrite` / workspace. **S2:** `upsertFoundation`, structured one-shot `generateFoundation` (JSON in `LlmPort.complete().text` → upsert; not an Engine loop), and `startAutoWrite` (optional generate, then `needs_foundation` or `createEngine().run`). **S3:** Session ChapterRunner `session.chapter.get` / `saveFinal` / `write` (`create` / `continue` / `rewrite` / `polish`) — dedicated writer loop reusing `src/workers/tools.ts`; not `Engine.run` and not `pendingRewrites`. Mutual exclusion via `SessionBusyError`. `subscribe` for `foundation_updated` / `auto_write_step` / `chapter_step` / `stopped`. Default `.` / `./worker` / `./llm` bundles do not import session. Docs: `docs/session.md` / `docs/session.zh-CN.md`. **S4 Worker session bridge is not in this release.**

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
