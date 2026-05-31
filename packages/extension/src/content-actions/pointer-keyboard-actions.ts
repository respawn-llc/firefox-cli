import type { DragParams, ElementActionParams, KeyEventParams, MouseParams, PressParams } from "@firefox-cli/protocol";
import type { ActionOptions, ContentActionResult } from "../content-action-types.js";
import { assertActionableElement, elementActionResult, resolveOptionalElement, resolveRequiredDragElement, resolveRequiredElement } from "./action-targets.js";
import { clickElement, dispatchDragEvent, dispatchKeyboardEvent, dispatchMouseEvent, dispatchWheelEvent } from "./dom-events.js";
import { createDomDataTransfer } from "./dom-compat.js";
import { requireFocusedElement } from "./editable.js";

export function dragAction(options: ActionOptions, params: DragParams): ContentActionResult {
  const source = resolveRequiredDragElement(options, params, "source");
  const target = resolveRequiredDragElement(options, params, "target");
  assertActionableElement(options, source.element);
  assertActionableElement(options, target.element);
  const dataTransfer = createDomDataTransfer(source.element);
  dispatchDragEvent(source.element, "dragstart", dataTransfer);
  dispatchDragEvent(target.element, "dragenter", dataTransfer);
  dispatchDragEvent(target.element, "dragover", dataTransfer);
  dispatchDragEvent(target.element, "drop", dataTransfer);
  dispatchDragEvent(source.element, "dragend", dataTransfer);
  return {
    action: "drag",
    ok: true,
    element: options.summarizeElement(target.element),
  };
}

export function directMouseAction(options: ActionOptions, params: MouseParams): ContentActionResult {
  const resolution = resolveOptionalElement(options, params);
  const element = resolution?.element ?? options.document.elementFromPoint(params.x ?? 0, params.y ?? 0);
  if (element === null) {
    throw options.createError("SELECTOR_NOT_FOUND", "Mouse target was not found.");
  }
  const pointerOptions = {
    ...(params.x === undefined ? {} : { x: params.x }),
    ...(params.y === undefined ? {} : { y: params.y }),
    ...(params.button === undefined ? {} : { button: params.button }),
  };
  dispatchDirectMouseEvent(element, params, pointerOptions);
  return {
    action: "mouse",
    ok: true,
    element: options.summarizeElement(element),
  };
}

function dispatchDirectMouseEvent(
  element: Element,
  params: MouseParams,
  pointerOptions: {
    readonly x?: number;
    readonly y?: number;
    readonly button?: number;
  },
): void {
  switch (params.action) {
    case "wheel":
      dispatchWheelEvent(element, params.deltaX ?? 0, params.deltaY ?? 0, pointerOptions);
      return;
    case "move":
      dispatchMouseEvent(element, "mousemove", pointerOptions);
      return;
    case "down":
      dispatchMouseEvent(element, "mousedown", pointerOptions);
      return;
    case "up":
      dispatchMouseEvent(element, "mouseup", pointerOptions);
      return;
  }
}

export function keyEventAction(options: ActionOptions, params: KeyEventParams): ContentActionResult {
  const resolution = resolveOptionalElement(options, params);
  const element = resolution?.element ?? requireFocusedElement(options);
  dispatchKeyboardEvent(element, options.command, params.key);
  return {
    action: options.command,
    ok: true,
    element: options.summarizeElement(element),
  };
}

export function mouseAction(options: ActionOptions, params: ElementActionParams, action: "click" | "dblclick" | "hover"): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
  assertActionableElement(options, resolution.element);

  if (action === "hover") {
    for (const eventName of ["mouseover", "mouseenter", "mousemove"]) {
      dispatchMouseEvent(resolution.element, eventName);
    }
  } else if (action === "click") {
    dispatchMouseEvent(resolution.element, "mouseover");
    dispatchMouseEvent(resolution.element, "mousedown");
    dispatchMouseEvent(resolution.element, "mouseup");
    clickElement(resolution.element);
  } else {
    dispatchMouseEvent(resolution.element, "mousedown");
    dispatchMouseEvent(resolution.element, "mouseup");
    clickElement(resolution.element);
    dispatchMouseEvent(resolution.element, "mousedown");
    dispatchMouseEvent(resolution.element, "mouseup");
    clickElement(resolution.element);
    dispatchMouseEvent(resolution.element, "dblclick");
  }

  return elementActionResult(options, resolution);
}

export function pressAction(options: ActionOptions, params: PressParams): ContentActionResult {
  if (params.key.length === 0) {
    throw options.createError("INVALID_KEY", "Key must not be empty.");
  }

  const focused = requireFocusedElement(options);
  dispatchKeyboardEvent(focused, "keydown", params.key);
  dispatchKeyboardEvent(focused, "keypress", params.key);
  dispatchKeyboardEvent(focused, "keyup", params.key);
  return {
    action: options.command,
    ok: true,
    element: options.summarizeElement(focused),
  };
}
