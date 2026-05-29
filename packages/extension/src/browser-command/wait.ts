import type { RequestEnvelope, WaitResult } from "@firefox-cli/protocol";
import type { EvalExecutorResult } from "../eval-executor.js";
import { delay } from "./async.js";
import { DEFAULT_WAIT_INTERVAL_MS, DEFAULT_WAIT_TIMEOUT_MS } from "./constants.js";
import { BrowserCommandError } from "./errors.js";
import { findTabById, getOrderedWindows, toResolvedTarget } from "./targets.js";
import type { BackgroundBrowserAdapter } from "./types.js";

export async function waitForUrl(
  adapter: BackgroundBrowserAdapter,
  tabId: number,
  params: RequestEnvelope<"wait">["params"],
): Promise<WaitResult> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  while (true) {
    const match = findTabById(await getOrderedWindows(adapter), tabId);
    if (match === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Requested Firefox tab was not found.");
    }

    const url = match.tab.url ?? "";
    if (matchesGlob(url, params.urlGlob ?? "")) {
      return {
        kind: "url",
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        value: url,
        target: toResolvedTarget(match.window, match.tab),
      };
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new BrowserCommandError(
        "TIMEOUT",
        `Timed out after ${timeoutMs}ms waiting for URL ${JSON.stringify(params.urlGlob ?? "")}.`,
      );
    }

    await delay(Math.max(0, Math.min(intervalMs, timeoutMs - elapsedMs)));
  }
}

export async function waitForFunction(
  adapter: BackgroundBrowserAdapter,
  tabId: number,
  params: {
    readonly expression?: string | undefined;
    readonly timeoutMs?: number | undefined;
    readonly intervalMs?: number | undefined;
  },
): Promise<WaitResult> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const script = waitFunctionEvalScript(params.expression ?? "");

  while (true) {
    const elapsedBeforeAttempt = Date.now() - startedAt;
    const response = await adapter.executeEval(tabId, {
      script,
      timeoutMs: Math.max(1, timeoutMs - elapsedBeforeAttempt),
      maxResultBytes: 4096,
    });
    if (!response.ok) {
      throw new BrowserCommandError(
        "SCRIPT_INJECTION_FAILED",
        `Wait predicate failed: ${response.error.message}`,
      );
    }

    const evaluated = evalValueToWaitFunctionResult(response.value);
    if (evaluated.matched) {
      return {
        kind: "function",
        matched: true,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        value: evaluated.value,
      };
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new BrowserCommandError(
        "TIMEOUT",
        `Timed out after ${timeoutMs}ms waiting for function predicate.`,
      );
    }

    await delay(Math.max(0, Math.min(intervalMs, timeoutMs - elapsedMs)));
  }
}

function waitFunctionEvalScript(expression: string): string {
  return `(async () => {
    const value = (${expression});
    const resolved = await (typeof value === "function" ? value({ document, window }) : value);
    return {
      matched: Boolean(resolved),
      value: resolved === undefined ? null : resolved,
    };
  })()`;
}

function evalValueToWaitFunctionResult(
  value: Extract<EvalExecutorResult, { readonly ok: true }>["value"],
): { readonly matched: boolean; readonly value: FunctionWaitValue } {
  if (value.type !== "json" || typeof value.value !== "object" || value.value === null) {
    return { matched: false, value: null };
  }

  const payload = value.value as { readonly matched?: unknown; readonly value?: unknown };
  return {
    matched: payload.matched === true,
    value: toFunctionWaitValue(payload.value ?? null),
  };
}

type FunctionWaitValue = Extract<WaitResult, { readonly kind: "function" }>["value"];

function toFunctionWaitValue(value: unknown): FunctionWaitValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean" ||
        entry === null
          ? entry
          : String(entry),
      ]),
    );
  }

  return String(value);
}

function matchesGlob(value: string, glob: string): boolean {
  return new RegExp(
    `^${escapeRegExp(glob).replaceAll("\\*", ".*").replaceAll("\\?", ".")}$`,
    "u",
  ).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.*]/gu, "\\$&");
}
