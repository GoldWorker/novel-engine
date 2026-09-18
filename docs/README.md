# Docs index

[English](README.md) | [中文文档](README.zh-CN.md)

Three bodies. Root [README](../README.md) is the host landing: usage scenarios (install, init, short/long, mid-story meta, chapters, export) plus a full Kit API catalog. Runnable sketches stay in [`examples/`](../examples/).

| Doc | For |
| --- | --- |
| [Guide](guide.md) | **How-to.** Kit first (recommended). Install / vendoring. LLM adapters. Copy-paste Engine / Session flows. |
| [API](api.md) | **Contracts.** Stable exports and types for `.` / `./worker` / `./llm` / `./session` / `./kit`. Session method contracts, errors, S0–S6, protocol. |
| [Architecture](architecture.md) | **Internals.** Ports, `route`, store layout, Worker / Session / Kit protocols, busy lifecycle, packaging. |
| [Smoke vs host E2E](smoke.md) | **What this repo tests** (README scenario smoke + Playwright worker) vs **host workbench E2E** still owned by 《写作工作台》. |

Reader path: root README (scenarios + Kit API catalog) → guide (how) → API (contracts) → architecture (internals). Smoke coverage vs host E2E: [smoke](smoke.md).

Every page has a Chinese counterpart (`*.zh-CN.md`).
