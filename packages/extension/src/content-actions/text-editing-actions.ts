import type { KeyboardTextActionParams, TextActionParams } from "@firefox-cli/protocol";
import type { ActionOptions, ContentActionResult } from "../content-action-types.js";
import {
  assertActionableElement,
  elementActionResult,
  resolveRequiredElement,
} from "./action-targets.js";
import { dispatchInputEvents, focusElement } from "./dom-events.js";
import { insertText, requireEditable, requireFocusedElement, setEditableText } from "./editable.js";

export function fillAction(options: ActionOptions, params: TextActionParams): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
  assertActionableElement(options, resolution.element);
  const editable = requireEditable(options, resolution.element);
  setEditableText(editable, params.text);
  dispatchInputEvents(editable);
  return {
    ...elementActionResult(options, resolution),
    valueLength: params.text.length,
  };
}

export function typeAction(options: ActionOptions, params: TextActionParams): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
  assertActionableElement(options, resolution.element);
  const editable = requireEditable(options, resolution.element);
  focusElement(editable);
  insertText(options, editable, params.text, { keyboardEvents: true });
  return {
    ...elementActionResult(options, resolution),
    valueLength: params.text.length,
  };
}

export function keyboardTextAction(
  options: ActionOptions,
  params: KeyboardTextActionParams,
): ContentActionResult {
  const focused = requireFocusedElement(options);
  const editable = requireEditable(options, focused);
  insertText(options, editable, params.text, {
    keyboardEvents: options.command === "keyboard.type",
  });
  return {
    action: options.command,
    ok: true,
    element: options.summarizeElement(editable),
    valueLength: params.text.length,
  };
}
