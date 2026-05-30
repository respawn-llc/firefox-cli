import {
  getBase64DecodedByteLength,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
} from "@firefox-cli/protocol";
import type { ElementActionParams, SelectParams, UploadParams } from "@firefox-cli/protocol";
import type { ActionOptions, ContentActionResult } from "../content-action-types.js";
import {
  assertActionableElement,
  assertEnabled,
  assertVisible,
  elementActionResult,
  resolveRequiredElement,
} from "./action-targets.js";
import { assignFileInputFiles, createDomDataTransfer, createLocalFileList } from "./dom-compat.js";
import { dispatchInputEvents, requireElementWindow } from "./dom-events.js";

export function uploadAction(options: ActionOptions, params: UploadParams): ContentActionResult {
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

export function checkAction(
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

export function selectAction(options: ActionOptions, params: SelectParams): ContentActionResult {
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
