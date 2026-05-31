import type { GetParams, GetResult, IsParams, IsResult } from "@firefox-cli/protocol";
import type { ElementRefRegistry } from "../../element-ref-registry.js";
import { boxValue, getElementChecked, getElementValue, isDisabled, isVisible, styleValue, summarizeElement } from "../accessibility.js";
import { resolveElementForContentCommand, queryAllElements } from "../dom.js";
import { ContentSnapshotError } from "../errors.js";
import { DEFAULT_MAX_OUTPUT_BYTES, collapseWhitespace, truncateText } from "../format.js";

type ElementGetKind = Exclude<GetParams["kind"], "title" | "url">;
type ElementGetParams = GetParams & { readonly kind: ElementGetKind };
type StructuredElementGetKind = Exclude<ElementGetKind, "text" | "html">;
type StructuredElementGetParams = ElementGetParams & { readonly kind: StructuredElementGetKind };

export function createGetResult(document: Document, params: GetParams, registry: ElementRefRegistry<Element>, now = Date.now()): GetResult {
  if (params.kind === "title") {
    return { kind: params.kind, value: document.title };
  }
  if (params.kind === "url") {
    return { kind: params.kind, value: document.location.href };
  }
  if (isElementGetParams(params)) {
    return createElementGetResult(document, params, registry, now);
  }
  throw new ContentSnapshotError("UNSUPPORTED_CAPABILITY", `Unsupported get kind: ${params.kind}`);
}

function createElementGetResult(document: Document, params: ElementGetParams, registry: ElementRefRegistry<Element>, now: number): GetResult {
  const resolution = resolveElementForContentCommand(document, params, registry, now);
  const base = summarizeResolution(resolution);

  if (params.kind === "text") {
    const truncated = truncateText(collapseWhitespace(resolution.element.textContent), params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
    return { ...base, kind: params.kind, value: truncated.text, truncated: truncated.truncated };
  }
  if (params.kind === "html") {
    const truncated = truncateText(resolution.element.outerHTML, params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
    return { ...base, kind: params.kind, value: truncated.text, truncated: truncated.truncated };
  }

  if (isStructuredElementGetParams(params)) {
    return createStructuredElementGetResult(document, params, resolution.element, base);
  }
  throw new ContentSnapshotError("UNSUPPORTED_CAPABILITY", `Unsupported get kind: ${params.kind}`);
}

function createStructuredElementGetResult(
  document: Document,
  params: StructuredElementGetParams,
  element: Element,
  base: { readonly element?: ReturnType<typeof summarizeElement> },
): GetResult {
  switch (params.kind) {
    case "value":
      return { ...base, kind: params.kind, value: getElementValue(element) ?? null };
    case "attr":
      return { ...base, kind: params.kind, value: element.getAttribute(params.attribute ?? "") ?? null };
    case "count":
      return {
        ...base,
        kind: params.kind,
        value: params.selector === undefined ? 1 : queryAllElements(document, params.selector).length,
      };
    case "box":
      return {
        ...base,
        kind: params.kind,
        value: boxValue(element.getBoundingClientRect()),
      };
    case "styles":
      return { ...base, kind: params.kind, value: styleValue(element) };
  }
}

function summarizeResolution(resolution: { readonly element: Element; readonly ref?: string; readonly generationId?: string }): {
  readonly element?: ReturnType<typeof summarizeElement>;
} {
  return resolution.ref === undefined || resolution.generationId === undefined
    ? {}
    : { element: summarizeElement(resolution.element, { ref: resolution.ref, generationId: resolution.generationId }) };
}

function isElementGetParams(params: GetParams): params is ElementGetParams {
  return params.kind !== "title" && params.kind !== "url";
}

function isStructuredElementGetParams(params: ElementGetParams): params is StructuredElementGetParams {
  return params.kind !== "text" && params.kind !== "html";
}

export function createIsResult(document: Document, params: IsParams, registry: ElementRefRegistry<Element>, now = Date.now()): IsResult {
  const resolution = resolveElementForContentCommand(document, params, registry, now);
  const base = {
    ...(resolution.ref === undefined || resolution.generationId === undefined
      ? {}
      : {
          element: summarizeElement(resolution.element, {
            ref: resolution.ref,
            generationId: resolution.generationId,
          }),
        }),
  };

  switch (params.kind) {
    case "visible":
      return { ...base, kind: params.kind, value: isVisible(resolution.element) };
    case "enabled":
      return { ...base, kind: params.kind, value: !isDisabled(resolution.element) };
    case "checked": {
      const checked = getElementChecked(resolution.element);
      if (checked === undefined) {
        throw new ContentSnapshotError("UNSUPPORTED_CAPABILITY", "Checked state is available only for checkable elements.");
      }
      return { ...base, kind: params.kind, value: checked };
    }
  }
}
