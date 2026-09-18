# Docs index

[English](README.md) | [中文文档](README.zh-CN.md)

Host how-to lives in the **guide**. Contracts live in **API** / **Session**. Internals live in **architecture**. Runnable sketches stay in [`examples/`](../examples/).

## Usage

| Doc | For |
| --- | --- |
| [Host guide](guide.md) | Install (vendor copy + relative `dist/` imports, or registry) and copy-paste host flows |
| [LLM adapters](llm-adapters.md) | Optional `novel-engine/llm` factories, mapping, BFF security |

Root [README](../README.md) is the product entry and scenario hub. It points here instead of duplicating internals.

## Reference

| Doc | For |
| --- | --- |
| [Public API](api.md) | Stable exports, types, constants (`.` / `./worker` / `./llm` / `./session`) |
| [Session API](session.md) | `novel-engine/session` method contracts, errors, S0–S6, protocol |

## Internals

| Doc | For |
| --- | --- |
| [Architecture](architecture.md) | Ports & Adapters, `route`, store layout, fingerprint/audit, Worker protocols, busy lifecycle, packaging/`exports` |

## Language

Every page has a Chinese counterpart (`*.zh-CN.md`).
