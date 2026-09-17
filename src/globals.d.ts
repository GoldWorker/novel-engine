/** Present in browsers and Node ≥18. Avoid pulling the full DOM lib into this package. */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: Uint8Array): string;
}

declare function queueMicrotask(callback: () => void): void;
declare function setTimeout(handler: () => void, timeout?: number): unknown;
