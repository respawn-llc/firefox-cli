import type { EvalSerializedValue, JsonValue, ProtocolError } from "@firefox-cli/protocol";

export interface EvalExecutorPayload {
  readonly script: string;
  readonly timeoutMs: number;
  readonly maxResultBytes: number;
}

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
      throw executorError("RESULT_TOO_LARGE", `Eval result is ${String(resultBytes)} bytes, exceeding the ${String(payload.maxResultBytes)} byte limit.`, {
        resultBytes,
        maxResultBytes: payload.maxResultBytes,
      });
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
    const { Function: createFunction } = globalThis;
    let expressionEvaluator: (() => unknown) | undefined;
    try {
      const compiledExpression = createFunction(`"use strict"; return (${script}\n);`);
      expressionEvaluator = () => compiledExpression.call(globalThis);
    } catch (error) {
      if (!isSyntaxError(error)) {
        throw error;
      }
    }

    if (expressionEvaluator !== undefined) {
      return expressionEvaluator();
    }

    const statementEvaluator = createFunction(`"use strict"; return (async () => {${script}\n})();`);
    return statementEvaluator.call(globalThis);
  }

  async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(executorError("TIMEOUT", `Timed out after ${String(timeoutMs)}ms running eval.`));
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
    const scalar = normalizeJsonScalar(value);
    if (scalar.ok) {
      return scalar.value;
    }

    if (isNonJsonType(value)) {
      throw executorError("SERIALIZATION_FAILED", `Eval result contains a non-serializable ${typeof value}.`);
    }

    if (value === null || typeof value !== "object") {
      throw executorError("SERIALIZATION_FAILED", "Eval result is not JSON-serializable.");
    }

    if (seen.includes(value)) {
      throw executorError("SERIALIZATION_FAILED", "Eval result contains a circular reference.");
    }

    return normalizeJsonObject(value, seen);
  }

  function normalizeJsonScalar(value: unknown): { readonly ok: true; readonly value: JsonValue } | { readonly ok: false } {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return { ok: true, value };
    }

    if (typeof value !== "number") {
      return { ok: false };
    }

    if (!Number.isFinite(value)) {
      throw executorError("SERIALIZATION_FAILED", "Eval result contains a non-finite number.");
    }

    return { ok: true, value };
  }

  function isNonJsonType(value: unknown): boolean {
    return typeof value === "undefined" || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol";
  }

  function normalizeJsonObject(value: object, seen: readonly object[]): JsonValue {
    const nextSeen = [...seen, value];
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeJsonValue(entry, nextSeen));
    }

    if (hasToJson(value)) {
      return normalizeJsonValue(value.toJSON(), nextSeen);
    }

    if (!isPlainJsonObject(value)) {
      throw executorError("SERIALIZATION_FAILED", `Eval result contains a non-plain object: ${value.constructor.name}.`);
    }

    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeJsonValue(entry, nextSeen)]));
  }

  function hasToJson(value: object): value is { readonly toJSON: () => unknown } {
    return "toJSON" in value && typeof value.toJSON === "function";
  }

  function isPlainJsonObject(value: object): boolean {
    return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
  }

  function executorError(
    code: ProtocolError["code"],
    message: string,
    details?: Record<string, unknown>,
  ): Error & { readonly code: ProtocolError["code"]; readonly details?: Record<string, unknown> } {
    return Object.assign(new Error(message), {
      name: "EvalExecutorError",
      code,
      ...(details === undefined ? {} : { details }),
    });
  }

  function isExecutorError(error: unknown): error is Error & {
    readonly code: ProtocolError["code"];
    readonly details?: Record<string, unknown>;
  } {
    return error instanceof Error && error.name === "EvalExecutorError" && "code" in error && typeof error.code === "string";
  }

  function isSyntaxError(error: unknown): boolean {
    return error instanceof SyntaxError || (typeof error === "object" && error !== null && "name" in error && error.name === "SyntaxError");
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
