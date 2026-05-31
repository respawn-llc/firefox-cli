import type { GetBoxValue, GetStylesValue } from "@firefox-cli/protocol";
import { collapseWhitespace } from "./format.js";
import { getElementValue } from "./snapshot-semantics.js";

export function getElementText(element: Element): string {
  const value = getElementValue(element);
  return value ?? collapseWhitespace(element.textContent);
}

export function setElementText(element: Element, text: string): void {
  const view = element.ownerDocument.defaultView;
  if (view !== null && element instanceof view.HTMLInputElement) {
    element.value = text;
  } else if (view !== null && element instanceof view.HTMLTextAreaElement) {
    element.value = text;
  } else {
    element.textContent = text;
  }
  element.dispatchEvent(new (view?.Event ?? Event)("input", { bubbles: true }));
  element.dispatchEvent(new (view?.Event ?? Event)("change", { bubbles: true }));
}

export function boxValue(rect: DOMRect): GetBoxValue {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

export function styleValue(element: Element): GetStylesValue {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style === undefined) {
    return {
      display: "",
      visibility: "",
      opacity: "",
      pointerEvents: "",
      position: "",
      overflow: "",
      overflowX: "",
      overflowY: "",
      color: "",
      backgroundColor: "",
      fontSize: "",
    };
  }

  return {
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    pointerEvents: style.pointerEvents,
    position: style.position,
    overflow: style.overflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontSize: style.fontSize,
  };
}
