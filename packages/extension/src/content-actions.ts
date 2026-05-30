import {
  getBase64DecodedByteLength,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
} from "@firefox-cli/protocol";
import type {
  ActionKind,
  ActionResult,
  CommandParams,
  DragParams,
  ElementActionParams,
  KeyboardTextActionParams,
  KeyEventParams,
  MouseParams,
  PressParams,
  ScrollParams,
  SelectParams,
  TextActionParams,
  UploadParams,
} from "@firefox-cli/protocol";
import type {
  ActionOptions,
  ContentActionResult,
  ElementResolution,
} from "./content-action-types.js";
import {
  assignFileInputFiles,
  createDomDataTransfer,
  createLocalFileList,
} from "./content-actions/dom-compat.js";
import {
  clickElement,
  dispatchDragEvent,
  dispatchInputEvents,
  dispatchKeyboardEvent,
  dispatchMouseEvent,
  dispatchWheelEvent,
  focusElement,
  requireElementWindow,
} from "./content-actions/dom-events.js";
import {
  insertText,
  requireEditable,
  requireFocusedElement,
  setEditableText,
} from "./content-actions/editable.js";

const DEFAULT_SCROLL_DISTANCE_PX = 600;

export function createActionResult(options: ActionOptions): ActionResult {
  return createContentActionResult(options) as ActionResult;
}

type ActionHandlerMap = {
  readonly [C in ActionKind]: (
    options: ActionOptions<C>,
    params: CommandParams<C>,
  ) => ContentActionResult;
};

const actionHandlers: ActionHandlerMap = {
  click: (options, params) => mouseAction(options, params, "click"),
  dblclick: (options, params) => mouseAction(options, params, "dblclick"),
  hover: (options, params) => mouseAction(options, params, "hover"),
  focus: focusAction,
  fill: fillAction,
  type: typeAction,
  "keyboard.type": keyboardTextAction,
  "keyboard.inserttext": keyboardTextAction,
  press: pressAction,
  check: (options, params) => checkAction(options, params, true),
  uncheck: (options, params) => checkAction(options, params, false),
  select: selectAction,
  scroll: scrollAction,
  swipe: scrollAction,
  scrollintoview: scrollIntoViewAction,
  drag: dragAction,
  upload: uploadAction,
  mouse: directMouseAction,
  keydown: keyEventAction,
  keyup: keyEventAction,
};

function createContentActionResult<C extends ActionKind>(
  options: ActionOptions<C>,
): ContentActionResult {
  const handler = actionHandlers[options.command];
  if (handler === undefined) {
    throw options.createError(
      "ACTION_REJECTED",
      `Unsupported content action: ${String(options.command)}`,
    );
  }
  return handler(options, options.params);
}

function dragAction(options: ActionOptions, params: DragParams): ContentActionResult {
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

function uploadAction(options: ActionOptions, params: UploadParams): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
  assertVisible(options, resolution.element);
  assertEnabled(options, resolution.element);
  const view = requireElementWindow(resolution.element);
  if (
    !(resolution.element instanceof view.HTMLInputElement) ||
    resolution.element.type !== "file"
  ) {
    throw options.createError("ACTION_REJECTED", "Upload action requires a file input.");
  }
  const dataTransfer = createDomDataTransfer(resolution.element);
  const files: File[] = [];
  let totalBytes = 0;
  for (const file of params.files) {
    const decodedBytes = getBase64DecodedByteLength(file.dataBase64);
    if (decodedBytes === null) {
      throw options.createError("ACTION_REJECTED", "Upload file data must be valid base64.");
    }
    if (decodedBytes > MAX_UPLOAD_FILE_BYTES) {
      throw options.createError(
        "OUTPUT_TOO_LARGE",
        `Upload file exceeds the ${MAX_UPLOAD_FILE_BYTES} byte per-file limit.`,
      );
    }
    totalBytes += decodedBytes;
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
      throw options.createError(
        "OUTPUT_TOO_LARGE",
        `Upload files exceed the ${MAX_UPLOAD_TOTAL_BYTES} byte total limit.`,
      );
    }

    const bytes = Uint8Array.from(view.atob(file.dataBase64), (char) => char.charCodeAt(0));
    const uploaded = new view.File([bytes], file.name, { type: file.mimeType ?? "" });
    files.push(uploaded);
    dataTransfer.items.add(uploaded);
  }
  assignFiles(
    resolution.element,
    dataTransfer.files.length > 0 ? dataTransfer.files : createLocalFileList(files),
  );
  dispatchInputEvents(resolution.element);
  return {
    ...elementActionResult(options, resolution),
    action: "upload",
    valueLength: params.files.length,
  };
}

