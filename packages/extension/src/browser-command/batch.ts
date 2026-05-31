import {
  MAX_BATCH_RESULT_BYTES,
  MAX_SCREENSHOT_BYTES,
  commandAcceptsBatchTimeout,
  commandAcceptsExtensionBatchDefaultTarget,
  createRequest,
  isCommandId,
  parseBatchStepResultAs,
  parseCommandParamsAs,
  type BatchResult,
  type BatchStepResult,
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
  const defaultTarget = (await targetContext.resolveTarget(command.params.target)).target;
  const defaultSelector: TargetSelector = {
    window: { kind: "id", id: defaultTarget.windowId },
    tab: { kind: "id", id: defaultTarget.tabId },
  };
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
  defaultSelector: TargetSelector,
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

export function applyBatchStepDefaults(command: string, rawParams: unknown, defaultTarget: TargetSelector, remainingMs: number | undefined): unknown {
  if (!isRecord(rawParams)) {
    return rawParams;
  }

  return {
    ...rawParams,
    ...(commandAcceptsExtensionBatchDefaultTarget(command) && rawParams.target === undefined ? { target: defaultTarget } : {}),
    ...timeoutOverride(command, rawParams.timeoutMs, remainingMs),
  };
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
