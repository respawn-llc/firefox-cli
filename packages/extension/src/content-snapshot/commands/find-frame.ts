import type { FindParams, FindResult, FrameResult } from "@firefox-cli/protocol";
import { findLabelText, getRole, summarizeWaitElement } from "../accessibility.js";

export function createFindResult(document: Document, params: FindParams): FindResult {
  const matches = Array.from(document.querySelectorAll("*")).filter((element) =>
    matchesFindParams(element, params),
  );
  const selected =
    params.nth !== undefined
      ? matches.slice(params.nth, params.nth + 1)
      : params.first === true
        ? matches.slice(0, 1)
        : params.last === true
          ? matches.slice(-1)
          : matches;
  return {
    elements: selected.map((element) => summarizeWaitElement(element)),
  };
}

function matchesFindParams(element: Element, params: FindParams): boolean {
  const value = params.value.toLowerCase();
  if (params.kind === "role") {
    return getRole(element).toLowerCase() === value;
  }
  if (params.kind === "text") {
    return (element.textContent ?? "").toLowerCase().includes(value);
  }
  if (params.kind === "label") {
    return findLabelText(element).toLowerCase().includes(value);
  }
  if (params.kind === "placeholder") {
    return (element.getAttribute("placeholder") ?? "").toLowerCase().includes(value);
  }
  if (params.kind === "alt") {
    return (element.getAttribute("alt") ?? "").toLowerCase().includes(value);
  }
  if (params.kind === "title") {
    return (element.getAttribute("title") ?? "").toLowerCase().includes(value);
  }
  return (element.getAttribute("data-testid") ?? "").toLowerCase() === value;
}

export function createFrameResult(document: Document): FrameResult {
  return {
    frames: Array.from(document.querySelectorAll("iframe")).map((frame, index) => ({
      index,
      selector: `iframe:nth-of-type(${index + 1})`,
      ...(frame.getAttribute("title") === null ? {} : { title: frame.getAttribute("title") ?? "" }),
      ...(frame.getAttribute("src") === null ? {} : { url: frame.getAttribute("src") ?? "" }),
    })),
  };
}
