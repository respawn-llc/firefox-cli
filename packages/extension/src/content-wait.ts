import type { GetValue, WaitElementSummary, WaitParams, WaitResult } from "@firefox-cli/protocol";
import type { ContentElementResolver } from "./content-snapshot/element-resolver.js";

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_INTERVAL_MS = 100;

type WaitErrorCode = "SCRIPT_INJECTION_FAILED" | "SELECTOR_NOT_FOUND" | "UNSUPPORTED_CAPABILITY" | "TIMEOUT";
type WithoutTiming<T> = T extends unknown ? Omit<T, "matched" | "elapsedMs"> : never;
type PendingWaitResult = WithoutTiming<WaitResult>;

export async function createWaitResult(options: {
  readonly document: Document;
  readonly params: WaitParams;
  readonly now?: number;
  readonly clock?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly elementResolver: ContentElementResolver;
  readonly summarizeElement: (element: Element, options?: { readonly ref: string; readonly generationId: string }) => WaitElementSummary;
  readonly isVisible: (element: Element) => boolean;
  readonly createError: (code: WaitErrorCode, message: string) => Error;
}): Promise<WaitResult> {
  const clock = options.clock ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  const startedAt = clock();
  const timeoutMs = options.params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = options.params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;

  for (;;) {
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
      throw options.createError("TIMEOUT", `Timed out after ${String(timeoutMs)}ms waiting for ${describeWait(options.params)}.`);
    }

    await sleep(Math.max(0, Math.min(intervalMs, timeoutMs - elapsedMs)));
  }
}

async function evaluateWaitCondition(options: {
  readonly document: Document;
  readonly params: WaitParams;
  readonly now: number;
  readonly elementResolver: ContentElementResolver;
  readonly summarizeElement: (element: Element, options?: { readonly ref: string; readonly generationId: string }) => WaitElementSummary;
  readonly isVisible: (element: Element) => boolean;
  readonly createError: (code: WaitErrorCode, message: string) => Error;
}): Promise<PendingWaitResult | undefined> {
  if (isBackgroundWaitKind(options.params.kind)) {
    throw options.createError("UNSUPPORTED_CAPABILITY", `${options.params.kind} waits are handled by the extension background.`);
  }

  switch (options.params.kind) {
    case "element":
      return evaluateElementWait(options);
    case "text":
      return evaluateTextWait(options);
    case "load-state":
      return isLoadStateReached(options.document, options.params.state) ? { kind: options.params.kind } : undefined;
    case "function":
      return evaluateFunctionWait(options);
  }
}

function isBackgroundWaitKind(kind: WaitParams["kind"]): kind is "ms" | "url" | "download" {
  return kind === "ms" || kind === "url" || kind === "download";
}

function evaluateTextWait(options: {
  readonly document: Document;
  readonly params: WaitParams;
  readonly isVisible: (element: Element) => boolean;
}): PendingWaitResult | undefined {
  const visibleText = visibleDocumentText(options.document, options.isVisible);
  return visibleText.includes(options.params.text ?? "") ? { kind: "text", value: options.params.text ?? "" } : undefined;
}

async function evaluateFunctionWait(options: {
  readonly document: Document;
  readonly params: WaitParams;
  readonly createError: (code: WaitErrorCode, message: string) => Error;
}): Promise<PendingWaitResult | undefined> {
  const value = await evaluateWaitExpression(options.document, options.params.expression ?? "", options.createError);
  return value ? { kind: "function", value: toWaitValue(value) } : undefined;
}

function evaluateElementWait(options: {
  readonly params: WaitParams;
  readonly now: number;
  readonly elementResolver: ContentElementResolver;
  readonly summarizeElement: (element: Element, options?: { readonly ref: string; readonly generationId: string }) => WaitElementSummary;
  readonly isVisible: (element: Element) => boolean;
  readonly createError: (code: WaitErrorCode, message: string) => Error;
}): PendingWaitResult | undefined {
  const state = options.params.state ?? "visible";
  if (options.params.ref !== undefined) {
    return evaluateElementRefWait(options, state, options.params.ref);
  }

  const selector = options.params.selector;
  if (selector === undefined) {
    throw options.createError("SELECTOR_NOT_FOUND", "Element selector is required.");
  }

  const element = options.elementResolver.queryOptional(selector);
  if (state === "hidden") {
    return evaluateHiddenSelectorWait(options, element);
  }

  if (element === null) {
    return undefined;
  }

  if (state === "attached") {
    return { kind: "element", element: options.summarizeElement(element) };
  }

  return options.isVisible(element) ? { kind: "element", element: options.summarizeElement(element) } : undefined;
}

