/**
 * Logical store paths are POSIX-style, relative, and never escape the store root.
 */
export function normalizeStorePath(path: string): string {
  const trimmed = path.replace(/\\/g, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
  if (trimmed === "" || trimmed.split("/").includes("..")) {
    throw new Error(`invalid store path: ${path}`);
  }
  return trimmed;
}
