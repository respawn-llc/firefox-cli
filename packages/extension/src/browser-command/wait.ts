import type { RequestEnvelope, WaitResult } from "@firefox-cli/protocol";
import type { EvalExecutorResult } from "../eval-executor.js";
import { createGlobMatcher } from "../glob.js";
import { DEFAULT_WAIT_INTERVAL_MS, DEFAULT_WAIT_TIMEOUT_MS } from "./constants.js";
import { createBrowserCommandDeadline } from "./deadline.js";
import { BrowserCommandError } from "./errors.js";
import { findTabById, getOrderedWindows, toResolvedTarget } from "./targets.js";
import type { BackgroundBrowserAdapter } from "./types.js";

export async function waitForUrl(adapter: BackgroundBrowserAdapter, tabId: number, params: RequestEnvelope<"wait">["params"]): Promise<WaitResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const deadline = createBrowserCommandDeadline(timeoutMs);
  const matchesUrlGlob = createGlobMatcher(params.urlGlob ?? "", { questionMark: "wildcard" });
  const timeoutMessage = () => `Timed out after ${String(timeoutMs)}ms waiting for URL ${JSON.stringify(params.urlGlob ?? "")}.`;
  for (;;) {
    const match = findTabById(await deadline.run(getOrderedWindows(adapter), timeoutMessage), tabId);
    if (match === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Requested Firefox tab was not found.");
    }

    const url = match.tab.url ?? "";
    if (matchesUrlGlob(url)) {
      return {
        kind: "url",
        matched: true,
        elapsedMs: deadline.elapsedMs(),
        value: url,
        target: toResolvedTarget(match.window, match.tab),
      };
    }

    deadline.throwIfExpired(timeoutMessage);
    await deadline.sleep(intervalMs, timeoutMessage);
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
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const deadline = createBrowserCommandDeadline(timeoutMs);
  const script = waitFunctionEvalScript(params.expression ?? "");
  const timeoutMessage = () => `Timed out after ${String(timeoutMs)}ms waiting for function predicate.`;

  for (;;) {
    const response = await deadline.run(
      adapter.executeEval(tabId, {
        script,
        timeoutMs: Math.max(1, deadline.remainingMs()),
        maxResultBytes: 4096,
      }),
      timeoutMessage,
    );
    if (!response.ok) {
      throw new BrowserCommandError("SCRIPT_INJECTION_FAILED", `Wait predicate failed: ${response.error.message}`);
    }

    const evaluated = evalValueToWaitFunctionResult(response.value);
    if (evaluated.matched) {
      return {
        kind: "function",
        matched: true,
        elapsedMs: deadline.elapsedMs(),
        value: evaluated.value,
      };
    }

    deadline.throwIfExpired(timeoutMessage);
    await deadline.sleep(intervalMs, timeoutMessage);
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

function evalValueToWaitFunctionResult(value: Extract<EvalExecutorResult, { readonly ok: true }>["value"]): {
  readonly matched: boolean;
  readonly value: FunctionWaitValue;
} {
  if (value.type !== "json" || typeof value.value !== "object" || value.value === null) {
    return { matched: false, value: null };
  }

  const payload = toWaitFunctionPayload(value.value);
  return {
    matched: payload.matched === true,
    value: toFunctionWaitValue(payload.value ?? null),
  };
}

type FunctionWaitValue = Extract<WaitResult, { readonly kind: "function" }>["value"];

function toFunctionWaitValue(value: unknown): FunctionWaitValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null ? entry : formatFunctionWaitValue(entry),
      ]),
    );
  }

  return formatFunctionWaitValue(value);
}

function toWaitFunctionPayload(value: object): { readonly matched?: unknown; readonly value?: unknown } {
  return {
    ...("matched" in value ? { matched: value.matched } : {}),
    ...("value" in value ? { value: value.value } : {}),
  };
}

function formatFunctionWaitValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.description ?? "";
  }
  if (typeof value === "function") {
    return value.name === "" ? "[function]" : `[function ${value.name}]`;
  }
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}
