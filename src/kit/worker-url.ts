/**
 * Default URL of the published worker module, relative to this kit bundle
 * (`dist/kit.js` → `dist/novel-kit.worker.js`). Works for `file:` / vendored
 * copies that keep `dist/` intact.
 *
 * If a bundler rewrites `import.meta.url` so this 404s, copy
 * `dist/novel-kit.worker.js` to the host `public/` (or equivalent) and pass
 * `workerUrl`.
 */
export function defaultKitWorkerUrl(): URL {
  return new URL("./novel-kit.worker.js", import.meta.url);
}
