import type {
  ActionResult,
  ElementActionParams,
  KeyboardTextActionParams,
  PressParams,
  ScrollParams,
  SelectParams,
  TextActionParams,
} from "@firefox-cli/protocol";
import type {
  ActionOptions,
  ContentActionResult,
  EditableValueElement,
  ElementResolution,
} from "./content-action-types.js";

const DEFAULT_SCROLL_DISTANCE_PX = 600;

export function createActionResult(options: ActionOptions): ActionResult {
  return createContentActionResult(options) as ActionResult;
}

function createContentActionResult(options: ActionOptions): ContentActionResult {
  switch (options.command) {
    case "click":
      return mouseAction(options, "click");
    case "dblclick":
      return mouseAction(options, "dblclick");
    case "hover":
      return mouseAction(options, "hover");
    case "focus":
      return focusAction(options);
    case "fill":
      return fillAction(options, options.params as TextActionParams);
    case "type":
      return typeAction(options, options.params as TextActionParams);
    case "keyboard.type":
    case "keyboard.inserttext":
      return keyboardTextAction(options, options.params as KeyboardTextActionParams);
    case "press":
      return pressAction(options, options.params as PressParams);
    case "check":
      return checkAction(options, true);
    case "uncheck":
      return checkAction(options, false);
    case "select":
      return selectAction(options, options.params as SelectParams);
    case "scroll":
    case "swipe":
      return scrollAction(options, options.params as ScrollParams);
    case "scrollintoview":
      return scrollIntoViewAction(options);
  }
}

