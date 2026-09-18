/**
 * Tiny static + mock-BFF server for Kit worker smoke.
 * Serves built `dist/kit.js` / `dist/novel-kit.worker.js` and POST `/api/llm`
 * with the short-book MockLlm handler. No vendor keys, no upstream network.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmCompletionRequest, LlmCompletionResult } from "../../src/index.js";
import { shortBookLlmHandler, type ShortBookFixture } from "../helpers/short-book-llm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const short = JSON.parse(
  readFileSync(path.join(repoRoot, "fixtures/short-book.json"), "utf8"),
) as ShortBookFixture;
const llmHandler = shortBookLlmHandler(short);

export interface HarnessServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export function assertBuiltKit(): void {
  const kit = path.join(repoRoot, "dist/kit.js");
  const worker = path.join(repoRoot, "dist/novel-kit.worker.js");
  if (!existsSync(kit) || !existsSync(worker)) {
    throw new Error(
      "Playwright worker smoke needs a build. Run `npm run build` first (dist/kit.js + dist/novel-kit.worker.js).",
    );
  }
}

export function resolveFflateBrowser(): string {
  const candidates = [
    path.join(repoRoot, "node_modules/fflate/esm/browser.js"),
    path.join(repoRoot, "node_modules/fflate/lib/browser.js"),
    path.join(repoRoot, "node_modules/fflate/esm/index.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("fflate browser ESM file not found under node_modules/fflate");
}

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath)] ?? "application/octet-stream";
}

function sendFile(res: ServerResponse, filePath: string, method: string): void {
  const stat = statSync(filePath);
  res.writeHead(200, {
    "content-type": mimeFor(filePath),
    "content-length": stat.size,
    "cache-control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function sendText(res: ServerResponse, status: number, body: string, contentType: string): void {
  const bytes = Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": bytes.length,
    "cache-control": "no-store",
  });
  res.end(bytes);
}

function notFound(res: ServerResponse, method: string): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end(method === "HEAD" ? undefined : "not found");
}

function resolveStatic(urlPath: string): string | null {
  if (urlPath === "/" || urlPath === "/harness.html") {
    return path.join(here, "harness.html");
  }
  if (urlPath === "/vendor/fflate/browser.js") {
    return resolveFflateBrowser();
  }
  if (urlPath === "/fixtures/short-book.json") {
    return path.join(repoRoot, "fixtures/short-book.json");
  }
  if (!urlPath.startsWith("/dist/")) {
    return null;
  }
  const rel = urlPath.slice("/dist/".length);
  if (rel === "" || rel.includes("..") || path.isAbsolute(rel)) {
    return null;
  }
  const filePath = path.resolve(path.join(repoRoot, "dist"), rel);
  const distRoot = path.resolve(path.join(repoRoot, "dist"));
  if (!filePath.startsWith(distRoot + path.sep) && filePath !== distRoot) {
    return null;
  }
  return filePath;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function handleLlm(bodyText: string): LlmCompletionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    throw new Error("mock BFF: request was not JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("mock BFF: request must be a JSON object");
  }
  return llmHandler(parsed as LlmCompletionRequest);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (method === "GET" || method === "HEAD") {
    if (url.pathname === "/health") {
      if (method === "HEAD") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end();
        return;
      }
      sendText(res, 200, "ok", "text/plain; charset=utf-8");
      return;
    }
    const filePath = resolveStatic(url.pathname);
    if (filePath === null || !existsSync(filePath) || !statSync(filePath).isFile()) {
      notFound(res, method);
      return;
    }
    sendFile(res, filePath, method);
    return;
  }

  if (method === "POST" && url.pathname === "/api/llm") {
    const body = await readBody(req);
    try {
      const result = handleLlm(body);
      sendText(res, 200, JSON.stringify(result), "application/json; charset=utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendText(res, 400, JSON.stringify({ error: message }), "application/json; charset=utf-8");
    }
    return;
  }

  res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
  res.end("method not allowed");
}

export async function startHarnessServer(): Promise<HarnessServer> {
  assertBuiltKit();
  resolveFflateBrowser();
  const server: Server = createServer((req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendText(res, 500, message, "text/plain; charset=utf-8");
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
    server.on("error", reject);
  });

  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    server.close();
    throw new Error("harness server did not bind a TCP port");
  }

  return {
    url: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}