function directMouseAction(options: ActionOptions, params: MouseParams): ContentActionResult {
  const resolution = resolveOptionalElement(options, params);
  const element =
    resolution?.element ?? options.document.elementFromPoint(params.x ?? 0, params.y ?? 0);
  if (element === null) {
    throw options.createError("SELECTOR_NOT_FOUND", "Mouse target was not found.");
  }
  const pointerOptions = {
    ...(params.x === undefined ? {} : { x: params.x }),
    ...(params.y === undefined ? {} : { y: params.y }),
    ...(params.button === undefined ? {} : { button: params.button }),
  };
  if (params.action === "wheel") {
    dispatchWheelEvent(element, params.deltaX ?? 0, params.deltaY ?? 0, pointerOptions);
  } else {
    dispatchMouseEvent(
      element,
      params.action === "move" ? "mousemove" : params.action === "down" ? "mousedown" : "mouseup",
      pointerOptions,
    );
  }
  return {
    action: "mouse",
    ok: true,
    element: options.summarizeElement(element),
  };
}

function keyEventAction(options: ActionOptions, params: KeyEventParams): ContentActionResult {
  const resolution = resolveOptionalElement(options, params);
  const element = resolution?.element ?? requireFocusedElement(options);
  dispatchKeyboardEvent(element, options.command, params.key);
  return {
    action: options.command,
    ok: true,
    element: options.summarizeElement(element),
  };
}

function mouseAction(
  options: ActionOptions,
  params: ElementActionParams,
  action: "click" | "dblclick" | "hover",
): ContentActionResult {
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

function focusAction(options: ActionOptions, params: ElementActionParams): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
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

function checkAction(
  options: ActionOptions,
  params: ElementActionParams,
  checked: boolean,
): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
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

function scrollIntoViewAction(
  options: ActionOptions,
  params: ElementActionParams,
): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
  assertVisible(options, resolution.element);
  resolution.element.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
  return elementActionResult(options, resolution);
}

function resolveRequiredElement(
  options: ActionOptions,
  params: ElementActionParams | TextActionParams | SelectParams | UploadParams,
): ElementResolution {
  if (options.elementResolver !== undefined) {
    return options.elementResolver.resolveRequiredTarget(params, {
      missingMessage: "Element selector or ref is required.",
      now: options.now,
    });
  }

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
    | UploadParams
    | Pick<ScrollParams, "selector" | "ref" | "generationId">,
): ElementResolution | undefined {
  if (options.elementResolver !== undefined) {
    return options.elementResolver.resolveOptionalTarget(params, options.now);
  }

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

function resolveRequiredDragElement(
  options: ActionOptions,
  params: DragParams,
  role: "source" | "target",
): ElementResolution {
  if (options.elementResolver !== undefined) {
    return options.elementResolver.resolveRequiredDragTarget(params, role, options.now);
  }

  const selector = role === "source" ? params.sourceSelector : params.targetSelector;
  const ref = role === "source" ? params.sourceRef : params.targetRef;
  const generationId = role === "source" ? params.sourceGenerationId : params.targetGenerationId;
  const resolution = resolveOptionalElement(options, {
    ...(selector === undefined ? {} : { selector }),
    ...(ref === undefined ? {} : { ref }),
    ...(generationId === undefined ? {} : { generationId }),
  });
  if (resolution === undefined) {
    throw options.createError("SELECTOR_NOT_FOUND", `Drag ${role} is required.`);
  }
  return resolution;
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

function assignFiles(input: HTMLInputElement, files: FileList): void {
  assignFileInputFiles(input, files);
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
