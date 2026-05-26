import type { GetValue, WaitElementSummary, WaitParams, WaitResult } from "@firefox-cli/protocol";

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_INTERVAL_MS = 100;

type WaitErrorCode =
  | "SCRIPT_INJECTION_FAILED"
  | "SELECTOR_NOT_FOUND"
  | "UNSUPPORTED_CAPABILITY"
  | "TIMEOUT";
type WithoutTiming<T> = T extends unknown ? Omit<T, "matched" | "elapsedMs"> : never;
type PendingWaitResult = WithoutTiming<WaitResult>;

export async function createWaitResult(options: {
  readonly document: Document;
  readonly params: WaitParams;
  readonly now?: number;
  readonly clock?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly resolveRef: (
    ref: string,
    options: { readonly generationId?: string; readonly now: number },
  ) => { readonly element: Element; readonly generationId: string };
  readonly queryElement: (selector: string) => Element | null;
  readonly summarizeElement: (
    element: Element,
    options?: { readonly ref: string; readonly generationId: string },
  ) => WaitElementSummary;
  readonly isVisible: (element: Element) => boolean;
  readonly createError: (code: WaitErrorCode, message: string) => Error;
}): Promise<WaitResult> {
  const clock = options.clock ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  const startedAt = clock();
  const timeoutMs = options.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = options.params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;

  while (true) {
    const matched = await evaluateWaitCondition({ ...options, now: options.now ?? clock() });
    if (matched !== undefined) {
      return {
        ...matched,
        matched: true,
        elapsedMs: Math.max(0, Math.round(clock() - startedAt)),
      };
    }

    const elapsedMs = clock() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw options.createError(
        "TIMEOUT",
        `Timed out after ${timeoutMs}ms waiting for ${describeWait(options.params)}.`,
      );
    }

    await sleep(Math.max(0, Math.min(intervalMs, timeoutMs - elapsedMs)));
  }
}

async function evaluateWaitCondition(options: {
  readonly document: Document;
  readonly params: WaitParams;
  readonly now: number;
  readonly resolveRef: (
    ref: string,
    options: { readonly generationId?: string; readonly now: number },
  ) => { readonly element: Element; readonly generationId: string };
  readonly queryElement: (selector: string) => Element | null;
  readonly summarizeElement: (
    element: Element,
    options?: { readonly ref: string; readonly generationId: string },
  ) => WaitElementSummary;
  readonly isVisible: (element: Element) => boolean;
  readonly createError: (code: WaitErrorCode, message: string) => Error;
}): Promise<PendingWaitResult | undefined> {
  switch (options.params.kind) {
    case "element":
      return evaluateElementWait(options);
    case "text": {
      const visibleText = visibleDocumentText(options.document, options.isVisible);
      return visibleText.includes(options.params.text ?? "")
        ? { kind: options.params.kind, value: options.params.text ?? "" }
        : undefined;
    }
    case "load-state":
      return isLoadStateReached(options.document, options.params.state)
        ? { kind: options.params.kind }
        : undefined;
    case "function": {
      const value = await evaluateWaitExpression(
        options.document,
        options.params.expression ?? "",
        options.createError,
      );
      return value ? { kind: options.params.kind, value: toWaitValue(value) } : undefined;
    }
    case "ms":
    case "url":
      throw options.createError(
        "UNSUPPORTED_CAPABILITY",
        `${options.params.kind} waits are handled by the extension background.`,
      );
  }
}

function evaluateElementWait(options: {
  readonly params: WaitParams;
  readonly now: number;
  readonly resolveRef: (
    ref: string,
    options: { readonly generationId?: string; readonly now: number },
  ) => { readonly element: Element; readonly generationId: string };
  readonly queryElement: (selector: string) => Element | null;
  readonly summarizeElement: (
    element: Element,
    options?: { readonly ref: string; readonly generationId: string },
  ) => WaitElementSummary;
  readonly isVisible: (element: Element) => boolean;
  readonly createError: (code: WaitErrorCode, message: string) => Error;
}): PendingWaitResult | undefined {
  const state = options.params.state ?? "visible";
  if (options.params.ref !== undefined) {
    const resolved = options.resolveRef(options.params.ref, {
      ...(options.params.generationId === undefined
        ? {}
        : { generationId: options.params.generationId }),
      now: options.now,
    });
    const base = {
      kind: "element" as const,
      element: options.summarizeElement(resolved.element, {
        ref: options.params.ref,
        generationId: resolved.generationId,
      }),
    };
    if (state === "attached") {
      return base;
    }
    if (state === "visible" && options.isVisible(resolved.element)) {
      return base;
    }
    if (state === "hidden" && !options.isVisible(resolved.element)) {
      return base;
    }
    return undefined;
  }

  const selector = options.params.selector;
  if (selector === undefined) {
    throw options.createError("SELECTOR_NOT_FOUND", "Element selector is required.");
  }

  const element = options.queryElement(selector);
  if (state === "hidden") {
    return element === null || !options.isVisible(element)
      ? {
          kind: "element" as const,
          ...(element === null ? {} : { element: options.summarizeElement(element) }),
        }
      : undefined;
  }

  if (element === null) {
    return undefined;
  }

  if (state === "attached") {
    return { kind: "element", element: options.summarizeElement(element) };
  }

  return options.isVisible(element)
    ? { kind: "element", element: options.summarizeElement(element) }
    : undefined;
}

function isLoadStateReached(document: Document, state: WaitParams["state"] | undefined): boolean {
  if (state === "complete") {
    return document.readyState === "complete";
  }

  return document.readyState === "interactive" || document.readyState === "complete";
}

async function evaluateWaitExpression(
  document: Document,
  expression: string,
  createError: (code: WaitErrorCode, message: string) => Error,
): Promise<unknown> {
  try {
    const window = document.defaultView;
    // `wait --fn` intentionally evaluates user-provided predicates after pairing approval.
    // The protocol bounds expression size and the wait loop bounds total polling duration.
    const evaluator = new Function(
      "document",
      "window",
      `"use strict"; const value = (${expression}); return typeof value === "function" ? value({ document, window }) : value;`,
    );
    return await Promise.resolve(evaluator(document, window));
  } catch (error) {
    throw createError(
      "SCRIPT_INJECTION_FAILED",
      `Wait predicate failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function toWaitValue(value: unknown): GetValue {
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

function visibleDocumentText(document: Document, isVisible: (element: Element) => boolean): string {
  const root = document.body ?? document.documentElement;
  return root === null ? "" : collapseWhitespace(collectVisibleText(root, isVisible));
}

function collectVisibleText(node: Node, isVisible: (element: Element) => boolean): string {
  if (node.nodeType === node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  if (!isVisible(element)) {
    return "";
  }

  return Array.from(element.childNodes)
    .map((child) => collectVisibleText(child, isVisible))
    .join(" ");
}

function describeWait(params: WaitParams): string {
  switch (params.kind) {
    case "element":
      return `${params.state ?? "visible"} element ${params.ref ?? params.selector ?? ""}`.trim();
    case "text":
      return `text ${JSON.stringify(params.text ?? "")}`;
    case "function":
      return "function predicate";
    case "load-state":
      return `load state ${params.state ?? ""}`.trim();
    case "ms":
      return `${params.durationMs ?? 0}ms`;
    case "url":
      return `URL ${JSON.stringify(params.urlGlob ?? "")}`;
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
