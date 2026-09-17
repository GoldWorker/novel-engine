import type { FoundationGap } from "./types.js";

export class FoundationIncompleteError extends Error {
  readonly gaps: FoundationGap[];

  constructor(gaps: FoundationGap[]) {
    const keys = gaps.map((gap) => gap.key).join(", ");
    super(keys === "" ? "foundation incomplete" : `foundation incomplete: ${keys}`);
    this.name = "FoundationIncompleteError";
    this.gaps = gaps;
  }
}

export class SessionClosedError extends Error {
  constructor(message = "session is closed") {
    super(message);
    this.name = "SessionClosedError";
  }
}

export class WorkspaceClosedError extends Error {
  constructor(message = "workspace is closed") {
    super(message);
    this.name = "WorkspaceClosedError";
  }
}

export class BookNotFoundError extends Error {
  readonly bookId: string;

  constructor(bookId: string) {
    super(`book not found: ${bookId}`);
    this.name = "BookNotFoundError";
    this.bookId = bookId;
  }
}
