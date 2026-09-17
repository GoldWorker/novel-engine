import { unzipSync, zipSync } from "fflate/browser";
import type { StorePort } from "../ports/store.js";
import { encodeUtf8 } from "./io.js";
import { listStorePaths } from "./list-paths.js";
import { normalizeStorePath } from "./normalize.js";

/** Zip-entry name for the snapshot manifest (not restored into the store). */
export const BOOK_SNAPSHOT_MANIFEST_PATH = ".novel-engine-snapshot.json";

/** Stable format id written into every book snapshot zip. */
export const BOOK_SNAPSHOT_FORMAT = "novel-engine-book-snapshot";

/** Snapshot layout version. Hosts should reject unknown versions. */
export const BOOK_SNAPSHOT_VERSION = 1;

export interface BookSnapshotManifest {
  format: typeof BOOK_SNAPSHOT_FORMAT;
  version: typeof BOOK_SNAPSHOT_VERSION;
  files: number;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

function isTempPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return name.startsWith(".") && name.endsWith(".tmp");
}

function isManifestPath(path: string): boolean {
  return path === BOOK_SNAPSHOT_MANIFEST_PATH;
}

function zipPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/u, "");
  if (
    normalized === "" ||
    normalized.split("/").includes("..") ||
    normalized.includes("\0")
  ) {
    throw new SnapshotError(`invalid snapshot path: ${path}`);
  }
  return normalized;
}

function toZipBytes(files: Record<string, Uint8Array>): Uint8Array {
  try {
    return zipSync(files, { level: 6 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(`failed to create book snapshot zip: ${message}`);
  }
}

function fromZipBytes(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength < 22) {
    throw new SnapshotError("invalid book snapshot: not a zip archive");
  }
  try {
    return unzipSync(bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(`invalid book snapshot zip: ${message}`);
  }
}

function parseManifest(bytes: Uint8Array): BookSnapshotManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new SnapshotError("invalid book snapshot: manifest is not JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("format" in parsed) ||
    !("version" in parsed)
  ) {
    throw new SnapshotError("invalid book snapshot: missing manifest fields");
  }
  const format = (parsed as { format: unknown }).format;
  const version = (parsed as { version: unknown }).version;
  if (format !== BOOK_SNAPSHOT_FORMAT) {
    throw new SnapshotError(`invalid book snapshot: unknown format ${String(format)}`);
  }
  if (version !== BOOK_SNAPSHOT_VERSION) {
    throw new SnapshotError(`invalid book snapshot: unsupported version ${String(version)}`);
  }
  const files = (parsed as { files?: unknown }).files;
  return {
    format: BOOK_SNAPSHOT_FORMAT,
    version: BOOK_SNAPSHOT_VERSION,
    files: typeof files === "number" ? files : 0,
  };
}

/**
 * Pack every stored book path into a browser-safe zip (`Uint8Array`).
 *
 * Uses `StorePort.list` when available so custom files are included; otherwise
 * probes the known novel-engine layout. Atomic-write temp files (`.*.tmp`) are
 * skipped. Import is a merge: existing extra paths in the destination remain.
 */
export async function exportBookSnapshot(store: StorePort): Promise<Uint8Array> {
  const paths = (await listStorePaths(store)).filter(
    (path) => !isManifestPath(path) && !isTempPath(path),
  );
  const files: Record<string, Uint8Array> = {};
  for (const path of paths) {
    const data = await store.read(path);
    if (data == null) {
      continue;
    }
    files[zipPath(path)] = data.slice();
  }
  const manifest: BookSnapshotManifest = {
    format: BOOK_SNAPSHOT_FORMAT,
    version: BOOK_SNAPSHOT_VERSION,
    files: Object.keys(files).length,
  };
  files[BOOK_SNAPSHOT_MANIFEST_PATH] = encodeUtf8(`${JSON.stringify(manifest, null, 2)}\n`);
  return toZipBytes(files);
}

/**
 * Restore a zip produced by `exportBookSnapshot` into `store`.
 *
 * Overwrites snapshot paths; does not delete extra files already in the store.
 * The manifest entry is not written as a store artifact.
 */
export async function importBookSnapshot(store: StorePort, bytes: Uint8Array): Promise<void> {
  const unzipped = fromZipBytes(bytes);
  const restored: Array<{ path: string; data: Uint8Array }> = [];
  let manifest: BookSnapshotManifest | null = null;

  for (const [rawName, data] of Object.entries(unzipped)) {
    if (rawName.endsWith("/")) {
      continue;
    }
    const name = zipPath(rawName);
    if (isManifestPath(name)) {
      manifest = parseManifest(data);
      continue;
    }
    if (isTempPath(name)) {
      continue;
    }
    restored.push({ path: normalizeStorePath(name), data: data.slice() });
  }

  if (manifest == null) {
    throw new SnapshotError("invalid book snapshot: missing manifest");
  }

  for (const entry of restored) {
    await store.write(entry.path, entry.data);
  }
}
