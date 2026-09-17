# Changelog

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
