import type { FindParams, FindResult, FrameResult } from "@firefox-cli/protocol";
import { defaultSnapshotSemantics, type SnapshotSemantics } from "../snapshot-semantics.js";

export function createFindResult(document: Document, params: FindParams, semantics: SnapshotSemantics = defaultSnapshotSemantics): FindResult {
  const matches = Array.from(document.querySelectorAll("*")).filter((element) => matchesFindParams(element, params, semantics));
  const selected =
    params.nth !== undefined
      ? matches.slice(params.nth, params.nth + 1)
      : params.first === true
        ? matches.slice(0, 1)
        : params.last === true
          ? matches.slice(-1)
          : matches;
  return {
    elements: selected.map((element) => semantics.summarizeWaitElement(element)),
  };
}

function matchesFindParams(element: Element, params: FindParams, semantics: SnapshotSemantics): boolean {
  const value = params.value.toLowerCase();
  if (params.kind === "role") {
    return semantics.getRole(element).toLowerCase() === value;
  }
  if (params.kind === "text") {
    return element.textContent.toLowerCase().includes(value);
  }
  if (params.kind === "label") {
    return semantics.findLabelText(element).toLowerCase().includes(value);
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
    frames: Array.from(document.querySelectorAll("iframe")).map((frame, index) => {
      const title = frame.getAttribute("title");
      const src = frame.getAttribute("src");
      return {
        index,
        selector: `iframe:nth-of-type(${String(index + 1)})`,
        ...(title === null ? {} : { title }),
        ...(src === null ? {} : { url: src }),
      };
    }),
  };
}
