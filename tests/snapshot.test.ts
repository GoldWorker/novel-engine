import { unzipSync } from "fflate/browser";
import { describe, expect, it } from "vitest";
import snapshotFixture from "../fixtures/book-snapshot.json" with { type: "json" };
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  BOOK_SNAPSHOT_FORMAT,
  BOOK_SNAPSHOT_MANIFEST_PATH,
  BOOK_SNAPSHOT_VERSION,
  MemoryStore,
  OpfsStore,
  PATHS,
  SnapshotError,
  createEngine,
  exportBookSnapshot,
  importBookSnapshot,
  MockLlm,
  type Progress,
  type StorePort,
  type State,
} from "../src/index.js";
import { createFakeOpfs } from "./helpers/fake-opfs.js";
import { shortBookLlmHandler, type ShortBookFixture } from "./helpers/short-book-llm.js";

const fixtureFiles = snapshotFixture as Record<string, unknown>;

async function seedJsonTree(
  store: StorePort,
  tree: Record<string, unknown>,
): Promise<void> {
  for (const [path, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      await store.write(path, value);
    } else {
      await store.write(path, `${JSON.stringify(value, null, 2)}\n`);
    }
  }
}

async function expectSameFiles(source: MemoryStore, dest: MemoryStore): Promise<void> {
  expect(dest.list()).toEqual(source.list());
  for (const path of source.list()) {
    expect(await dest.read(path)).toEqual(await source.read(path));
  }
}

