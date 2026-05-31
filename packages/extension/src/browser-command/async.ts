import { withBrowserCommandDeadline } from "./deadline.js";

export function delay(durationMs: number | undefined): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs ?? 0));
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return withBrowserCommandDeadline(operation, timeoutMs, () => `Timed out after ${timeoutMs}ms.`);
}
