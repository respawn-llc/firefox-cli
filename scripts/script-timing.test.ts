import { describe, expect, it } from "vitest";
import { pollUntil, sleep, withTimeout } from "./script-timing.js";

describe("script timing helpers", () => {
  it("polls until a check returns a value", async () => {
    let attempts = 0;

    await expect(
      pollUntil(
        async () => {
          attempts += 1;
          return attempts === 3 ? "ready" : false;
        },
        { timeoutMs: 1000, intervalMs: 1, timeoutMessage: () => "not ready" },
      ),
    ).resolves.toBe("ready");
    expect(attempts).toBe(3);
  });

  it("runs timeout diagnostics before rejecting", async () => {
    let diagnosed = false;

    await expect(
      withTimeout(sleep(100), {
        timeoutMs: 1,
        timeoutMessage: () => "timed out",
        onTimeout: () => {
          diagnosed = true;
        },
      }),
    ).rejects.toThrow("timed out");
    expect(diagnosed).toBe(true);
  });

  it("rejects sleeps when the abort signal fires", async () => {
    const controller = new AbortController();
    const sleeping = sleep(1000, controller.signal);

    controller.abort();

    await expect(sleeping).rejects.toThrow("Operation aborted.");
  });

  it("rejects timeout races when the abort signal fires", async () => {
    const controller = new AbortController();
    const waiting = withTimeout(new Promise<never>(() => undefined), {
      timeoutMs: 1000,
      timeoutMessage: () => "timed out",
      signal: controller.signal,
    });

    controller.abort();

    await expect(waiting).rejects.toThrow("Operation aborted.");
  });
});
