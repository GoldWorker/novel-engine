import type { StorePort } from "../ports/store.js";

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

export function encodeUtf8(text: string): Uint8Array {
  return utf8.encode(text);
}

export function decodeUtf8(data: Uint8Array): string {
  return utf8d.decode(data);
}

export async function readText(store: StorePort, path: string): Promise<string | null> {
  const data = await store.read(path);
  if (data == null) {
    return null;
  }
  return decodeUtf8(data);
}

export async function writeText(store: StorePort, path: string, text: string): Promise<void> {
  await store.write(path, text);
}

export async function readJson<T>(store: StorePort, path: string): Promise<T | null> {
  const text = await readText(store, path);
  if (text == null) {
    return null;
  }
  return JSON.parse(text) as T;
}

export async function writeJson(store: StorePort, path: string, value: unknown): Promise<void> {
  await store.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonl<T>(store: StorePort, path: string): Promise<T[]> {
  const text = await readText(store, path);
  if (text == null || text.trim() === "") {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function appendJsonl(store: StorePort, path: string, value: unknown): Promise<void> {
  const prev = (await readText(store, path)) ?? "";
  await store.write(path, `${prev}${JSON.stringify(value)}\n`);
}
