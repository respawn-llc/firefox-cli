import { describe, expect, it } from "vitest";
import { executeEvalInPage } from "./eval-executor.js";

describe("eval executor", () => {
  it("evaluates expressions and serializes JSON-compatible values", async () => {
    await expect(
      executeEvalInPage({
        script: "({ answer: 42, items: [1, 'two', null] })",
        timeoutMs: 1000,
        maxResultBytes: 10_000,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        type: "json",
        value: {
          answer: 42,
          items: [1, "two", null],
        },
      },
    });
  });

  it("supports statements with explicit returns and undefined markers", async () => {
    await expect(
      executeEvalInPage({
        script: "const value = 41; return value + 1;",
        timeoutMs: 1000,
        maxResultBytes: 10_000,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        type: "json",
        value: 42,
      },
    });

    await expect(
      executeEvalInPage({
        script: "const value = 41;",
        timeoutMs: 1000,
        maxResultBytes: 10_000,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        type: "undefined",
      },
    });
  });

  it("does not retry user code when runtime SyntaxError is thrown", async () => {
    const counterKey = "__firefoxCliEvalSyntaxCounter";
    const evalGlobal = globalThis as Record<string, unknown>;
    evalGlobal[counterKey] = 0;

    await expect(
      executeEvalInPage({
        script: `${counterKey} += 1; throw new SyntaxError('boom');`,
        timeoutMs: 1000,
        maxResultBytes: 10_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "EVAL_ERROR",
        message: expect.stringContaining("boom"),
      },
    });
    expect(evalGlobal[counterKey]).toBe(1);

    delete evalGlobal[counterKey];

    const expressionCounterKey = "__firefoxCliEvalExpressionSyntaxCounter";
    evalGlobal[expressionCounterKey] = 0;

    await expect(
      executeEvalInPage({
        script: `(() => { ${expressionCounterKey} += 1; throw new SyntaxError('boom'); })()`,
        timeoutMs: 1000,
        maxResultBytes: 10_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "EVAL_ERROR",
        message: expect.stringContaining("boom"),
      },
    });
    expect(evalGlobal[expressionCounterKey]).toBe(1);

    delete evalGlobal[expressionCounterKey];
  });

  it("captures thrown errors with diagnostic details", async () => {
    await expect(
      executeEvalInPage({
        script: "throw new TypeError('boom')",
        timeoutMs: 1000,
        maxResultBytes: 10_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "EVAL_ERROR",
        message: expect.stringContaining("boom"),
        details: {
          name: "TypeError",
        },
      },
    });
  });

  it("times out async work", async () => {
    await expect(
      executeEvalInPage({
        script: "return new Promise((resolve) => setTimeout(() => resolve(true), 50));",
        timeoutMs: 1,
        maxResultBytes: 10_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "TIMEOUT",
      },
    });
  });

  it("rejects non-serializable and oversized results", async () => {
    await expect(
      executeEvalInPage({
        script: "(() => {})",
        timeoutMs: 1000,
        maxResultBytes: 10_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "SERIALIZATION_FAILED",
      },
    });

    await expect(
      executeEvalInPage({
        script: "'x'.repeat(100)",
        timeoutMs: 1000,
        maxResultBytes: 20,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RESULT_TOO_LARGE",
      },
    });
  });
});
