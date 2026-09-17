import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  PATHS,
  type Progress,
  type StorePort,
} from "../src/index.js";

const initProgress = (): Progress => ({
  phase: "init",
  flow: "writing",
  totalChapters: 0,
  completedChapters: [],
  pendingRewrites: [],
  layered: false,
});

describe("MemoryStore", () => {
  it("round-trips UTF-8 text and JSON via StorePort", async () => {
    const store = new MemoryStore();
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
    const store = new MemoryStore();
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
    const store = new MemoryStore();
    await expect(store.write("..", "x")).rejects.toThrow(/invalid store path/);
    await expect(store.write("a/../b", "x")).rejects.toThrow(/invalid store path/);
    await expect(store.write("", "x")).rejects.toThrow(/invalid store path/);
  });

  it("assembles route state: foundation missing then writing snapshot", async () => {
    const store = new MemoryStore();
    await store.saveProgress(initProgress());

    const empty = await store.loadState();
    expect(empty.progress?.phase).toBe("init");
    expect(empty.planningTier).toBe("");
    expect(empty.foundationMissing).toEqual([
      "book",
      "premise",
      "outline",
      "characters",
      "world_rules",
    ]);

    await store.write(
      PATHS.book,
      JSON.stringify({ title: "无主的信", synopsis: "一封没有寄信人的信" }),
    );
    await store.write(PATHS.premise, "premise");
    await store.write(
      PATHS.outline,
      JSON.stringify([{ chapter: 1, title: "风暴之后" }]),
    );
    await store.write(PATHS.characters, JSON.stringify([{ name: "林守" }]));
    await store.write(
      PATHS.worldRules,
      JSON.stringify([{ name: "信与潮", description: "涨潮来信" }]),
    );

    const pendingAudit = await store.loadState();
    expect(pendingAudit.foundationMissing).toEqual(["foundation_audit"]);

    await store.saveProgress({
      phase: "writing",
      flow: "writing",
      totalChapters: 3,
      completedChapters: [1],
      pendingRewrites: [],
      layered: false,
    });
    const writing = await store.loadState();
    expect(writing.foundationMissing).toEqual([]);
    expect(writing.lastCompleted).toBe(1);
    expect(writing.progress?.phase).toBe("writing");
  });

  it("accepts an initial path map", async () => {
    const store = new MemoryStore({ "meta/note.txt": "ok" });
    expect(store.list("meta/")).toEqual(["meta/note.txt"]);
    expect(await store.readText("meta/note.txt")).toBe("ok");
  });

  it("remove() deletes a path and is a no-op when missing", async () => {
    const store = new MemoryStore({ "meta/note.txt": "ok" });
    await store.remove("meta/note.txt");
    expect(await store.has("meta/note.txt")).toBe(false);
    await store.remove("meta/note.txt");
  });
});
