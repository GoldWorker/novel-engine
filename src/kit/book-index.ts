import type { StorePort } from "../ports/store.js";
import { readJson, writeJson } from "../store/io.js";
import type { BookIndexEntry, WorkspaceIndex } from "../session/types.js";
import { WORKSPACE_INDEX_PATH } from "../session/types.js";

/**
 * Lightweight book list for worker-runtime kits. Same `_index.json` shape as
 * `createNovelWorkspace`. Main-thread kits use `NovelWorkspace` instead.
 */
export class KitBookIndex {
  private readonly books = new Map<string, BookIndexEntry>();
  private loaded = false;

  constructor(private readonly indexStore: StorePort) {}

  async list(): Promise<BookIndexEntry[]> {
    await this.ensureLoaded();
    return [...this.books.values()].map((entry) => ({ ...entry }));
  }

  async has(bookId: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.books.has(bookId);
  }

  async add(entry: BookIndexEntry, currentBookId?: string): Promise<void> {
    await this.ensureLoaded();
    this.books.set(entry.bookId, { ...entry });
    await this.persist(currentBookId);
  }

  async setCurrent(currentBookId: string): Promise<void> {
    await this.ensureLoaded();
    await this.persist(currentBookId);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const data = await readJson<WorkspaceIndex>(this.indexStore, WORKSPACE_INDEX_PATH);
    if (data == null || !Array.isArray(data.books)) {
      return;
    }
    for (const entry of data.books) {
      if (typeof entry?.bookId === "string" && entry.bookId.trim() !== "") {
        this.books.set(entry.bookId, { ...entry });
      }
    }
  }

  private async persist(currentBookId?: string): Promise<void> {
    const payload: WorkspaceIndex = {
      version: 1,
      books: [...this.books.values()].map((entry) => ({ ...entry })),
    };
    if (currentBookId !== undefined) {
      payload.currentBookId = currentBookId;
    }
    await writeJson(this.indexStore, WORKSPACE_INDEX_PATH, payload);
  }
}

export function generateBookId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `book-${Date.now().toString(36)}-${rand}`;
}
