import { describe, expect, it } from "vitest";
import layeredBook from "../fixtures/layered-book.json" with { type: "json" };
import shortBook from "../fixtures/short-book.json" with { type: "json" };
import {
  MemoryStore,
  PATHS,
  exportBookSnapshot,
  writeJson,
  writeText,
  type Progress,
} from "../src/index.js";
import {
  BookNotFoundError,
  FoundationIncompleteError,
  SessionClosedError,
  WorkspaceClosedError,
  createNovelSession,
  createNovelWorkspace,
  WORKSPACE_INDEX_PATH,
} from "../src/session/index.js";

const short = shortBook as {
  book: { title: string; synopsis: string };
  premise: string;
  outline: unknown[];
  characters: unknown[];
  world_rules: unknown[];
};

const layered = layeredBook as {
  prompt: string;
  book: { title: string; synopsis: string };
  premise: string;
  layered_outline: unknown[];
  characters: unknown[];
  world_rules: unknown[];
};

const writing = (layeredFlag: boolean): Progress => ({
  phase: "writing",
  flow: "writing",
  totalChapters: layeredFlag ? 4 : 3,
  completedChapters: [],
  pendingRewrites: [],
  layered: layeredFlag,
});

describe("NovelSession", () => {
  it("getFoundation round-trips manual writeJson/writeText", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "letter" });

    const empty = await session.getFoundation();
    expect(empty.book).toBeNull();
    expect(empty.premise).toBeNull();
    expect(empty.outline).toBeNull();
    expect(empty.layeredOutline).toBeNull();
    expect(empty.progress).toBeNull();

    await writeJson(store, PATHS.book, short.book);
    await writeText(store, PATHS.premise, short.premise);
    await writeJson(store, PATHS.outline, short.outline);
    await writeJson(store, PATHS.characters, short.characters);
    await writeJson(store, PATHS.worldRules, short.world_rules);

    const meta = await session.getFoundation();
    expect(meta.book).toEqual(short.book);
    expect(meta.premise).toBe(short.premise);
    expect(meta.outline).toEqual(short.outline);
    expect(meta.characters).toEqual(short.characters);
    expect(meta.worldRules).toEqual(short.world_rules);
  });

  it("inspectFoundation returns bilingual hints; readyToWrite follows foundation.ts", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "inspect" });

    const empty = await session.inspectFoundation({ prompt: "写一本三章短篇" });
    expect(empty.planning.tier).toBe("short");
    expect(empty.planning.source).toBe("prompt");
    expect(empty.readyToWrite).toBe(false);
    expect(empty.auditOnly).toBe(false);
    expect(empty.gaps.map((gap) => gap.key)).toEqual([
      "book",
      "premise",
      "outline",
      "characters",
      "world_rules",
    ]);
    const outlineGap = empty.gaps.find((gap) => gap.key === "outline");
    expect(outlineGap?.path).toBe(PATHS.outline);
    expect(outlineGap?.requiredFor).toBe("short");
    expect(outlineGap?.hint).toMatch(/短篇/);
    expect(outlineGap?.hint).toMatch(/outline\.json/);

    await writeJson(store, PATHS.book, short.book);
    await writeText(store, PATHS.premise, short.premise);
    await writeJson(store, PATHS.outline, short.outline);
    await writeJson(store, PATHS.characters, short.characters);
    await writeJson(store, PATHS.worldRules, short.world_rules);

    const pending = await session.inspectFoundation();
    expect(pending.readyToWrite).toBe(false);
    expect(pending.gaps).toEqual([
      expect.objectContaining({
        key: "foundation_audit",
        path: PATHS.foundationAudit,
      }),
    ]);
    expect(pending.gaps[0]?.hint).toMatch(/audit_foundation|confirmAuditGap/);
    expect(pending.auditOnly).toBe(true);
    expect(pending.gaps[0]?.kind).toBe("audit");

    await expect(session.assertReadyToWrite()).rejects.toBeInstanceOf(FoundationIncompleteError);
    try {
      await session.assertReadyToWrite();
      throw new Error("expected FoundationIncompleteError");
    } catch (err) {
      expect(err).toBeInstanceOf(FoundationIncompleteError);
      if (err instanceof FoundationIncompleteError) {
        expect(err.gaps.map((gap) => gap.key)).toEqual(["foundation_audit"]);
      }
    }

    await store.saveProgress(writing(false));
    const ready = await session.inspectFoundation();
    expect(ready.readyToWrite).toBe(true);
    expect(ready.gaps).toEqual([]);
    await session.assertReadyToWrite();
  });

  it("inspectFoundation uses prompt/run_meta so layered-only mid books omit the outline gap", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "layered" });
    await writeJson(store, PATHS.book, layered.book);
    await writeText(store, PATHS.premise, layered.premise);
    await writeJson(store, PATHS.layeredOutline, layered.layered_outline);
    await writeJson(store, PATHS.characters, layered.characters);

    const mid = await session.inspectFoundation({ prompt: layered.prompt });
    expect(mid.planning.tier).toBe("mid");
    expect(mid.gaps.map((gap) => gap.key)).toEqual(["world_rules"]);
    expect(mid.gaps[0]?.hint).toMatch(/world_rules/);
    expect(mid.meta.layeredOutline).not.toBeNull();
    expect(mid.meta.outline).toBeNull();

    const asShort = await session.inspectFoundation({ prompt: "写一本三章短篇" });
    expect(asShort.planning.tier).toBe("short");
    expect(asShort.gaps.map((gap) => gap.key)).toContain("outline");

    await writeJson(store, PATHS.worldRules, layered.world_rules);
    await writeJson(store, PATHS.runMeta, { planningTier: "long" });
    const fromMeta = await session.inspectFoundation();
    expect(fromMeta.planning.tier).toBe("long");
    expect(fromMeta.planning.source).toBe("run_meta");
    expect(fromMeta.gaps.map((gap) => gap.key)).toEqual(["foundation_audit"]);

    await store.saveProgress(writing(true));
    const ready = await session.inspectFoundation();
    expect(ready.readyToWrite).toBe(true);
  });

  it("listArtifacts and snapshot wrappers use the store; close rejects further calls", async () => {
    const store = new MemoryStore();
    const session = await createNovelSession({ store, bookId: "snap" });
    await writeText(store, PATHS.premise, "灯塔");
    expect(await session.listArtifacts()).toContain(PATHS.premise);
    expect(await session.listArtifacts("premise")).toEqual([PATHS.premise]);

    const bytes = await session.exportSnapshot();
    const dest = new MemoryStore();
    const other = await createNovelSession({ store: dest, bookId: "copy" });
    await other.importSnapshot(bytes);
    expect(await dest.readText(PATHS.premise)).toBe("灯塔");

    session.close();
    await expect(session.getProgress()).rejects.toBeInstanceOf(SessionClosedError);
    await expect(session.listArtifacts()).rejects.toBeInstanceOf(SessionClosedError);
  });
});

