/** Present in browsers and Node ≥18. Avoid pulling the full DOM lib into this package. */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: Uint8Array): string;
}
