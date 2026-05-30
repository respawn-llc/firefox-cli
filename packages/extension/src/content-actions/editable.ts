import type { ActionOptions, EditableValueElement } from "../content-action-types.js";
import {
  dispatchBeforeInput,
  dispatchChangeEvent,
  dispatchInputEvent,
  dispatchKeyboardEvent,
} from "./dom-events.js";

export function requireFocusedElement(options: ActionOptions): Element {
  const focused = options.document.activeElement;
  if (
    focused === null ||
    (isDocumentShell(options.document, focused) && findEditableHost(options, focused) === undefined)
  ) {
    throw options.createError("NO_FOCUSED_ELEMENT", "No focused element is available.");
  }
  return focused;
}

export function requireEditable(options: ActionOptions, element: Element): HTMLElement {
  const editable = findEditableHost(options, element);
  if (editable === undefined) {
    throw options.createError("NOT_EDITABLE", "Element is not editable.");
  }
  if (options.isDisabled(editable)) {
    throw options.createError("ELEMENT_DISABLED", "Element is disabled.");
  }
  return editable;
}

export function setEditableText(element: HTMLElement, text: string): void {
  if (isEditableValueElement(element)) {
    element.value = text;
    setSelection(element, text.length);
    return;
  }

  element.textContent = text;
}

export function insertText(
  options: ActionOptions,
  element: HTMLElement,
  text: string,
  settings: { readonly keyboardEvents: boolean },
): void {
  for (const char of text) {
    if (settings.keyboardEvents) {
      dispatchKeyboardEvent(element, "keydown", char);
      dispatchKeyboardEvent(element, "keypress", char);
    }

    dispatchBeforeInput(options, element, char);
    insertTextValue(element, char);
    dispatchInputEvent(element);

    if (settings.keyboardEvents) {
      dispatchKeyboardEvent(element, "keyup", char);
    }
  }

  dispatchChangeEvent(element);
}

function isDocumentShell(document: Document, element: Element): boolean {
  return element === document.body || element === document.documentElement;
}

function findEditableHost(options: ActionOptions, element: Element): HTMLElement | undefined {
  const view = options.document.defaultView;
  if (view === null || !(element instanceof view.HTMLElement)) {
    return undefined;
  }

  if (
    element instanceof view.HTMLInputElement &&
    isEditableInputType(element.getAttribute("type"))
  ) {
    return element;
  }

  if (element instanceof view.HTMLTextAreaElement) {
    return element;
  }

  const editable = element.closest<HTMLElement>("[contenteditable]");
  if (editable !== null && editable.getAttribute("contenteditable") !== "false") {
    return editable;
  }

  return undefined;
}

function isEditableInputType(type: string | null): boolean {
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes((type ?? "text").toLowerCase());
}

function insertTextValue(element: HTMLElement, text: string): void {
  if (isEditableValueElement(element)) {
    const value = element.value;
    const start =
      typeof element.selectionStart === "number" ? element.selectionStart : value.length;
    const end = typeof element.selectionEnd === "number" ? element.selectionEnd : start;
    element.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
    setSelection(element, start + text.length);
    return;
  }

  element.textContent = `${element.textContent ?? ""}${text}`;
}

function setSelection(element: HTMLElement, position: number): void {
  if (isEditableValueElement(element) && typeof element.setSelectionRange === "function") {
    try {
      element.setSelectionRange(position, position);
    } catch {
      // Some input types expose selection APIs but reject programmatic selection.
    }
  }
}

function isEditableValueElement(element: HTMLElement): element is EditableValueElement {
  return "value" in element && typeof element.value === "string";
}