describe("NovelWorkspace", () => {
  it("create A, write progress, create B, switchTo B then A restores progress", async () => {
    const stores = new Map<string, MemoryStore>();
    const ws = createNovelWorkspace({
      createStore(bookId) {
        const existing = stores.get(bookId);
        if (existing) {
          return existing;
        }
        const store = new MemoryStore();
        stores.set(bookId, store);
        return store;
      },
    });

    const createdA = await ws.createBook({ bookId: "book-a", title: "无主的信" });
    expect(createdA.bookId).toBe("book-a");
    expect(ws.currentBookId).toBe("book-a");
    await stores.get("book-a")!.saveProgress(writing(false));
    expect(await createdA.session.getProgress()).toMatchObject({ phase: "writing", layered: false });

    const createdB = await ws.createBook({ bookId: "book-b", title: "两弧灯塔" });
    expect(ws.currentBookId).toBe("book-b");
    await expect(createdA.session.getProgress()).rejects.toBeInstanceOf(SessionClosedError);
    await stores.get("book-b")!.saveProgress({ ...writing(true), totalChapters: 4 });

    const onB = await ws.switchTo("book-b");
    expect(onB).toBe(createdB.session);
    expect(await onB.getProgress()).toMatchObject({ layered: true, totalChapters: 4 });

    const backA = await ws.switchTo("book-a");
    expect(backA.bookId).toBe("book-a");
    expect(await backA.getProgress()).toMatchObject({ phase: "writing", layered: false });
    await expect(onB.getProgress()).rejects.toBeInstanceOf(SessionClosedError);

    const listed = await ws.listBooks();
    expect(listed.map((row) => row.bookId)).toEqual(["book-a", "book-b"]);
    expect(listed[0]?.title).toBe("无主的信");
  });

  it("persists _index.json when an indexStore is provided", async () => {
    const indexStore = new MemoryStore();
    const ws = createNovelWorkspace({
      createStore: () => new MemoryStore(),
      indexStore,
    });
    await ws.createBook({ bookId: "alpha", title: "Alpha" });
    expect(await indexStore.has(WORKSPACE_INDEX_PATH)).toBe(true);

    const restored = createNovelWorkspace({
      createStore: () => new MemoryStore(),
      indexStore,
    });
    const books = await restored.listBooks();
    expect(books).toEqual([
      expect.objectContaining({ bookId: "alpha", title: "Alpha" }),
    ]);
    await expect(restored.open("missing")).rejects.toBeInstanceOf(BookNotFoundError);
  });

  it("rejects use after workspace close", async () => {
    const ws = createNovelWorkspace({ createStore: () => new MemoryStore() });
    const { session } = await ws.createBook({ bookId: "z" });
    await ws.close();
    await expect(session.getFoundation()).rejects.toBeInstanceOf(SessionClosedError);
    await expect(ws.listBooks()).rejects.toBeInstanceOf(WorkspaceClosedError);
  });
});

describe("session snapshot helper (sanity)", () => {
  it("exportBookSnapshot still matches session.exportSnapshot", async () => {
    const store = new MemoryStore({ "meta/note.txt": "ok" });
    const session = await createNovelSession({ store, bookId: "n" });
    expect(await session.exportSnapshot()).toEqual(await exportBookSnapshot(store));
  });
});
