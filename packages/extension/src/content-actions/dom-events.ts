import type { ActionOptions } from "../content-action-types.js";
import { dispatchDragEventWithDataTransfer } from "./dom-compat.js";

export function clickElement(element: Element): void {
  if ("click" in element && typeof element.click === "function") {
    element.click();
    return;
  }

  dispatchMouseEvent(element, "click");
}

export function focusElement(element: Element): void {
  if ("focus" in element && typeof element.focus === "function") {
    element.focus();
  }
}

export function dispatchInputEvents(element: Element): void {
  dispatchInputEvent(element);
  dispatchChangeEvent(element);
}

export function dispatchInputEvent(element: Element): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(new view.Event("input", { bubbles: true, cancelable: false }));
}

export function dispatchChangeEvent(element: Element): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(new view.Event("change", { bubbles: true, cancelable: false }));
}

export function dispatchBeforeInput(options: ActionOptions, element: Element, text: string): void {
  const view = requireElementWindow(element);
  const InputEventConstructor = view.InputEvent;
  const event =
    InputEventConstructor === undefined
      ? new view.Event("beforeinput", { bubbles: true, cancelable: true })
      : new InputEventConstructor("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        });
  if (!element.dispatchEvent(event)) {
    throw options.createError("ACTION_REJECTED", "Text insertion was rejected by the page.");
  }
}

export function dispatchMouseEvent(
  element: Element,
  type: string,
  options: {
    readonly x?: number;
    readonly y?: number;
    readonly button?: number;
  } = {},
): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(
    new view.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view,
      ...(options.x === undefined ? {} : { clientX: options.x }),
      ...(options.y === undefined ? {} : { clientY: options.y }),
      ...(options.button === undefined ? {} : { button: options.button }),
    }),
  );
}

export function dispatchWheelEvent(
  element: Element,
  deltaX: number,
  deltaY: number,
  options: {
    readonly x?: number;
    readonly y?: number;
  } = {},
): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(
    new view.WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX,
      deltaY,
      view,
      ...(options.x === undefined ? {} : { clientX: options.x }),
      ...(options.y === undefined ? {} : { clientY: options.y }),
    }),
  );
}

export function dispatchDragEvent(
  element: Element,
  type: string,
  dataTransfer: DataTransfer,
): void {
  dispatchDragEventWithDataTransfer(element, type, dataTransfer);
}

export function dispatchKeyboardEvent(element: Element, type: string, key: string): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(
    new view.KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key,
    }),
  );
}

export function requireElementWindow(element: Element): NonNullable<Document["defaultView"]> {
  const view = element.ownerDocument.defaultView;
  if (view === null) {
    throw new Error("Document has no window.");
  }
  return view;
}
