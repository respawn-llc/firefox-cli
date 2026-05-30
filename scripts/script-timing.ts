export type PollUntilOptions = {
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly timeoutMessage: () => string;
  readonly signal?: AbortSignal;
};

export type WithTimeoutOptions = {
  readonly timeoutMs: number;
  readonly timeoutMessage: () => string;
  readonly onTimeout?: () => Promise<void> | void;
  readonly createError?: (message: string) => Error;
  readonly signal?: AbortSignal;
};

export async function pollUntil<T>(
  check: () => Promise<T | false>,
  options: PollUntilOptions,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    throwIfAborted(options.signal);
    const value = await check();
    if (value !== false) {
      return value;
    }
    await sleep(options.intervalMs, options.signal);
  }

  throw new Error(options.timeoutMessage());
}

export async function withTimeout<T>(promise: Promise<T>, options: WithTimeoutOptions): Promise<T> {
  throwIfAborted(options.signal);
  let timeout: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        const rejectWithTimeout = async (): Promise<void> => {
          try {
            await options.onTimeout?.();
            const message = options.timeoutMessage();
            reject(options.createError?.(message) ?? new Error(message));
          } catch (error) {
            reject(error);
          }
        };
        timeout = setTimeout(() => {
          void rejectWithTimeout();
        }, options.timeoutMs);
        if (options.signal !== undefined) {
          abortListener = () => {
            if (timeout !== undefined) {
              clearTimeout(timeout);
            }
            reject(createAbortError());
          };
          options.signal.addEventListener("abort", abortListener, { once: true });
        }
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (options.signal !== undefined && abortListener !== undefined) {
      options.signal.removeEventListener("abort", abortListener);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolveSleep, rejectSleep) => {
    let abortListener: (() => void) | undefined;
    const cleanup = (): void => {
      clearTimeout(timeout);
      if (signal !== undefined && abortListener !== undefined) {
        signal.removeEventListener("abort", abortListener);
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolveSleep();
    }, ms);
    if (signal === undefined) {
      return;
    }

    abortListener = () => {
      cleanup();
      rejectSleep(createAbortError());
    };
    signal.addEventListener("abort", abortListener, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  return new Error("Operation aborted.");
}
