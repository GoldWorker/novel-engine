import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { startHarnessServer, type HarnessServer } from "./harness-server";

type SmokeResult = {
  runtime: string;
  storeKind: "opfs" | "memory";
  workerStatus: number;
  inspectGaps: string[];
  outcomeStatus: string;
  outcomePhase: string | null;
  chapter1Snippet: string | null;
  consoleErrors: string[];
};

type PageMonitor = {
  errors: string[];
  workerStatuses: number[];
};

let server: HarnessServer;

test.beforeAll(async () => {
  server = await startHarnessServer();
});

test.afterAll(async () => {
  await server.close();
});

function isIgnorableConsole(text: string): boolean {
  return text.includes("favicon") || text.includes("net::ERR_ABORTED");
}

function attachPageMonitor(page: Page): PageMonitor {
  const errors: string[] = [];
  const workerStatuses: number[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" && !isIgnorableConsole(msg.text())) {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  page.on("response", (response) => {
    if (response.url().includes("novel-kit.worker.js")) {
      workerStatuses.push(response.status());
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("novel-kit.worker.js")) {
      errors.push(`worker request failed: ${request.url()} ${request.failure()?.errorText ?? ""}`);
    }
  });
  return { errors, workerStatuses };
}

test.describe("Kit worker browser smoke", () => {
  test("loads shipped worker, handshake, inspect/fill/startBook without console errors", async ({
    page,
  }) => {
    const monitor = attachPageMonitor(page);

    const workerProbe = await page.request.get(`${server.url}/dist/novel-kit.worker.js`);
    expect(workerProbe.status(), "shipped dist/novel-kit.worker.js must not 404").toBe(200);
    expect(workerProbe.headers()["content-type"] ?? "").toMatch(/javascript|ecmascript/);

    const kitProbe = await page.request.get(`${server.url}/dist/kit.js`);
    expect(kitProbe.status(), "built dist/kit.js must be served").toBe(200);

    await page.goto(`${server.url}/harness.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as unknown as { __SMOKE_DONE__?: boolean }).__SMOKE_DONE__ === true, {
      timeout: 60_000,
    });

    const error = await page.evaluate(
      () => (window as unknown as { __SMOKE_ERROR__?: string | null }).__SMOKE_ERROR__ ?? null,
    );
    expect(error, error ?? "harness error").toBeNull();

    const result = await page.evaluate(
      () => (window as unknown as { __SMOKE_RESULT__?: SmokeResult | null }).__SMOKE_RESULT__ ?? null,
    );
    expect(result).not.toBeNull();
    if (result === null) {
      return;
    }

    expect(result.runtime).toBe("worker");
    expect(["opfs", "memory"]).toContain(result.storeKind);
    expect(result.workerStatus).toBe(200);
    expect(monitor.workerStatuses.some((status) => status === 200)).toBe(true);
    expect(result.inspectGaps).toContain("book");
    expect(result.outcomeStatus).toBe("completed");
    expect(result.outcomePhase).toBe("complete");
    expect(result.chapter1Snippet).toContain("蜡封");
    const combinedErrors = [...monitor.errors, ...result.consoleErrors].filter(
      (text) => !isIgnorableConsole(text),
    );
    expect(combinedErrors, combinedErrors.join("\n")).toEqual([]);
  });
});
