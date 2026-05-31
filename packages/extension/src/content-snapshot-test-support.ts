import type { ResponseEnvelope } from "@firefox-cli/protocol";
import { expect } from "vitest";
import { handleContentScriptRequest as handleRawContentScriptRequest } from "./content-snapshot.js";
import type { startContentScriptRuntime } from "./content-runtime.js";
import type { HighlightScheduler } from "./content-snapshot/highlight.js";
import { createContentLogCaptureService, type ContentLogCaptureService } from "./content-snapshot/log-capture.js";

export type TestContentOptions = Omit<Parameters<typeof handleRawContentScriptRequest>[1], "logCapture"> & {
  readonly logCapture?: ContentLogCaptureService;
};

export function handleContentScriptRequest(request: Parameters<typeof handleRawContentScriptRequest>[0], options: TestContentOptions): ResponseEnvelope {
  const response = handleRawContentScriptRequest(request, {
    logCapture: createContentLogCaptureService(),
    ...options,
  });
  if (response instanceof Promise) {
    throw new Error("Expected a synchronous content script response.");
  }
  return response;
}

export async function handleAsyncContentScriptRequest(
  request: Parameters<typeof handleRawContentScriptRequest>[0],
  options: TestContentOptions,
): Promise<ResponseEnvelope> {
  return handleRawContentScriptRequest(request, {
    logCapture: createContentLogCaptureService(),
    ...options,
  });
}

export function captureConsoleLogWithoutStdout(...args: readonly unknown[]): void {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    writeConsoleLog(...args);
  } finally {
    process.stdout.write = originalWrite;
  }
}

export function getConsoleLog(): (...args: readonly unknown[]) => void {
  return globalThis.console.log.bind(globalThis.console);
}

export function setConsoleLog(log: (...args: readonly unknown[]) => void): void {
  globalThis.console.log = log;
}

export function writeConsoleLog(...args: readonly unknown[]): void {
  globalThis.console.log(...args);
}

export function createFakeContentRuntime(registrationOrder: string[] = []): {
  readonly browserRuntime: Parameters<typeof startContentScriptRuntime>[0]["browserRuntime"];
  readonly registrationOrder: readonly string[];
  readonly listenerCount: () => number;
  readonly emit: (message: unknown) => Promise<unknown>;
} {
  const listeners: ((message: unknown) => Promise<unknown>)[] = [];
  return {
    browserRuntime: {
      onMessage: {
        addListener(listener) {
          registrationOrder.push("addListener");
          listeners.push(listener);
        },
        removeListener(listener) {
          registrationOrder.push("removeListener");
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        },
      },
    },
    registrationOrder,
    listenerCount: () => listeners.length,
    emit: async (message) => {
      const [listener] = listeners;
      if (listener === undefined) {
        return undefined;
      }
      return listener(message);
    },
  };
}

export function readHighlightFields(element: HTMLElement): {
  readonly marker: string | null;
  readonly outline: string;
  readonly outlineOffset: string;
} {
  return {
    marker: element.getAttribute("data-firefox-cli-highlight"),
    outline: element.style.outline,
    outlineOffset: element.style.outlineOffset,
  };
}

export function createManualHighlightScheduler(): {
  readonly scheduler: HighlightScheduler;
  readonly activeTimers: () => readonly unknown[];
  readonly runOnlyTimer: () => void;
} {
  let nextTimer = 0;
  const timers = new Map<unknown, () => void>();
  return {
    scheduler: {
      setTimeout: (callback) => {
        nextTimer += 1;
        timers.set(nextTimer, callback);
        return nextTimer;
      },
      clearTimeout: (timer) => {
        timers.delete(timer);
      },
    },
    activeTimers: () => Array.from(timers.keys()),
    runOnlyTimer: () => {
      const activeTimers = Array.from(timers.entries());
      expect(activeTimers).toHaveLength(1);
      const [timer, callback] = activeTimers[0] ?? [];
      if (timer === undefined || callback === undefined) {
        throw new Error("expected one active highlight timer");
      }
      timers.delete(timer);
      callback();
    },
  };
}
