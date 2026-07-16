import {
  type BatchResult,
  type BatchStepResult,
  type CommandId,
  commandAcceptsBatchTimeout,
  commandAcceptsExtensionBatchDefaultTarget,
  createRequest,
  getCommandTargetSelectorDimensions,
  isCommandId,
  MAX_BATCH_RESULT_BYTES,
  MAX_SCREENSHOT_BYTES,
  parseBatchStepResultAs,
  parseCommandParamsAs,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ScreenshotResult,
  type TargetSelector,
} from "@firefox-cli/protocol";
import { BrowserCommandError } from "./errors.js";
import type { BrowserTargetContext } from "./target-context.js";
import type { BackgroundBrowserAdapter } from "./types.js";

export type ExecuteBatchStep = (request: RequestEnvelope, adapter: BackgroundBrowserAdapter) => Promise<ResponseEnvelope>;

export async function executeBatch(
  command: RequestEnvelope<"batch">,
  adapter: BackgroundBrowserAdapter,
  executeStep: ExecuteBatchStep,
  targetContext: BrowserTargetContext,
): Promise<BatchResult> {
  const startedAt = Date.now();
  const timeoutMs = command.params.timeoutMs;
  const maxResultBytes = command.params.maxResultBytes ?? MAX_BATCH_RESULT_BYTES;
  const defaultSelector = await resolveBatchDefaultSelector(command, targetContext);
  const steps: BatchStepResult[] = [];
  let totalScreenshotBytes = 0;

  for (let index = 0; index < command.params.steps.length; index += 1) {
    const remainingMs = remainingBatchTime(startedAt, timeoutMs);
    assertBatchHasTimeRemaining(timeoutMs, remainingMs);
    const stepRequest = createBatchStepRequest(command, index, defaultSelector, remainingMs);
    if (stepRequest === undefined) {
      continue;
    }
    const response = await executeStep(stepRequest, adapter);
    const stepResult = toBatchStepResult(index, stepRequest.command, response);
    steps.push(stepResult);

    totalScreenshotBytes = checkedScreenshotByteTotal(totalScreenshotBytes, stepResult);

    assertBatchResultSize(
      {
        ok: steps.every((candidate) => candidate.ok),
        steps,
        ...(firstFailedIndex(steps) === undefined ? {} : { firstFailedIndex: firstFailedIndex(steps) }),
        elapsedMs: Math.max(0, Date.now() - startedAt),
      },
      maxResultBytes,
    );

    if (!stepResult.ok && command.params.bail === true) {
      break;
    }
  }

  const failedIndex = firstFailedIndex(steps);
  const result: BatchResult = {
    ok: failedIndex === undefined,
    steps,
    ...(failedIndex === undefined ? {} : { firstFailedIndex: failedIndex }),
    elapsedMs: Math.max(0, Date.now() - startedAt),
  };
  assertBatchResultSize(result, maxResultBytes);
  return result;
}

function assertBatchHasTimeRemaining(timeoutMs: number | undefined, remainingMs: number | undefined): void {
  if (remainingMs !== undefined && remainingMs <= 0) {
    throw new BrowserCommandError("TIMEOUT", `Timed out after ${String(timeoutMs)}ms.`);
  }
}

function createBatchStepRequest(
  command: RequestEnvelope<"batch">,
  index: number,
  defaultSelector: TargetSelector | undefined,
  remainingMs: number | undefined,
): RequestEnvelope | undefined {
  const step = command.params.steps[index];
  if (step === undefined) {
    return undefined;
  }
  if (!isCommandId(step.command)) {
    throw new BrowserCommandError("INVALID_TARGET", `Unknown batch command: ${step.command}`);
  }
  const params = parseCommandParamsAs(step.command, applyBatchStepDefaults(step.command, step.params, defaultSelector, remainingMs));
  if (!params.ok) {
    throw new BrowserCommandError("INVALID_TARGET", params.error.message);
  }
  return createRequest(step.command, params.value, `${command.id}:${String(index)}`, command.protocolVersion);
}

function toBatchStepResult(index: number, command: string, response: ResponseEnvelope): BatchStepResult {
  return response.ok
    ? {
        index,
        command,
        ok: true,
        result: response.result,
      }
    : {
        index,
        command,
        ok: false,
        error: response.error,
      };
}

function checkedScreenshotByteTotal(currentBytes: number, stepResult: BatchStepResult): number {
  if (!stepResult.ok || stepResult.command !== "screenshot") {
    return currentBytes;
  }
  const nextBytes = currentBytes + parseScreenshotStepResult(stepResult).bytes;
  if (nextBytes > MAX_SCREENSHOT_BYTES) {
    throw new BrowserCommandError("OUTPUT_TOO_LARGE", `Batch screenshots exceed the ${String(MAX_SCREENSHOT_BYTES)} byte native messaging limit.`);
  }
  return nextBytes;
}

export function applyBatchStepDefaults(
  command: string,
  rawParams: unknown,
  defaultTarget: TargetSelector | undefined,
  remainingMs: number | undefined,
): unknown {
  if (!isRecord(rawParams)) {
    return rawParams;
  }

  return {
    ...rawParams,
    ...defaultTargetOverride(command, rawParams, defaultTarget),
    ...timeoutOverride(command, rawParams.timeoutMs, remainingMs),
  };
}

