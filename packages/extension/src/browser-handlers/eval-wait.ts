import {
  MAX_EVAL_RESULT_BYTES,
  createErrorResponseForRequest,
  createOkResponse,
  type EvalResult,
  type RequestEnvelope,
  type ResponseEnvelope,
  type WaitResult,
} from "@firefox-cli/protocol";
import { delay } from "../browser-command/async.js";
import { DEFAULT_EVAL_TIMEOUT_MS, DEFAULT_WAIT_INTERVAL_MS, DEFAULT_WAIT_TIMEOUT_MS } from "../browser-command/constants.js";
import { sendContentCommand } from "../browser-command/content-bridge.js";
import { BrowserCommandError } from "../browser-command/errors.js";
import { waitForFunction, waitForUrl } from "../browser-command/wait.js";
import type { EvalExecutorResult } from "../eval-executor.js";
import type { BackgroundBrowserAdapter } from "../browser-command/types.js";
import type { BrowserHandlerContext, BrowserHandlerMap } from "./types.js";

export const evalWaitHandlers: BrowserHandlerMap<"wait" | "eval"> = {
  wait: async (request, adapter, context) => handleWaitRequest(request, adapter, context),
  eval: async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    let evalResponse: EvalExecutorResult;
    try {
      evalResponse = await adapter.executeEval(resolved.tab.id, {
        script: request.params.script,
        timeoutMs: request.params.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS,
        maxResultBytes: request.params.maxResultBytes ?? MAX_EVAL_RESULT_BYTES,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowserCommandError(
        "SCRIPT_INJECTION_FAILED",
        `Cannot run eval in this tab. Open a normal web page, reload the extension, or choose a different tab. Firefox reported: ${message}`,
      );
    }

    if (!evalResponse.ok) {
      return createErrorResponseForRequest(request, evalResponse.error);
    }

    const result: EvalResult = {
      value: evalResponse.value,
      elapsedMs: evalResponse.elapsedMs,
      target: resolved.target,
    };
    return createOkResponse(request, result);
  },
};

async function handleWaitRequest(
  request: RequestEnvelope<"wait">,
  adapter: BackgroundBrowserAdapter,
  context: BrowserHandlerContext,
): Promise<ResponseEnvelope<"wait">> {
  if (request.params.kind === "ms") {
    return waitForDuration(request);
  }

  if (request.params.kind === "download") {
    return waitForDownload(request, adapter);
  }

  const waitTimeoutMs = request.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const resolved = await context.targetContext.resolveTarget(request.params.target, {
    deadlineMs: waitTimeoutMs,
    timeoutMessage: () => `Timed out after ${String(waitTimeoutMs)}ms resolving wait target.`,
  });

  if (request.params.kind === "url") {
    const result = await waitForUrl(adapter, resolved.tab.id, request.params);
    return createOkResponse(request, result);
  }

  if (request.params.kind === "load-state" && request.params.state === "networkidle") {
    const result = await waitForNetworkIdle(request, adapter, resolved.tab.id);
    return createOkResponse(request, { ...result, target: resolved.target });
  }

  if (request.params.kind === "function") {
    const result = await waitForFunction(adapter, resolved.tab.id, request.params);
    return createOkResponse(request, { ...result, target: resolved.target });
  }

  const waitResponse = await sendContentCommand(adapter, resolved.tab.id, request);
  if (!waitResponse.ok) {
    return createErrorResponseForRequest(request, waitResponse.error);
  }

  const result: WaitResult = {
    ...waitResponse.result,
    target: resolved.target,
  };
  return createOkResponse(request, result);
}

async function waitForDuration(request: RequestEnvelope<"wait">): Promise<ResponseEnvelope<"wait">> {
  const startedAt = Date.now();
  const durationMs = request.params.durationMs ?? 0;
  const timeoutMs = request.params.timeoutMs;
  await delay(Math.min(durationMs, timeoutMs ?? durationMs));
  if (timeoutMs !== undefined && durationMs > timeoutMs) {
    throw new BrowserCommandError("TIMEOUT", `Timed out after ${String(timeoutMs)}ms waiting ${String(durationMs)}ms.`);
  }
  return createOkResponse(request, {
    kind: "ms",
    matched: true,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  });
}

async function waitForDownload(request: RequestEnvelope<"wait">, adapter: BackgroundBrowserAdapter): Promise<ResponseEnvelope<"wait">> {
  const startedAt = Date.now();
  const timeoutMs = request.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const download = await adapter.waitForDownload({
    ...(request.params.downloadId === undefined ? {} : { downloadId: request.params.downloadId }),
    ...(request.params.filenameGlob === undefined ? {} : { filenameGlob: request.params.filenameGlob }),
    timeoutMs,
    intervalMs: request.params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
  });
  return createOkResponse(request, {
    kind: "download",
    matched: true,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    download,
  });
}

async function waitForNetworkIdle(
  request: RequestEnvelope<"wait">,
  adapter: BackgroundBrowserAdapter,
  tabId: number,
): Promise<Omit<Extract<WaitResult, { readonly kind: "load-state" }>, "target">> {
  const startedAt = Date.now();
  const timeoutMs = request.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  await adapter.waitForNetworkIdle({
    tabId,
    timeoutMs,
    idleMs: request.params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
  });
  return {
    kind: "load-state",
    matched: true,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  };
}
