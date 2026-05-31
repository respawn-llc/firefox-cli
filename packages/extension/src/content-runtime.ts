import { createErrorResponse, parseBoundaryRequest } from "@firefox-cli/protocol";
import { ElementRefRegistry, handleContentScriptRequest } from "./content-snapshot.js";
import { createContentLogCaptureService, type ContentLogCaptureService, type LogCaptureHandle } from "./content-snapshot/log-capture.js";

export type ContentRuntimeMessageHandler = (message: unknown) => Promise<unknown>;

export interface ContentBrowserRuntime {
  readonly onMessage: {
    addListener(listener: ContentRuntimeMessageHandler): void;
    removeListener(listener: ContentRuntimeMessageHandler): void;
  };
}

export interface ContentRuntimeLifecycle {
  dispose(): void;
}

interface ContentRuntimeOptions {
  readonly browserRuntime: ContentBrowserRuntime;
  readonly document: Document;
  readonly registry?: ElementRefRegistry<Element>;
  readonly logCapture?: ContentLogCaptureService;
  readonly now?: number;
  readonly clock?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
}

interface RuntimeState {
  readonly runtime: ContentBrowserRuntime;
  readonly registry: ElementRefRegistry<Element>;
  readonly handler: ContentRuntimeMessageHandler;
  readonly globalLogHandle: LogCaptureHandle;
  readonly windowLogHandle: LogCaptureHandle;
  refCount: number;
}

const CONTENT_RUNTIME_STATE_KEY = Symbol.for("firefox-cli.contentRuntime.state");
type ContentRuntimeGlobal = typeof globalThis & {
  [CONTENT_RUNTIME_STATE_KEY]?: RuntimeState;
};

export function startContentScriptRuntime(options: ContentRuntimeOptions): ContentRuntimeLifecycle {
  const global: ContentRuntimeGlobal = globalThis;
  const existing = global[CONTENT_RUNTIME_STATE_KEY];
  if (existing?.runtime === options.browserRuntime) {
    existing.refCount += 1;
    return createRuntimeHandle(() => {
      existing.refCount -= 1;
      if (existing.refCount === 0 && global[CONTENT_RUNTIME_STATE_KEY] === existing) {
        disposeRuntimeState(existing);
        Reflect.deleteProperty(global, CONTENT_RUNTIME_STATE_KEY);
      }
    });
  }
  if (existing !== undefined) {
    disposeRuntimeState(existing);
    Reflect.deleteProperty(global, CONTENT_RUNTIME_STATE_KEY);
  }

  const logCapture = options.logCapture ?? createContentLogCaptureService();
  const registry = options.registry ?? new ElementRefRegistry<Element>();
  const globalLogHandle = logCapture.installGlobal();
  const windowLogHandle = logCapture.installWindow(options.document.defaultView);
  const handler = createContentMessageHandler({
    document: options.document,
    registry,
    logCapture,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  const state: RuntimeState = {
    runtime: options.browserRuntime,
    registry,
    handler,
    globalLogHandle,
    windowLogHandle,
    refCount: 1,
  };
  options.browserRuntime.onMessage.addListener(handler);
  global[CONTENT_RUNTIME_STATE_KEY] = state;

  return createRuntimeHandle(() => {
    state.refCount -= 1;
    if (state.refCount === 0 && global[CONTENT_RUNTIME_STATE_KEY] === state) {
      disposeRuntimeState(state);
      Reflect.deleteProperty(global, CONTENT_RUNTIME_STATE_KEY);
    }
  });
}

export function createContentMessageHandler(options: {
  readonly document: Document;
  readonly registry: ElementRefRegistry<Element>;
  readonly logCapture: ContentLogCaptureService;
  readonly now?: number;
  readonly clock?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
}): ContentRuntimeMessageHandler {
  return async (message) => {
    const request = parseBoundaryRequest("extension-to-content-script", message);
    if (!request.ok) {
      return createErrorResponse("invalid-content-request", request.error);
    }

    const windowLogHandle = options.logCapture.installWindow(options.document.defaultView);
    try {
      return await handleContentScriptRequest(request.value, {
        document: options.document,
        registry: options.registry,
        logCapture: options.logCapture,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      });
    } finally {
      windowLogHandle.dispose();
    }
  };
}

function disposeRuntimeState(state: RuntimeState): void {
  state.runtime.onMessage.removeListener(state.handler);
  state.windowLogHandle.dispose();
  state.globalLogHandle.dispose();
}

function createRuntimeHandle(dispose: () => void): ContentRuntimeLifecycle {
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      dispose();
    },
  };
}
