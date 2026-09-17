import { describe, expect, it } from "vitest";
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  createEngine,
  createOpfsStore,
  isOpfsAvailable,
  MemoryStore,
  MockLlm,
  OpfsStore,
  OpfsUnavailableError,
  PATHS,
  type Progress,
  type StorePort,
} from "../src/index.js";
import { createFakeOpfs } from "./helpers/fake-opfs.js";
import { shortBookLlmHandler, type ShortBookFixture } from "./helpers/short-book-llm.js";

const initProgress = (): Progress => ({
  phase: "init",
  flow: "writing",
  totalChapters: 0,
  completedChapters: [],
  pendingRewrites: [],
  layered: false,
});

describe("isOpfsAvailable / createOpfsStore fallback", () => {
  it("is false in Node without navigator.storage.getDirectory", () => {
    expect(isOpfsAvailable()).toBe(false);
  });

  it("is true when a storage manager fake is passed", () => {
    const fake = createFakeOpfs();
    expect(isOpfsAvailable(fake.storage)).toBe(true);
  });

  it("falls back to MemoryStore when OPFS is missing", async () => {
    const store = await createOpfsStore();
    expect(store).toBeInstanceOf(MemoryStore);
    await store.write("hello.txt", "灯塔");
    expect(await store.has("hello.txt")).toBe(true);
  });

  it("throws when fallback is disabled and OPFS is missing", async () => {
    await expect(createOpfsStore({ fallbackToMemory: false })).rejects.toBeInstanceOf(
      OpfsUnavailableError,
    );
  });

  it("opens OpfsStore when a fake root is injected", async () => {
    const fake = createFakeOpfs();
    const store = await createOpfsStore({ root: fake.root, directory: "" });
    expect(store).toBeInstanceOf(OpfsStore);
  });
});

describe("OpfsStore CRUD (in-memory OPFS shim)", () => {
  it("round-trips UTF-8 text and JSON via StorePort", async () => {
    const fake = createFakeOpfs();
    const store = await OpfsStore.open({ root: fake.root, directory: "" });
    const port: StorePort = store;

    await port.write("notes/hello.txt", "灯塔");
    expect(await port.has("notes/hello.txt")).toBe(true);
    expect(await store.readText("notes/hello.txt")).toBe("灯塔");

    await store.saveProgress(initProgress());
    const loaded = await port.loadProgress();
    expect(loaded?.phase).toBe("init");
    expect(await port.has(PATHS.progress)).toBe(true);
  });

  it("returns null for missing paths and copies bytes on read", async () => {
    const fake = createFakeOpfs();
    const store = await OpfsStore.open({ root: fake.root, directory: "" });
    expect(await store.read("nope.bin")).toBeNull();
    expect(await store.has("nope.bin")).toBe(false);

    await store.write("data.bin", new Uint8Array([1, 2, 3]));
    const first = await store.read("data.bin");
    expect(first).toEqual(new Uint8Array([1, 2, 3]));
    if (!first) {
      throw new Error("expected bytes");
    }
    first[0] = 9;
    const second = await store.read("data.bin");
    expect(second).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects empty paths and parent-segment escapes", async () => {
    const fake = createFakeOpfs();
    const store = await OpfsStore.open({ root: fake.root, directory: "" });
    await expect(store.write("..", "x")).rejects.toThrow(/invalid store path/);
    await expect(store.write("a/../b", "x")).rejects.toThrow(/invalid store path/);
    await expect(store.write("", "x")).rejects.toThrow(/invalid store path/);
  });

  it("namespaces files under the default novel-engine directory", async () => {
    const fake = createFakeOpfs();
    const store = await OpfsStore.open({ root: fake.root });
    await store.write("meta/note.txt", "ok");
    const nested = fake.root.entries.get("novel-engine");
    expect(nested?.kind).toBe("dir");
  });
});

describe("OpfsStore atomicWrite", () => {
  it("replaces the destination via temp + move", async () => {
    const fake = createFakeOpfs({ supportMove: true });
    const store = await OpfsStore.open({ root: fake.root, directory: "" });
    await store.atomicWrite("chapter.md", "v1");
    await store.atomicWrite("chapter.md", "v2");
    expect(await store.readText("chapter.md")).toBe("v2");
    expect(fake.root.entries.has(".chapter.md.tmp")).toBe(false);
  });

  it("copy-replaces when FileSystemFileHandle.move is missing", async () => {
    const fake = createFakeOpfs({ supportMove: false });
    const store = await OpfsStore.open({ root: fake.root, directory: "" });
    await store.write("chapter.md", "v1");
    await store.write("chapter.md", "v2");
    expect(await store.readText("chapter.md")).toBe("v2");
    expect(fake.root.entries.has(".chapter.md.tmp")).toBe(false);
  });

  it("leaves the original file intact if the temp write fails", async () => {
    const fake = createFakeOpfs();
    const store = await OpfsStore.open({ root: fake.root, directory: "" });
    await store.write("chapter.md", "v1");
    fake.failNextWrite();
    await expect(store.write("chapter.md", "v2")).rejects.toThrow(/injected write failure/);
    expect(await store.readText("chapter.md")).toBe("v1");
  });

  it("drives the Phase 1 short-book mock on OpfsStore", async () => {
    const fake = createFakeOpfs();
    const store = await OpfsStore.open({ root: fake.root, directory: "" });
    const book = shortBook as ShortBookFixture;
    const llm = MockLlm.fromHandler(shortBookLlmHandler(book));
    const result = await createEngine({ store, llm, maxSteps: 20 }).run({ prompt: book.prompt });
    expect(result.stoppedReason).toBe("complete");
    expect((await store.loadProgress())?.completedChapters).toEqual([1, 2, 3]);
  });
});
