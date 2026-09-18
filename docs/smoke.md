# Smoke tests vs host E2E

[English](smoke.md) | [中文文档](smoke.zh-CN.md)

What this package tests, and what 《写作工作台》 (the host app) still owns.

## What this repo covers

| Tier | Where | Command | What it proves |
| --- | --- | --- | --- |
| Unit / contract | `tests/**/*.test.ts` (existing ~260 vitest) | `npm test` | Engine, Session, Kit methods, adapters, fixtures |
| **Tier 2 — README scenario smoke** | `tests/smoke/` | `npm run test:smoke` (also part of `npm test`) | Documented **host jobs** walked end-to-end on `NovelKit` + **MockLlm** (no network) |
| **Tier 1 — browser / real Worker smoke** | `tests/browser/` (Playwright) | `npm run build && npm run test:browser` | Built `dist/kit.js` + shipped `dist/novel-kit.worker.js` load in Chromium; init handshake; inspect → fill → `startBook` (`confirmAuditGap` if needed) against a **local mock BFF** |

Tier 2 scenarios (README jobs):

1. Short book: `inspect` → `fillFoundation` → `startBook` → `confirmAuditGap` if `auditOnly` → `completed` / `stopped`
2. Mid / layered: fill `layeredOutline` → `startBook` (+ audit confirm)
3. Mid-story meta: `assessFoundation` → two-step `applyFoundation` for `rewrite_needed`
4. Chapters: `writeChapter` create → `getChapter` → `deleteChapter` with `syncOutline`
5. Control: in-flight `startBook` → `pauseBook` / `resumeBook` / `cancelBook` + `getRunState`
6. Export / import roundtrip on `store: "memory"`

Tier 1 notes:

- Fake LLM is `POST /api/llm` on a tiny harness server (scripted `{ text, toolCalls? }`). **No OpenAI / Anthropic / DashScope keys or network.**
- Kit is created with default **`runtime: "worker"`**. The test fails if `dist/novel-kit.worker.js` 404s.
- Store: default **OPFS** with `fallbackToMemory: true`. Headless Chromium often supports OPFS on `http://127.0.0.1`; if `getDirectory()` fails, the worker uses **MemoryStore** (`storeKind: "memory"`). That is a documented Kit fallback, not a skip of the real worker file.
- Chromium flags are not required on localhost (secure context). If OPFS is flaky in a particular CI image, keep `fallbackToMemory: true` rather than stubbing the worker.

Install the browser once (CI does this in GitHub Actions):

```bash
npx playwright install --with-deps chromium
npm run build
npm run test:browser
```

`npm test` stays **Node vitest only** so contributors without Playwright browsers are not broken.

## What remains host-owned (Tier 3)

Do **not** add Next.js / workbench UI tests in this repository. The host app should add E2E later against the real 《写作工作台》.

Checklist for the host:

1. **BFF `/api/llm`** — `POST` the worker’s `LlmCompletionRequest` JSON; respond `{ text: string, toolCalls? }`. Vendor API keys stay on the server. Error shape should be HTTP non-OK so the worker throws `LlmError` with `status`.
2. **Worker URL** — default `new URL("./novel-kit.worker.js", import.meta.url)` relative to `dist/kit.js`. If the bundler rewrites `import.meta.url` and the worker 404s, copy `dist/novel-kit.worker.js` to `public/` and pass `workerUrl: "/novel-kit.worker.js"`.
3. **OPFS** — persist across reload; `fallbackToMemory` only for unsupported browsers. Assert a book survives refresh.
4. **Cancel UX** — `cancelBook()` while `startBook` is running; in-flight promise rejects `AbortedError`; `getRunState()` returns `idle`; UI is usable again.
5. **Confirm gates** — leftover `foundation_audit` → `confirmAuditGap: true` (do not use `requireConfirmGaps: false` to skip book/outline gaps). Mid-story `rewrite_needed` is two-step `applyFoundation` (`needs_confirm` then `confirmRewrite: true`).
6. **Busy / control** — `pauseBook` / `resumeBook` / `steerBook` while writing; `SessionBusyError` when starting a second `startBook` / `writeChapter`.
7. **Chapters + export** — create / read / delete in the UI; download snapshot zip and re-import.
8. **No keys in the worker** — DevTools on `novel-kit.worker.js` must not see vendor secrets.

These steps need the host’s routing, auth, copy, and layout — they are not tool-layer tests.
