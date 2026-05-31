import { BrowserCommandError } from "./errors.js";

export interface BrowserCommandDeadline {
  readonly timeoutMs: number;
  readonly elapsedMs: () => number;
  readonly remainingMs: () => number;
  throwIfExpired(message: () => string): void;
  run<T>(operation: Promise<T>, message: () => string): Promise<T>;
  sleep(intervalMs: number, message: () => string): Promise<void>;
}

export function createBrowserCommandDeadline(timeoutMs: number): BrowserCommandDeadline {
  const startedAt = Date.now();
  const elapsedMs = (): number => Math.max(0, Date.now() - startedAt);
  const remainingMs = (): number => Math.max(0, timeoutMs - elapsedMs());
  const throwIfExpired = (message: () => string): void => {
    if (remainingMs() <= 0) {
      throw new BrowserCommandError("TIMEOUT", message());
    }
  };

  return {
    timeoutMs,
    elapsedMs,
    remainingMs,
    throwIfExpired,
    run: async (operation, message) =>
      withBrowserCommandDeadline(operation, remainingMs(), () => {
        throwIfExpired(message);
        return message();
      }),
    sleep: async (intervalMs, message) =>
      withBrowserCommandDeadline(new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs()))), remainingMs(), () => {
        throwIfExpired(message);
        return message();
      }),
  };
}

export async function withBrowserCommandDeadline<T>(operation: Promise<T>, timeoutMs: number, message: () => string): Promise<T> {
  if (timeoutMs <= 0) {
    throw new BrowserCommandError("TIMEOUT", message());
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new BrowserCommandError("TIMEOUT", message()));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
