/**
 * Book snapshot export / import round-trip (browser-safe zip via fflate).
 * 书籍快照：把 StorePort 里的全部路径打成 zip，再 merge 进另一个 store。
 *
 * Restore overwrites snapshot paths; extra files already in the destination stay.
 * Manifest `.novel-engine-snapshot.json` is inside the zip only — not written to the store.
 */

import {
  BOOK_SNAPSHOT_FORMAT,
  BOOK_SNAPSHOT_VERSION,
  exportBookSnapshot,
  importBookSnapshot,
  MemoryStore,
  SnapshotError,
} from "novel-engine";

export async function roundTrip(): Promise<void> {
  const source = new MemoryStore();
  await source.write("meta/note.txt", "keep-me-source");
  await source.write("chapters/01.md", "蜡封的瓶子");

  const bytes = await exportBookSnapshot(source); // Uint8Array zip (PK magic)

  const dest = new MemoryStore({ "extra/host.json": "{\"ok\":true}" });
  try {
    await importBookSnapshot(dest, bytes);
  } catch (err) {
    if (err instanceof SnapshotError) {
      throw err; // invalid zip, missing/unknown manifest, or path escape
    }
    throw err;
  }

  // Merge: snapshot paths overwritten; extra dest files kept.
  console.log(await dest.readText("chapters/01.md")); // 蜡封的瓶子
  console.log(await dest.readText("extra/host.json")); // {"ok":true}

  void BOOK_SNAPSHOT_FORMAT; // "novel-engine-book-snapshot"
  void BOOK_SNAPSHOT_VERSION; // 1
}

void roundTrip();
