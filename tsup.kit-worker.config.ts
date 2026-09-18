import { defineConfig } from "tsup";

/**
 * Shipped kit worker. Built after the main `tsup` so `clean` does not wipe it.
 * `fflate` is bundled so `public/` copies of `novel-kit.worker.js` do not need
 * to resolve a bare `fflate/browser` specifier inside a Dedicated Worker.
 */
export default defineConfig({
  entry: {
    "novel-kit.worker": "src/kit/worker-entry.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: false,
  splitting: false,
  treeshake: true,
  target: "es2022",
  outDir: "dist",
  noExternal: ["fflate", "fflate/browser"],
});
