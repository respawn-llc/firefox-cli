import { BrowserCommandError } from "./errors.js";

export function delay(durationMs: number | undefined): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs ?? 0));
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new BrowserCommandError("TIMEOUT", `Timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
