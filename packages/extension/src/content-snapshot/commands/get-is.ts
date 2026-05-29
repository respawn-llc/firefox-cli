import type { GetParams, GetResult, IsParams, IsResult } from "@firefox-cli/protocol";
import type { ElementRefRegistry } from "../../element-ref-registry.js";
import {
  boxValue,
  getElementChecked,
  getElementValue,
  isDisabled,
  isVisible,
  styleValue,
  summarizeElement,
} from "../accessibility.js";
import { resolveElementForContentCommand, queryAllElements } from "../dom.js";
import { ContentSnapshotError } from "../errors.js";
import { DEFAULT_MAX_OUTPUT_BYTES, collapseWhitespace, truncateText } from "../format.js";

export function createGetResult(
  document: Document,
  params: GetParams,
  registry: ElementRefRegistry<Element>,
  now = Date.now(),
): GetResult {
  if (params.kind === "title") {
    return { kind: params.kind, value: document.title };
  }

  if (params.kind === "url") {
    return { kind: params.kind, value: document.location.href };
  }

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
    case "text": {
      const truncated = truncateText(
        collapseWhitespace(resolution.element.textContent ?? ""),
        params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      );
      return { ...base, kind: params.kind, value: truncated.text, truncated: truncated.truncated };
    }
    case "html": {
      const truncated = truncateText(
        resolution.element.outerHTML,
        params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      );
      return { ...base, kind: params.kind, value: truncated.text, truncated: truncated.truncated };
    }
    case "value":
      return { ...base, kind: params.kind, value: getElementValue(resolution.element) ?? null };
    case "attr":
      return {
        ...base,
        kind: params.kind,
        value: resolution.element.getAttribute(params.attribute ?? "") ?? null,
      };
    case "count":
      return {
        ...base,
        kind: params.kind,
        value:
          params.selector === undefined ? 1 : queryAllElements(document, params.selector).length,
      };
    case "box":
      return {
        ...base,
        kind: params.kind,
        value: boxValue(resolution.element.getBoundingClientRect()),
      };
    case "styles":
      return { ...base, kind: params.kind, value: styleValue(resolution.element) };
  }
}

export function createIsResult(
  document: Document,
  params: IsParams,
  registry: ElementRefRegistry<Element>,
  now = Date.now(),
): IsResult {
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
        throw new ContentSnapshotError(
          "UNSUPPORTED_CAPABILITY",
          "Checked state is available only for checkable elements.",
        );
      }
      return { ...base, kind: params.kind, value: checked };
    }
  }
}
