import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
for (const rel of ["dist/kit.js", "dist/novel-kit.worker.js"]) {
  if (!fs.existsSync(path.join(repoRoot, rel))) {
    throw new Error(
      "Playwright worker smoke needs a build. Run `npm run build` first (dist/kit.js + dist/novel-kit.worker.js).",
    );
  }
}

/**
 * Browser smoke against the published Kit artifacts (`dist/kit.js` +
 * `dist/novel-kit.worker.js`). Install Chromium once:
 *
 *   npx playwright install --with-deps chromium
 *
 * Then: `npm run build && npm run test:browser`
 */
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    trace: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
