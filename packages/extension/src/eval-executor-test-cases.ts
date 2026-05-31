import { expect } from "vitest";
import { executeEvalInPage } from "./eval-executor.js";

export async function runCase01() {
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
}

export async function runCase02() {
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
}

export async function runCase03() {
  const counterKey = "__firefoxCliEvalSyntaxCounter";
  Object.defineProperty(globalThis, counterKey, { configurable: true, value: 0, writable: true });
  const boomMatcher: unknown = expect.stringContaining("boom");

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
      message: boomMatcher,
    },
  });
  expect(Reflect.get(globalThis, counterKey)).toBe(1);

  Reflect.deleteProperty(globalThis, counterKey);

  const expressionCounterKey = "__firefoxCliEvalExpressionSyntaxCounter";
  Object.defineProperty(globalThis, expressionCounterKey, { configurable: true, value: 0, writable: true });

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
      message: boomMatcher,
    },
  });
  expect(Reflect.get(globalThis, expressionCounterKey)).toBe(1);

  Reflect.deleteProperty(globalThis, expressionCounterKey);
}

export async function runCase04() {
  const boomMatcher: unknown = expect.stringContaining("boom");
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
      message: boomMatcher,
      details: {
        name: "TypeError",
      },
    },
  });
}

export async function runCase05() {
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
}

export async function runCase06() {
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
}
