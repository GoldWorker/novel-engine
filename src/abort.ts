/**
 * Cooperative cancellation. Hosts opt in via `AbortSignal` and/or `cancel()`.
 * Idle cancel is a no-op; non-abort success paths are unchanged.
 */
export class AbortedError extends Error {
  constructor(message = "operation aborted") {
    super(message);
    this.name = "AbortedError";
  }
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof AbortedError) {
    return true;
  }
  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as { name: unknown }).name;
    return name === "AbortError" || name === "AbortedError";
  }
  return false;
}

export function toAbortedError(err: unknown): AbortedError {
  if (err instanceof AbortedError) {
    return err;
  }
  return new AbortedError();
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AbortedError();
  }
}

/** Reject when `signal` aborts even if the underlying promise ignores it. */
export async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new AbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(isAbortError(err) ? toAbortedError(err) : err);
      },
    );
  });
}

export function attachAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (signal === undefined) {
    return () => {};
  }
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort);
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}
