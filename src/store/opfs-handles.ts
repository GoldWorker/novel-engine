/**
 * Narrow OPFS / File System Access types used by `OpfsStore`.
 * Declared here so the library stays off the full DOM lib.
 */

export interface OpfsWritableFileStream {
  write(data: Uint8Array | ArrayBuffer | string): Promise<void>;
  close(): Promise<void>;
}

export interface OpfsFile {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface OpfsFileHandle {
  getFile(): Promise<OpfsFile>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<OpfsWritableFileStream>;
  /** Chromium OPFS supports rename-in-place; used for atomic replace. */
  move?(name: string): Promise<void>;
}

export interface OpfsDirectoryHandle {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  /** File System Access `keys()` — used by `OpfsStore.list`. */
  keys?(): AsyncIterableIterator<string>;
}

export interface OpfsStorageManager {
  getDirectory(): Promise<OpfsDirectoryHandle>;
}