function evaluateElementRefWait(
  options: {
    readonly params: WaitParams;
    readonly now: number;
    readonly elementResolver: ContentElementResolver;
    readonly summarizeElement: (element: Element, options?: { readonly ref: string; readonly generationId: string }) => WaitElementSummary;
    readonly isVisible: (element: Element) => boolean;
  },
  state: WaitParams["state"],
  ref: string,
): PendingWaitResult | undefined {
  const resolved = options.elementResolver.resolveRef(ref, {
    ...(options.params.generationId === undefined ? {} : { generationId: options.params.generationId }),
    now: options.now,
  });
  const base: PendingWaitResult = {
    kind: "element",
    element: options.summarizeElement(resolved.element, {
      ref,
      generationId: resolved.generationId,
    }),
  };
  return isElementStateMatched(state, resolved.element, options.isVisible) ? base : undefined;
}

function evaluateHiddenSelectorWait(
  options: {
    readonly summarizeElement: (element: Element) => WaitElementSummary;
    readonly isVisible: (element: Element) => boolean;
  },
  element: Element | null,
): PendingWaitResult | undefined {
  if (element !== null && options.isVisible(element)) {
    return undefined;
  }

  return {
    kind: "element",
    ...(element === null ? {} : { element: options.summarizeElement(element) }),
  };
}

function isElementStateMatched(state: WaitParams["state"], element: Element, isVisible: (element: Element) => boolean): boolean {
  return state === "attached" || (state === "visible" && isVisible(element)) || (state === "hidden" && !isVisible(element));
}

function isLoadStateReached(document: Document, state: WaitParams["state"] | undefined): boolean {
  if (state === "complete") {
    return document.readyState === "complete";
  }

  return document.readyState === "interactive" || document.readyState === "complete";
}

async function evaluateWaitExpression(document: Document, expression: string, createError: (code: WaitErrorCode, message: string) => Error): Promise<unknown> {
  try {
    const window = document.defaultView;
    const { Function: createFunction } = globalThis;
    // `wait --fn` intentionally evaluates user-provided predicates after pairing approval.
    // The protocol bounds expression size and the wait loop bounds total polling duration.
    const evaluator = createFunction(
      "document",
      "window",
      `"use strict"; const value = (${expression}); return typeof value === "function" ? value({ document, window }) : value;`,
    );
    const value: unknown = evaluator.call(globalThis, document, window);
    return await Promise.resolve(value);
  } catch (error) {
    throw createError("SCRIPT_INJECTION_FAILED", `Wait predicate failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function toWaitValue(value: unknown): GetValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null ? entry : describeUnknownValue(entry),
      ]),
    );
  }

  return describeUnknownValue(value);
}

function visibleDocumentText(document: Document, isVisible: (element: Element) => boolean): string {
  return collapseWhitespace(collectVisibleText(document.body, isVisible));
}

function collectVisibleText(node: Node, isVisible: (element: Element) => boolean): string {
  if (node.nodeType === node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (!isElementNode(node)) {
    return "";
  }

  if (!isVisible(node)) {
    return "";
  }

  return Array.from(node.childNodes)
    .map((child) => collectVisibleText(child, isVisible))
    .join(" ");
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === node.ELEMENT_NODE;
}

function describeWait(params: WaitParams): string {
  return waitDescriptionByKind[params.kind](params);
}

const waitDescriptionByKind: Readonly<Record<WaitParams["kind"], (params: WaitParams) => string>> = {
  element: (params) => `${waitStateDescription(params.state, "visible")} element ${params.ref ?? params.selector ?? ""}`.trim(),
  text: (params) => `text ${JSON.stringify(params.text ?? "")}`,
  function: () => "function predicate",
  "load-state": (params) => `load state ${waitStateDescription(params.state, "")}`.trim(),
  ms: (params) => `${String(params.durationMs ?? 0)}ms`,
  url: (params) => `URL ${JSON.stringify(params.urlGlob ?? "")}`,
  download: () => "download",
};

function waitStateDescription(state: WaitParams["state"] | undefined, fallback: string): string {
  return state ?? fallback;
}

function describeUnknownValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || typeof value === "symbol") {
    return value.toString();
  }

  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

async function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