describe("exportBookSnapshot / importBookSnapshot", () => {
  it("round-trips a MemoryStore fixture (text + nested paths)", async () => {
    const source = new MemoryStore();
    await seedJsonTree(source, fixtureFiles);

    const bytes = await exportBookSnapshot(source);
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K

    const dest = new MemoryStore();
    await importBookSnapshot(dest, bytes);
    await expectSameFiles(source, dest);

    const progress = await dest.loadProgress();
    expect(progress?.phase).toBe("writing");
    expect(progress?.completedChapters).toEqual([1]);
    expect(await dest.readText("chapters/01.md")).toContain("蜡封的瓶子");
    expect(dest.list()).not.toContain(BOOK_SNAPSHOT_MANIFEST_PATH);
  });

  it("preserves binary artifacts", async () => {
    const source = new MemoryStore();
    const blob = new Uint8Array([0, 1, 2, 255, 10, 0]);
    await source.write("assets/cover.bin", blob);

    const dest = new MemoryStore();
    await importBookSnapshot(dest, await exportBookSnapshot(source));
    expect(await dest.read("assets/cover.bin")).toEqual(blob);
  });

  it("merges into the destination without deleting extra files", async () => {
    const source = new MemoryStore({ "meta/note.txt": "keep-me-source" });
    const dest = new MemoryStore({ "extra/host.json": "{\"ok\":true}" });
    await importBookSnapshot(dest, await exportBookSnapshot(source));
    expect(await dest.readText("meta/note.txt")).toBe("keep-me-source");
    expect(await dest.readText("extra/host.json")).toBe("{\"ok\":true}");
  });

  it("exports an empty store as a zip that still imports", async () => {
    const bytes = await exportBookSnapshot(new MemoryStore());
    const unzipped = unzipSync(bytes);
    const manifest = JSON.parse(
      new TextDecoder().decode(unzipped[BOOK_SNAPSHOT_MANIFEST_PATH]),
    ) as { format: string; version: number; files: number };
    expect(manifest.format).toBe(BOOK_SNAPSHOT_FORMAT);
    expect(manifest.version).toBe(BOOK_SNAPSHOT_VERSION);
    expect(manifest.files).toBe(0);

    const dest = new MemoryStore();
    await importBookSnapshot(dest, bytes);
    expect(dest.list()).toEqual([]);
  });

  it("uses StorePort.list so custom paths are included", async () => {
    const source = new MemoryStore();
    await source.write("notes/host-only.txt", "灯塔");
    const dest = new MemoryStore();
    await importBookSnapshot(dest, await exportBookSnapshot(source));
    expect(await dest.readText("notes/host-only.txt")).toBe("灯塔");
  });

  it("probes known book paths when list() is absent", async () => {
    const files = new Map<string, Uint8Array>();
    const encoder = new TextEncoder();
    const store: StorePort = {
      async loadState(): Promise<State> {
        return {};
      },
      async loadProgress() {
        const raw = files.get(PATHS.progress);
        return raw ? (JSON.parse(new TextDecoder().decode(raw)) as Progress) : null;
      },
      async saveProgress() {},
      async read(path) {
        return files.get(path)?.slice() ?? null;
      },
      async write(path, data) {
        files.set(
          path,
          typeof data === "string" ? encoder.encode(data) : data.slice(),
        );
      },
      async has(path) {
        return files.has(path);
      },
    };

    const progress: Progress = {
      phase: "writing",
      flow: "writing",
      totalChapters: 3,
      completedChapters: [1],
      pendingRewrites: [],
      layered: false,
    };
    await store.write(PATHS.progress, `${JSON.stringify(progress)}\n`);
    await store.write("chapters/01.md", "一章");
    await store.write("notes/skipped.txt", "not in layout");

    const dest = new MemoryStore();
    await importBookSnapshot(dest, await exportBookSnapshot(store));
    expect(await dest.readText("chapters/01.md")).toBe("一章");
    expect(await dest.has(PATHS.progress)).toBe(true);
    expect(await dest.has("notes/skipped.txt")).toBe(false);
  });

  it("rejects truncated or non-zip bytes", async () => {
    const dest = new MemoryStore();
    await expect(importBookSnapshot(dest, new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      SnapshotError,
    );
    await expect(importBookSnapshot(dest, new Uint8Array(64))).rejects.toThrow(
      /invalid book snapshot/,
    );
  });

  it("rejects a zip that is missing the manifest", async () => {
    const { zipSync } = await import("fflate/browser");
    const bytes = zipSync({ "meta/progress.json": new TextEncoder().encode("{}") });
    await expect(importBookSnapshot(new MemoryStore(), bytes)).rejects.toThrow(
      /missing manifest/,
    );
  });

  it("rejects zip entries that escape the store root", async () => {
    const { zipSync } = await import("fflate/browser");
    const manifest = new TextEncoder().encode(
      JSON.stringify({
        format: BOOK_SNAPSHOT_FORMAT,
        version: BOOK_SNAPSHOT_VERSION,
        files: 1,
      }),
    );
    const bytes = zipSync({
      [BOOK_SNAPSHOT_MANIFEST_PATH]: manifest,
      "../escape.txt": new TextEncoder().encode("nope"),
    });
    await expect(importBookSnapshot(new MemoryStore(), bytes)).rejects.toThrow(
      /invalid snapshot path/,
    );
  });
});

describe("book snapshot via OpfsStore", () => {
  it("lists nested files and round-trips through MemoryStore", async () => {
    const fake = createFakeOpfs();
    const opfs = await OpfsStore.open({ root: fake.root, directory: "" });
    await seedJsonTree(opfs, fixtureFiles);
    await opfs.write("notes/opfs.txt", "持久化");

    const listed = await opfs.list();
    expect(listed).toContain("chapters/01.md");
    expect(listed).toContain("notes/opfs.txt");
    expect(listed.some((path) => path.endsWith(".tmp"))).toBe(false);

    const dest = new MemoryStore();
    await importBookSnapshot(dest, await exportBookSnapshot(opfs));
    expect(await dest.readText("notes/opfs.txt")).toBe("持久化");
    expect(await dest.readText("chapters/01.md")).toContain("蜡封的瓶子");
  });
});

describe("Engine short-book snapshot round-trip", () => {
  it("restores progress, chapters, and checkpoints after a mock run", async () => {
    const book = shortBook as ShortBookFixture;
    const source = new MemoryStore();
    const llm = MockLlm.fromHandler(shortBookLlmHandler(book));
    const result = await createEngine({ store: source, llm, maxSteps: 20 }).run({
      prompt: book.prompt,
    });
    expect(result.stoppedReason).toBe("complete");

    const dest = new MemoryStore();
    await importBookSnapshot(dest, await exportBookSnapshot(source));

    const progress = await dest.loadProgress();
    expect(progress?.phase).toBe("complete");
    expect(progress?.completedChapters).toEqual([1, 2, 3]);
    expect(await dest.readText("chapters/01.md")).toContain("蜡封的瓶子");
    expect(await dest.readText("chapters/03.md")).toContain("灯盏");
    expect(await dest.has(PATHS.checkpoints)).toBe(true);
    expect(dest.list()).toEqual(source.list());
  });
});
