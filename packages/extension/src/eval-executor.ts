import type { EvalSerializedValue, JsonValue, ProtocolError } from "@firefox-cli/protocol";

export type EvalExecutorPayload = {
  readonly script: string;
  readonly timeoutMs: number;
  readonly maxResultBytes: number;
};

export type EvalExecutorResult =
  | {
      readonly ok: true;
      readonly value: EvalSerializedValue;
      readonly elapsedMs: number;
    }
  | {
      readonly ok: false;
      readonly error: ProtocolError;
    };

export async function executeEvalInPage(payload: EvalExecutorPayload): Promise<EvalExecutorResult> {
  const startedAt = Date.now();

  try {
    const value = await withTimeout(
      Promise.resolve().then(() => evaluateUserScript(payload.script)),
      payload.timeoutMs,
    );
    const serialized = serializeEvalValue(value);
    const result = {
      value: serialized,
      elapsedMs: Math.max(0, Math.round(Date.now() - startedAt)),
    };
    const resultBytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (resultBytes > payload.maxResultBytes) {
      throw executorError(
        "RESULT_TOO_LARGE",
        `Eval result is ${resultBytes} bytes, exceeding the ${payload.maxResultBytes} byte limit.`,
        { resultBytes, maxResultBytes: payload.maxResultBytes },
      );
    }

    return { ok: true, ...result };
  } catch (error) {
    if (isExecutorError(error)) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "EVAL_ERROR",
        message: `Eval failed: ${error instanceof Error ? error.message : String(error)}`,
        details: errorDetails(error),
      },
    };
  }

  function evaluateUserScript(script: string): unknown {
    let expressionEvaluator: (() => unknown) | undefined;
    try {
      const compiledExpression = new Function(`"use strict"; return (${script}\n);`) as () => unknown;
      expressionEvaluator = () => compiledExpression.call(globalThis);
    } catch (error) {
      if (!isSyntaxError(error)) {
        throw error;
      }
    }

    if (expressionEvaluator !== undefined) {
      return expressionEvaluator();
    }

    const statementEvaluator = new Function(`"use strict"; return (async () => {${script}\n})();`);
    return statementEvaluator.call(globalThis);
  }

  async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(executorError("TIMEOUT", `Timed out after ${timeoutMs}ms running eval.`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  function serializeEvalValue(value: unknown): EvalSerializedValue {
    if (value === undefined) {
      return { type: "undefined" };
    }

    return { type: "json", value: normalizeJsonValue(value, []) };
  }

  function normalizeJsonValue(value: unknown, seen: readonly object[]): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw executorError("SERIALIZATION_FAILED", "Eval result contains a non-finite number.");
      }
      return value;
    }

    if (typeof value === "undefined") {
      throw executorError("SERIALIZATION_FAILED", "Eval result contains undefined.");
    }

    if (typeof value === "bigint") {
      throw executorError("SERIALIZATION_FAILED", "Eval result contains a BigInt.");
    }

    if (typeof value === "function" || typeof value === "symbol") {
      throw executorError("SERIALIZATION_FAILED", `Eval result contains a non-serializable ${typeof value}.`);
    }

    if (typeof value !== "object") {
      throw executorError("SERIALIZATION_FAILED", "Eval result is not JSON-serializable.");
    }

    if (seen.includes(value)) {
      throw executorError("SERIALIZATION_FAILED", "Eval result contains a circular reference.");
    }

    const nextSeen = [...seen, value];
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeJsonValue(entry, nextSeen));
    }

    const toJson = (value as { readonly toJSON?: unknown }).toJSON;
    if (typeof toJson === "function") {
      return normalizeJsonValue(toJson.call(value), nextSeen);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw executorError(
        "SERIALIZATION_FAILED",
        `Eval result contains a non-plain object: ${value.constructor?.name ?? "unknown"}.`,
      );
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeJsonValue(entry, nextSeen)]),
    );
  }

  function executorError(
    code: ProtocolError["code"],
    message: string,
    details?: Record<string, unknown>,
  ): Error & { readonly code: ProtocolError["code"]; readonly details?: Record<string, unknown> } {
    const error = new Error(message) as Error & {
      code: ProtocolError["code"];
      details?: Record<string, unknown>;
    };
    error.name = "EvalExecutorError";
    error.code = code;
    if (details !== undefined) {
      error.details = details;
    }
    return error;
  }

  function isExecutorError(error: unknown): error is Error & {
    readonly code: ProtocolError["code"];
    readonly details?: Record<string, unknown>;
  } {
    return (
      error instanceof Error &&
      error.name === "EvalExecutorError" &&
      typeof (error as { readonly code?: unknown }).code === "string"
    );
  }

  function isSyntaxError(error: unknown): boolean {
    return error instanceof SyntaxError || (error as { readonly name?: unknown })?.name === "SyntaxError";
  }

  function errorDetails(error: unknown): Record<string, unknown> {
    if (!(error instanceof Error)) {
      return { error: String(error) };
    }

    return {
      name: error.name,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
}
