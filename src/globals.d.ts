/** Present in browsers and Node ≥18. Avoid pulling the full DOM lib into this package. */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: Uint8Array): string;
}

declare function queueMicrotask(callback: () => void): void;
declare function setTimeout(handler: () => void, timeout?: number): unknown;

/** Present in browsers and Node ≥18. Used by kit worker URL resolution. */
interface ImportMeta {
  url: string;
}

declare class URL {
  constructor(url: string | URL, base?: string | URL);
}

/**
 * Minimal AbortSignal / AbortController (browsers and Node ≥18).
 * Avoid pulling the full DOM lib into this package.
 */
interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: boolean | { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
