import type {
  OpfsDirectoryHandle,
  OpfsFileHandle,
  OpfsStorageManager,
  OpfsWritableFileStream,
} from "../../src/store/opfs-handles.js";

export class FakeNotFoundError extends Error {
  constructor(name: string) {
    super(`NotFoundError: ${name}`);
    this.name = "NotFoundError";
  }
}

interface FileNode {
  kind: "file";
  bytes: Uint8Array;
}

interface DirNode {
  kind: "dir";
  dir: FakeDirectory;
}

type Entry = FileNode | DirNode;

export interface FakeOpfsOptions {
  /** When false, file handles omit `move` so OpfsStore uses copy-replace. */
  supportMove?: boolean;
}

export interface FakeOpfs {
  root: FakeDirectory;
  storage: OpfsStorageManager;
  failNextWrite: () => void;
}

export function createFakeOpfs(options: FakeOpfsOptions = {}): FakeOpfs {
  const supportMove = options.supportMove !== false;
  const shared = { failWrites: 0 };
  const root = new FakeDirectory(shared, supportMove);
  return {
    root,
    storage: {
      async getDirectory() {
        return root;
      },
    },
    failNextWrite() {
      shared.failWrites += 1;
    },
  };
}

export class FakeDirectory implements OpfsDirectoryHandle {
  readonly entries = new Map<string, Entry>();

  constructor(
    private readonly shared: { failWrites: number },
    private readonly supportMove: boolean,
  ) {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsDirectoryHandle> {
    const existing = this.entries.get(name);
    if (existing?.kind === "dir") {
      return existing.dir;
    }
    if (existing) {
      throw new Error(`TypeMismatchError: ${name} is a file`);
    }
    if (!options?.create) {
      throw new FakeNotFoundError(name);
    }
    const dir = new FakeDirectory(this.shared, this.supportMove);
    this.entries.set(name, { kind: "dir", dir });
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle> {
    const existing = this.entries.get(name);
    if (existing?.kind === "file") {
      return new FakeFileHandle(this, name, existing, this.shared, this.supportMove);
    }
    if (existing) {
      throw new Error(`TypeMismatchError: ${name} is a directory`);
    }
    if (!options?.create) {
      throw new FakeNotFoundError(name);
    }
    const node: FileNode = { kind: "file", bytes: new Uint8Array(0) };
    this.entries.set(name, node);
    return new FakeFileHandle(this, name, node, this.shared, this.supportMove);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.entries.has(name)) {
      throw new FakeNotFoundError(name);
    }
    this.entries.delete(name);
  }

  async *keys(): AsyncGenerator<string> {
    yield* this.entries.keys();
  }
}

class FakeFileHandle implements OpfsFileHandle {
  readonly move?: (name: string) => Promise<void>;

  constructor(
    private readonly parent: FakeDirectory,
    private name: string,
    private node: FileNode,
    private readonly shared: { failWrites: number },
    supportMove: boolean,
  ) {
    if (supportMove) {
      this.move = async (dest: string) => {
        this.parent.entries.delete(this.name);
        this.parent.entries.set(dest, this.node);
        this.name = dest;
      };
    }
  }

  async getFile() {
    const copy = this.node.bytes.slice();
    return {
      async arrayBuffer() {
        return copy.buffer;
      },
    };
  }

  async createWritable(options?: { keepExistingData?: boolean }): Promise<OpfsWritableFileStream> {
    if (!options?.keepExistingData) {
      this.node.bytes = new Uint8Array(0);
    }
    const chunks: Uint8Array[] = [this.node.bytes.slice()];
    const shared = this.shared;
    const node = this.node;
    return {
      async write(data: Uint8Array | ArrayBuffer | string) {
        if (shared.failWrites > 0) {
          shared.failWrites -= 1;
          throw new Error("injected write failure");
        }
        chunks.push(toBytes(data));
      },
      async close() {
        let total = 0;
        for (const chunk of chunks) {
          total += chunk.byteLength;
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }
        node.bytes = out;
      },
    };
  }
}

function toBytes(data: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data.slice();
  }
  return new Uint8Array(data).slice();
}
