import { describe, expect, it } from "vitest";
import { PendingRequestTracker } from "./request-tracker.js";

describe("PendingRequestTracker", () => {
  it("rejects duplicate IDs without replacing the original pending request", async () => {
    const tracker = createStringTracker();
    const first = tracker.track({ id: "request-1", command: "noop" });
    const duplicate = tracker.track({ id: "request-1", command: "tabs.list" });

    expect(duplicate).toEqual({ ok: false, value: "duplicate:request-1" });
    expect(tracker.size).toBe(1);
    expect(tracker.settle("request-1", "ok")).toEqual({ ok: true, command: "noop" });
    if (first.ok) {
      await expect(first.promise).resolves.toBe("ok");
    }
  });

  it("settles requests with timeout values and ignores late responses", async () => {
    const scheduler = createManualScheduler();
    const tracker = createStringTracker({
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
    });
    const pending = tracker.track({ id: "request-1", command: "noop" });

    scheduler.runNext();

    expect(tracker.size).toBe(0);
    expect(tracker.settle("request-1", "late")).toEqual({ ok: false });
    if (pending.ok) {
      await expect(pending.promise).resolves.toBe("timeout:request-1");
    }
  });

  it("cancels one pending request without draining unrelated requests", async () => {
    const tracker = createStringTracker();
    const first = tracker.track({ id: "request-1", command: "noop" });
    const second = tracker.track({ id: "request-2", command: "tabs.list" });

    expect(tracker.cancel("request-1", "cancelled")).toEqual({ ok: true, command: "noop" });
    expect(tracker.size).toBe(1);
    expect(tracker.settle("request-2", "ok")).toEqual({ ok: true, command: "tabs.list" });

    if (first.ok) {
      await expect(first.promise).resolves.toBe("cancelled");
    }
    if (second.ok) {
      await expect(second.promise).resolves.toBe("ok");
    }
  });

  it("drains all pending requests with caller-provided values", async () => {
    const tracker = createStringTracker();
    const first = tracker.track({ id: "request-1", command: "noop" });
    const second = tracker.track({ id: "request-2", command: "tabs.list" });

    expect(tracker.drain((request) => `drained:${request.id}:${request.command}`)).toBe(2);
    expect(tracker.size).toBe(0);

    if (first.ok) {
      await expect(first.promise).resolves.toBe("drained:request-1:noop");
    }
    if (second.ok) {
      await expect(second.promise).resolves.toBe("drained:request-2:tabs.list");
    }
  });
});

function createStringTracker(
  options: {
    readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  } = {},
): PendingRequestTracker<string, string> {
  return new PendingRequestTracker<string, string>({
    timeoutMs: 100,
    onDuplicate: (request) => `duplicate:${request.id}`,
    onTimeout: (request) => `timeout:${request.id}`,
    ...options,
  });
}

function createManualScheduler(): {
  readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  runNext(): void;
} {
  const scheduled: (() => void)[] = [];
  return {
    setTimer: (callback) => {
      scheduled.push(callback);
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (timer) => {
      const index = Number(timer) - 1;
      if (index >= 0) {
        scheduled[index] = () => undefined;
      }
    },
    runNext: () => {
      scheduled.shift()?.();
    },
  };
}
