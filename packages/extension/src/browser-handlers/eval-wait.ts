import {
  MAX_EVAL_RESULT_BYTES,
  createErrorResponse,
  createOkResponse,
  type EvalResult,
  type RequestEnvelope,
  type WaitResult,
} from "@firefox-cli/protocol";
import { delay } from "../browser-command/async.js";
import {
  DEFAULT_EVAL_TIMEOUT_MS,
  DEFAULT_WAIT_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
} from "../browser-command/constants.js";
import { sendContentCommand } from "../browser-command/content-bridge.js";
import { BrowserCommandError } from "../browser-command/errors.js";
import { getOrderedWindows, resolveTarget } from "../browser-command/targets.js";
import { waitForFunction, waitForUrl } from "../browser-command/wait.js";
import type { EvalExecutorResult } from "../eval-executor.js";
import type { BrowserHandlerMap } from "./types.js";

export const evalWaitHandlers: BrowserHandlerMap = {
  wait: async (request, adapter) => {
    const command = request as RequestEnvelope<"wait">;
    if (command.params.kind === "ms") {
      const startedAt = Date.now();
      const durationMs = command.params.durationMs ?? 0;
      const timeoutMs = command.params.timeoutMs;
      await delay(Math.min(durationMs, timeoutMs ?? durationMs));
      if (timeoutMs !== undefined && durationMs > timeoutMs) {
        throw new BrowserCommandError(
          "TIMEOUT",
          `Timed out after ${timeoutMs}ms waiting ${durationMs}ms.`,
        );
      }
      return createOkResponse(command, {
        kind: command.params.kind,
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
    }

    if (command.params.kind === "download") {
      const startedAt = Date.now();
      const timeoutMs = command.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      const download = await adapter.waitForDownload({
        ...(command.params.downloadId === undefined
          ? {}
          : { downloadId: command.params.downloadId }),
        ...(command.params.filenameGlob === undefined
          ? {}
          : { filenameGlob: command.params.filenameGlob }),
        timeoutMs,
        intervalMs: command.params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
      });
      return createOkResponse(command, {
        kind: "download",
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        download,
      });
    }

    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    if (command.params.kind === "url") {
      const result = await waitForUrl(adapter, resolved.tab.id, command.params);
      return createOkResponse(command, result);
    }

    if (command.params.kind === "load-state" && command.params.state === "networkidle") {
      const startedAt = Date.now();
      const timeoutMs = command.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      await adapter.waitForNetworkIdle({
        tabId: resolved.tab.id,
        timeoutMs,
        idleMs: command.params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
      });
      return createOkResponse(command, {
        kind: "load-state",
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        target: resolved.target,
      });
    }

    if (command.params.kind === "function") {
      const result = await waitForFunction(adapter, resolved.tab.id, command.params);
      return createOkResponse(command, { ...result, target: resolved.target });
    }

    const waitResponse = await sendContentCommand(adapter, resolved.tab.id, command);
    if (!waitResponse.ok) {
      return createErrorResponse(command.id, waitResponse.error, command.protocolVersion);
    }

    const result: WaitResult = {
      ...waitResponse.result,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  },
  eval: async (request, adapter) => {
    const command = request as RequestEnvelope<"eval">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    let evalResponse: EvalExecutorResult;
    try {
      evalResponse = await adapter.executeEval(resolved.tab.id, {
        script: command.params.script,
        timeoutMs: command.params.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS,
        maxResultBytes: command.params.maxResultBytes ?? MAX_EVAL_RESULT_BYTES,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowserCommandError(
        "SCRIPT_INJECTION_FAILED",
        `Cannot run eval in this tab. Open a normal web page, reload the extension, or choose a different tab. Firefox reported: ${message}`,
      );
    }

    if (!evalResponse.ok) {
      return createErrorResponse(command.id, evalResponse.error);
    }

    const result: EvalResult = {
      value: evalResponse.value,
      elapsedMs: evalResponse.elapsedMs,
      target: resolved.target,
    };
    return createOkResponse(command, result);
  },
};