function mouseAction(
  options: ActionOptions,
  action: "click" | "dblclick" | "hover",
): ContentActionResult {
  const resolution = resolveRequiredElement(options, options.params as ElementActionParams);
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

function focusAction(options: ActionOptions): ContentActionResult {
  const resolution = resolveRequiredElement(options, options.params as ElementActionParams);
  assertVisible(options, resolution.element);
  assertEnabled(options, resolution.element);
  focusElement(resolution.element);
  return elementActionResult(options, resolution);
}

function fillAction(options: ActionOptions, params: TextActionParams): ContentActionResult {
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

function typeAction(options: ActionOptions, params: TextActionParams): ContentActionResult {
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

function keyboardTextAction(
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

function pressAction(options: ActionOptions, params: PressParams): ContentActionResult {
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

function checkAction(options: ActionOptions, checked: boolean): ContentActionResult {
  const resolution = resolveRequiredElement(options, options.params as ElementActionParams);
  assertActionableElement(options, resolution.element);
  const changed = setCheckedState(options, resolution.element, checked);
  if (changed) {
    dispatchInputEvents(resolution.element);
  }
  return elementActionResult(options, resolution);
}

function selectAction(options: ActionOptions, params: SelectParams): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
  assertActionableElement(options, resolution.element);
  const view = options.document.defaultView;
  if (view === null || !(resolution.element instanceof view.HTMLSelectElement)) {
    throw options.createError("ACTION_REJECTED", "Select action requires a <select> element.");
  }

  const values = new Set(params.values);
  const optionsByValue = new Map<string, HTMLOptionElement>();
  for (const option of Array.from(resolution.element.options)) {
    optionsByValue.set(option.value, option);
    optionsByValue.set(option.text, option);
  }

  const missing = params.values.filter((value) => !optionsByValue.has(value));
  if (missing.length > 0) {
    throw options.createError("OPTION_NOT_FOUND", `Option not found: ${missing.join(", ")}`);
  }

  if (resolution.element.multiple) {
    for (const option of Array.from(resolution.element.options)) {
      option.selected = values.has(option.value) || values.has(option.text);
    }
  } else {
    resolution.element.value = optionsByValue.get(params.values[0] ?? "")?.value ?? "";
  }
  dispatchInputEvents(resolution.element);

  return {
    ...elementActionResult(options, resolution),
    selectedValues: Array.from(resolution.element.selectedOptions).map((option) => option.value),
  };
}

function scrollAction(options: ActionOptions, params: ScrollParams): ContentActionResult {
  const distance = params.distancePx ?? DEFAULT_SCROLL_DISTANCE_PX;
  const delta = scrollDelta(params.direction, distance);
  const resolution = resolveOptionalElement(options, params);
  if (resolution !== undefined) {
    assertVisible(options, resolution.element);
    resolution.element.scrollLeft += delta.x;
    resolution.element.scrollTop += delta.y;
    return {
      ...elementActionResult(options, resolution),
      scroll: {
        x: resolution.element.scrollLeft,
        y: resolution.element.scrollTop,
      },
    };
  }

  const view = options.document.defaultView;
  if (view !== null) {
    try {
      view.scrollBy(delta.x, delta.y);
    } catch {
      // jsdom exposes scroll APIs that intentionally throw; return the intended offset in tests.
    }
  }

  return {
    action: options.command,
    ok: true,
    scroll: {
      x: view?.scrollX ?? delta.x,
      y: view?.scrollY ?? delta.y,
    },
  };
}

function scrollIntoViewAction(options: ActionOptions): ContentActionResult {
  const resolution = resolveRequiredElement(options, options.params as ElementActionParams);
  assertVisible(options, resolution.element);
  resolution.element.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
  return elementActionResult(options, resolution);
}

function resolveRequiredElement(
  options: ActionOptions,
  params: ElementActionParams | TextActionParams | SelectParams,
): ElementResolution {
  const resolution = resolveOptionalElement(options, params);
  if (resolution === undefined) {
    throw options.createError("SELECTOR_NOT_FOUND", "Element selector or ref is required.");
  }
  return resolution;
}

function resolveOptionalElement(
  options: ActionOptions,
  params:
    | ElementActionParams
    | TextActionParams
    | SelectParams
    | Pick<ScrollParams, "selector" | "ref" | "generationId">,
): ElementResolution | undefined {
  if (params.ref !== undefined) {
    const resolved = options.resolveRef(params.ref, {
      ...(params.generationId === undefined ? {} : { generationId: params.generationId }),
      now: options.now,
    });
    return { element: resolved.element, ref: params.ref, generationId: resolved.generationId };
  }

  if (params.selector === undefined) {
    return undefined;
  }

  const element = options.queryElement(params.selector);
  if (element === null) {
    throw options.createError("SELECTOR_NOT_FOUND", `Selector not found: ${params.selector}`);
  }
  return { element };
}

function elementActionResult(
  options: ActionOptions,
  resolution: ElementResolution,
): ContentActionResult {
  return {
    action: options.command,
    ok: true,
    element: options.summarizeElement(
      resolution.element,
      resolution.ref === undefined || resolution.generationId === undefined
        ? undefined
        : { ref: resolution.ref, generationId: resolution.generationId },
    ),
  };
}

function assertActionableElement(options: ActionOptions, element: Element): void {
  assertVisible(options, element);
  assertEnabled(options, element);
}

function assertVisible(options: ActionOptions, element: Element): void {
  if (!options.isVisible(element)) {
    throw options.createError("ELEMENT_NOT_VISIBLE", "Element is not visible.");
  }
}

function assertEnabled(options: ActionOptions, element: Element): void {
  if (options.isDisabled(element)) {
    throw options.createError("ELEMENT_DISABLED", "Element is disabled.");
  }
}

function requireFocusedElement(options: ActionOptions): Element {
  const focused = options.document.activeElement;
  if (
    focused === null ||
    (isDocumentShell(options.document, focused) && findEditableHost(options, focused) === undefined)
  ) {
    throw options.createError("NO_FOCUSED_ELEMENT", "No focused element is available.");
  }
  return focused;
}

function isDocumentShell(document: Document, element: Element): boolean {
  return element === document.body || element === document.documentElement;
}

function requireEditable(options: ActionOptions, element: Element): HTMLElement {
  const editable = findEditableHost(options, element);
  if (editable === undefined) {
    throw options.createError("NOT_EDITABLE", "Element is not editable.");
  }
  if (options.isDisabled(editable)) {
    throw options.createError("ELEMENT_DISABLED", "Element is disabled.");
  }
  return editable;
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

function setEditableText(element: HTMLElement, text: string): void {
  if (isEditableValueElement(element)) {
    element.value = text;
    setSelection(element, text.length);
    return;
  }

  element.textContent = text;
}

function insertText(
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

function dispatchBeforeInput(options: ActionOptions, element: Element, text: string): void {
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

function setCheckedState(options: ActionOptions, element: Element, checked: boolean): boolean {
  const view = options.document.defaultView;
  if (view !== null && element instanceof view.HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "checkbox" || type === "radio") {
      const changed = element.checked !== checked;
      element.checked = checked;
      return changed;
    }
  }

  const role = element.getAttribute("role");
  if (
    role === "checkbox" ||
    role === "switch" ||
    role === "menuitemcheckbox" ||
    role === "radio" ||
    role === "menuitemradio"
  ) {
    const changed = element.getAttribute("aria-checked") !== String(checked);
    element.setAttribute("aria-checked", String(checked));
    return changed;
  }

  throw options.createError("ACTION_REJECTED", "Check action requires a checkable element.");
}

function clickElement(element: Element): void {
  if ("click" in element && typeof element.click === "function") {
    element.click();
    return;
  }

  dispatchMouseEvent(element, "click");
}

function focusElement(element: Element): void {
  if ("focus" in element && typeof element.focus === "function") {
    element.focus();
  }
}

function dispatchInputEvents(element: Element): void {
  dispatchInputEvent(element);
  dispatchChangeEvent(element);
}

function dispatchInputEvent(element: Element): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(new view.Event("input", { bubbles: true, cancelable: false }));
}

function dispatchChangeEvent(element: Element): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(new view.Event("change", { bubbles: true, cancelable: false }));
}

function dispatchMouseEvent(element: Element, type: string): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(
    new view.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view,
    }),
  );
}

function dispatchKeyboardEvent(element: Element, type: string, key: string): void {
  const view = requireElementWindow(element);
  element.dispatchEvent(
    new view.KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key,
    }),
  );
}

function requireElementWindow(element: Element): NonNullable<Document["defaultView"]> {
  const view = element.ownerDocument.defaultView;
  if (view === null) {
    throw new Error("Document has no window.");
  }
  return view;
}

function scrollDelta(
  direction: ScrollParams["direction"],
  distance: number,
): { readonly x: number; readonly y: number } {
  switch (direction) {
    case "up":
      return { x: 0, y: -distance };
    case "down":
      return { x: 0, y: distance };
    case "left":
      return { x: -distance, y: 0 };
    case "right":
      return { x: distance, y: 0 };
  }
}