async function resolveBatchDefaultSelector(command: RequestEnvelope<"batch">, targetContext: BrowserTargetContext): Promise<TargetSelector | undefined> {
  const resolution = command.params.steps.reduce<TargetResolution>(
    (highest, step) => (isCommandId(step.command) ? highestTargetResolution(highest, requestDefaultTargetResolution(step.command, step.params)) : highest),
    "none",
  );
  if (resolution === "none") {
    return undefined;
  }
  if (resolution === "window") {
    const window = await targetContext.resolveTargetWindow(command.params.target);
    return { window: { kind: "id", id: window.id } };
  }

  const target = (await targetContext.resolveTarget(command.params.target)).target;
  return {
    window: { kind: "id", id: target.windowId },
    tab: { kind: "id", id: target.tabId },
  };
}

type TargetResolution = "none" | "window" | "tab";

function requestDefaultTargetResolution(command: CommandId, params: unknown): TargetResolution {
  if (!commandAcceptsExtensionBatchDefaultTarget(command) || !isRecord(params) || params.target !== undefined) {
    return "none";
  }
  return requestTargetResolution(command, params);
}

function requestTargetResolution(command: CommandId, params: unknown): TargetResolution {
  const selectorDimensions = getCommandTargetSelectorDimensions(command);
  if (selectorDimensions === "neither") {
    return "none";
  }
  if (selectorDimensions === "window") {
    return "window";
  }
  if (isWindowOnlyRequest(command, params)) {
    return "window";
  }
  if (isTargetlessRequest(command, params)) {
    return "none";
  }
  return "tab";
}

function isWindowOnlyRequest(command: CommandId, params: unknown): boolean {
  return command === "open" && isRecord(params) && params.newTab === true;
}

function isTargetlessRequest(command: CommandId, params: unknown): boolean {
  if (!isRecord(params)) {
    return false;
  }
  const targetlessWait = command === "wait" && (params.kind === "ms" || params.kind === "download");
  const targetlessClipboard = command === "clipboard" && (params.action === "read" || params.action === "write");
  return targetlessWait || targetlessClipboard;
}

function highestTargetResolution(left: TargetResolution, right: TargetResolution): TargetResolution {
  if (left === "tab" || right === "tab") {
    return "tab";
  }
  return left === "window" || right === "window" ? "window" : "none";
}

function defaultTargetOverride(
  command: string,
  params: Record<string, unknown>,
  defaultTarget: TargetSelector | undefined,
): { readonly target?: TargetSelector } {
  if (defaultTarget === undefined || !isCommandId(command)) {
    return {};
  }

  const resolution = requestDefaultTargetResolution(command, params);
  if (resolution === "none") {
    return {};
  }
  if (resolution === "window") {
    return defaultTarget.window === undefined ? {} : { target: { window: defaultTarget.window } };
  }
  return { target: defaultTarget };
}

function timeoutOverride(command: string, existingTimeout: unknown, remainingMs: number | undefined): { readonly timeoutMs?: number } {
  if (remainingMs === undefined || !commandAcceptsBatchTimeout(command)) {
    return {};
  }

  const boundedTimeout = typeof existingTimeout === "number" ? Math.min(existingTimeout, remainingMs) : remainingMs;
  return { timeoutMs: Math.max(1, Math.floor(boundedTimeout)) };
}

function remainingBatchTime(startedAt: number, timeoutMs: number | undefined): number | undefined {
  return timeoutMs === undefined ? undefined : timeoutMs - (Date.now() - startedAt);
}

function assertBatchResultSize(result: BatchResult, maxResultBytes: number): void {
  const publicResult = publicBatchResult(result);
  const bytes = new TextEncoder().encode(JSON.stringify(publicResult)).byteLength;
  if (bytes > maxResultBytes) {
    throw new BrowserCommandError("RESULT_TOO_LARGE", `Batch result is ${String(bytes)} bytes, exceeding the ${String(maxResultBytes)} byte limit.`);
  }
}

function publicBatchResult(result: BatchResult): BatchResult {
  return {
    ...result,
    steps: result.steps.map((step) =>
      step.ok && step.command === "screenshot"
        ? {
            ...step,
            result: stripScreenshotImageBytes(parseScreenshotStepResult(step)),
          }
        : step,
    ),
  };
}

function parseScreenshotStepResult(step: BatchStepResult): ScreenshotResult {
  const parsed = parseBatchStepResultAs("screenshot", step);
  if (!parsed.ok || !parsed.value.ok) {
    throw new BrowserCommandError("INVALID_TARGET", "Batch screenshot result is invalid.");
  }
  return parsed.value.result;
}

function stripScreenshotImageBytes(result: ScreenshotResult): Omit<ScreenshotResult, "imageBase64"> {
  return {
    ...(result.target === undefined ? {} : { target: result.target }),
    path: result.path,
    format: result.format,
    bytes: result.bytes,
    ...(result.width === undefined ? {} : { width: result.width }),
    ...(result.height === undefined ? {} : { height: result.height }),
    activation: result.activation,
  };
}

function firstFailedIndex(steps: readonly BatchStepResult[]): number | undefined {
  return steps.find((step) => !step.ok)?.index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
