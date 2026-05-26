import {
  createErrorResponse,
  createOkResponse,
  type ErrorCode,
  type ElementSummary,
  type GetBoxValue,
  type GetParams,
  type GetResult,
  type GetStylesValue,
  type IsParams,
  type IsResult,
  type RequestEnvelope,
  type ResponseEnvelope,
  type RefResolveParams,
  type SnapshotFrameDiagnostic,
  type SnapshotParams,
  type SnapshotResult,
  type WaitParams,
  type WaitElementSummary,
} from "@firefox-cli/protocol";
import { createWaitResult } from "./content-wait.js";
import { type ElementRefRegistry, ElementRefRegistryError } from "./element-ref-registry.js";
export { ElementRefRegistry } from "./element-ref-registry.js";

const DEFAULT_MAX_OUTPUT_BYTES = 60_000;

type SnapshotEntry = {
  readonly element: Element;
  readonly depth: number;
  readonly role: string;
  readonly name?: string;
  readonly metadata: readonly string[];
};

export function createSnapshotResult(
  document: Document,
  params: SnapshotParams,
  registry: ElementRefRegistry<Element>,
  now = Date.now(),
): SnapshotResult {
  const scope = resolveScope(document, params.selector);
  const entries: SnapshotEntry[] = [];
  const frames: SnapshotFrameDiagnostic[] = [];
  collectEntries(scope, params, entries, frames, 0);
  const generation = registry.createGeneration(
    entries.map((entry) => entry.element),
    now,
  );
  const compact = params.compact !== false;
  const bodyLines = entries.map((entry) =>
    formatEntry(entry, generation.refsByElement.get(entry.element), compact),
  );
  const baseText = [
    `title ${JSON.stringify(document.title || "(untitled)")}`,
    `url ${document.location.href}`,
    `generation ${generation.generationId}`,
    ...bodyLines,
  ].join("\n");
  const truncated = truncateText(baseText, params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);

  return {
    text: truncated.text,
    generationId: generation.generationId,
    refs: generation.refCount,
    truncated: truncated.truncated || generation.refCount < entries.length,
    frames,
  };
}

export function handleContentScriptRequest(
  request: RequestEnvelope,
  options: {
    readonly document: Document;
    readonly registry: ElementRefRegistry<Element>;
    readonly now?: number;
    readonly clock?: () => number;
    readonly sleep?: (durationMs: number) => Promise<void>;
  },
): ResponseEnvelope | Promise<ResponseEnvelope> {
  if (request.command === "snapshot") {
    try {
      return createOkResponse(
        request,
        createSnapshotResult(
          options.document,
          request.params as SnapshotParams,
          options.registry,
          options.now,
        ),
      );
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "ref.resolve") {
    try {
      const params = request.params as RefResolveParams;
      const resolved = options.registry.resolveRef(params.ref, {
        ...(params.generationId === undefined ? {} : { generationId: params.generationId }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
      return createOkResponse(request, {
        element: summarizeElement(resolved.element, {
          ref: params.ref,
          generationId: resolved.generationId,
        }),
      });
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "get") {
    try {
      return createOkResponse(
        request,
        createGetResult(
          options.document,
          request.params as GetParams,
          options.registry,
          options.now,
        ),
      );
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "is") {
    try {
      return createOkResponse(
        request,
        createIsResult(options.document, request.params as IsParams, options.registry, options.now),
      );
    } catch (error) {
      return createContentErrorResponse(request.id, error);
    }
  }

  if (request.command === "wait") {
    return createWaitResult({
      document: options.document,
      params: request.params as WaitParams,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      resolveRef: (ref, resolveOptions) =>
        options.registry.resolveRef(ref, {
          ...(resolveOptions.generationId === undefined
            ? {}
            : { generationId: resolveOptions.generationId }),
          now: resolveOptions.now,
        }),
      queryElement: (selector) => queryOptionalElement(options.document, selector),
      summarizeElement: summarizeWaitElement,
      isVisible,
      createError: (code, message) => new ContentSnapshotError(code, message),
    })
      .then((result) => createOkResponse(request, result))
      .catch((error: unknown) => createContentErrorResponse(request.id, error));
  }

  return createErrorResponse(request.id, {
    code: "UNSUPPORTED_CAPABILITY",
    message: `Unsupported content command: ${request.command}`,
  });
}

function createGetResult(
  document: Document,
  params: GetParams,
  registry: ElementRefRegistry<Element>,
  now = Date.now(),
): GetResult {
  if (params.kind === "title") {
    return { kind: params.kind, value: document.title };
  }

  if (params.kind === "url") {
    return { kind: params.kind, value: document.location.href };
  }

  const resolution = resolveElementForContentCommand(document, params, registry, now);
  const base = {
    ...(resolution.ref === undefined || resolution.generationId === undefined
      ? {}
      : {
          element: summarizeElement(resolution.element, {
            ref: resolution.ref,
            generationId: resolution.generationId,
          }),
        }),
  };

  switch (params.kind) {
    case "text": {
      const truncated = truncateText(
        collapseWhitespace(resolution.element.textContent ?? ""),
        params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      );
      return { ...base, kind: params.kind, value: truncated.text, truncated: truncated.truncated };
    }
    case "html": {
      const truncated = truncateText(
        resolution.element.outerHTML,
        params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      );
      return { ...base, kind: params.kind, value: truncated.text, truncated: truncated.truncated };
    }
    case "value":
      return { ...base, kind: params.kind, value: getElementValue(resolution.element) ?? null };
    case "attr":
      return {
        ...base,
        kind: params.kind,
        value: resolution.element.getAttribute(params.attribute ?? "") ?? null,
      };
    case "count":
      return {
        ...base,
        kind: params.kind,
        value:
          params.selector === undefined ? 1 : queryAllElements(document, params.selector).length,
      };
    case "box":
      return {
        ...base,
        kind: params.kind,
        value: boxValue(resolution.element.getBoundingClientRect()),
      };
    case "styles":
      return { ...base, kind: params.kind, value: styleValue(resolution.element) };
  }
}

function createIsResult(
  document: Document,
  params: IsParams,
  registry: ElementRefRegistry<Element>,
  now = Date.now(),
): IsResult {
  const resolution = resolveElementForContentCommand(document, params, registry, now);
  const base = {
    ...(resolution.ref === undefined || resolution.generationId === undefined
      ? {}
      : {
          element: summarizeElement(resolution.element, {
            ref: resolution.ref,
            generationId: resolution.generationId,
          }),
        }),
  };

  switch (params.kind) {
    case "visible":
      return { ...base, kind: params.kind, value: isVisible(resolution.element) };
    case "enabled":
      return { ...base, kind: params.kind, value: !isDisabled(resolution.element) };
    case "checked": {
      const checked = getElementChecked(resolution.element);
      if (checked === undefined) {
        throw new ContentSnapshotError(
          "UNSUPPORTED_CAPABILITY",
          "Checked state is available only for checkable elements.",
        );
      }
      return { ...base, kind: params.kind, value: checked };
    }
  }
}

function resolveElementForContentCommand(
  document: Document,
  params: {
    readonly selector?: string | undefined;
    readonly ref?: string | undefined;
    readonly generationId?: string | undefined;
  },
  registry: ElementRefRegistry<Element>,
  now: number,
): { readonly element: Element; readonly ref?: string; readonly generationId?: string } {
  if (params.ref !== undefined) {
    const resolved = registry.resolveRef(params.ref, {
      ...(params.generationId === undefined ? {} : { generationId: params.generationId }),
      now,
    });
    return { element: resolved.element, ref: params.ref, generationId: resolved.generationId };
  }

  const selector = params.selector;
  if (selector === undefined) {
    throw new ContentSnapshotError("SELECTOR_NOT_FOUND", "Element selector is required.");
  }

  const element = querySingleElement(document, selector);
  return { element };
}

function querySingleElement(document: Document, selector: string): Element {
  const element = queryOptionalElement(document, selector);
  if (element === null) {
    throw new ContentSnapshotError("SELECTOR_NOT_FOUND", `Selector not found: ${selector}`);
  }

  return element;
}

function queryOptionalElement(document: Document, selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch (error) {
    throw new ContentSnapshotError(
      "SELECTOR_NOT_FOUND",
      `Selector is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function queryAllElements(document: Document, selector: string): readonly Element[] {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch (error) {
    throw new ContentSnapshotError(
      "SELECTOR_NOT_FOUND",
      `Selector is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function boxValue(rect: DOMRect): GetBoxValue {
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

function styleValue(element: Element): GetStylesValue {
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

function createContentErrorResponse(id: string, error: unknown): ResponseEnvelope {
  return createErrorResponse(id, {
    code:
      error instanceof ContentSnapshotError || error instanceof ElementRefRegistryError
        ? error.code
        : "SCRIPT_INJECTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  });
}

function summarizeElement(
  element: Element,
  options: { readonly ref: string; readonly generationId: string },
): ElementSummary {
  return {
    ref: options.ref,
    generationId: options.generationId,
    ...summarizeElementBase(element),
  };
}

function summarizeWaitElement(
  element: Element,
  options?: { readonly ref: string; readonly generationId: string },
): WaitElementSummary {
  return {
    ...(options === undefined
      ? {}
      : {
          ref: options.ref,
          generationId: options.generationId,
        }),
    ...summarizeElementBase(element),
  };
}

function summarizeElementBase(element: Element): Omit<ElementSummary, "ref" | "generationId"> {
  const text = collapseWhitespace(element.textContent ?? "").slice(0, 500);
  const value = getElementValue(element);
  const href = element.getAttribute("href");
  const disabled = isDisabled(element);
  const checked = getElementChecked(element);
  const name = getAccessibleName(element);

  return {
    tagName: element.localName,
    role: getRole(element),
    visible: isVisible(element),
    ...(name === undefined ? {} : { name }),
    ...(text.length === 0 ? {} : { text }),
    ...(value === undefined ? {} : { value }),
    ...(href === null ? {} : { href }),
    ...(disabled ? { disabled } : {}),
    ...(checked === undefined ? {} : { checked }),
  };
}

function getElementValue(element: Element): string | undefined {
  if (["input", "textarea", "select"].includes(element.localName) && "value" in element) {
    const value = element.value;
    return typeof value === "string" ? value : undefined;
  }

  return undefined;
}

function getElementChecked(element: Element): boolean | undefined {
  if (element.localName === "input" && "type" in element && "checked" in element) {
    const type = element.type;
    const checked = element.checked;
    return typeof type === "string" &&
      typeof checked === "boolean" &&
      ["checkbox", "radio"].includes(type)
      ? checked
      : undefined;
  }

  const ariaChecked = element.getAttribute("aria-checked");
  const role = element.getAttribute("role");
  const supportsAriaChecked =
    role === "checkbox" ||
    role === "menuitemcheckbox" ||
    role === "menuitemradio" ||
    role === "radio" ||
    role === "switch";
  if (!supportsAriaChecked) {
    return undefined;
  }

  if (ariaChecked === "true") {
    return true;
  }
  if (ariaChecked === "false") {
    return false;
  }

  return undefined;
}

function isDisabled(element: Element): boolean {
  if (element.getAttribute("aria-disabled") === "true") {
    return true;
  }

  try {
    return element.matches(":disabled");
  } catch {
    return isNativelyDisabledFallback(element);
  }
}

function isNativelyDisabledFallback(element: Element): boolean {
  if (
    !["button", "fieldset", "input", "optgroup", "option", "select", "textarea"].includes(
      element.localName,
    )
  ) {
    return false;
  }

  if (element.hasAttribute("disabled")) {
    return true;
  }

  if (element.localName === "option" && element.closest("optgroup[disabled]") !== null) {
    return true;
  }

  const disabledFieldset = element.closest("fieldset[disabled]");
  return disabledFieldset === null ? false : !isDescendantOfFirstLegend(element, disabledFieldset);
}

function isDescendantOfFirstLegend(element: Element, fieldset: Element): boolean {
  const firstLegend = Array.from(fieldset.children).find((child) => child.localName === "legend");
  return firstLegend === undefined ? false : firstLegend.contains(element);
}

function resolveScope(document: Document, selector: string | undefined): Element {
  if (selector === undefined) {
    const root = document.body ?? document.documentElement;
    if (root === null) {
      throw new ContentSnapshotError("SCRIPT_INJECTION_FAILED", "Document has no snapshot root.");
    }
    return root;
  }

  const selected = document.querySelector(selector);
  if (selected === null) {
    throw new ContentSnapshotError("SELECTOR_NOT_FOUND", `Selector not found: ${selector}`);
  }

  return selected;
}

function collectEntries(
  element: Element,
  params: SnapshotParams,
  entries: SnapshotEntry[],
  frames: SnapshotFrameDiagnostic[],
  depth: number,
): void {
  const maxDepth = params.maxDepth ?? 8;
  if (depth > maxDepth || !isVisible(element)) {
    return;
  }

  const role = getRole(element);
  const name = getAccessibleName(element);
  const interactive = isInteractive(element, role);
  const include = params.interactiveOnly === true ? interactive : isSemantic(element, role, name);
  if (include) {
    entries.push({
      element,
      depth,
      role,
      ...(name === undefined ? {} : { name }),
      metadata: getMetadata(element, role),
    });
  }

  if (element.localName === "iframe") {
    frames.push({
      selector: describeFrame(element),
      ...(element.getAttribute("title") === null
        ? {}
        : { title: element.getAttribute("title") ?? "" }),
      ...(element.getAttribute("src") === null ? {} : { url: element.getAttribute("src") ?? "" }),
      unsupported: true,
      reason: "Iframe refs are prototype-gated.",
    });
    return;
  }

  for (const child of Array.from(element.children)) {
    collectEntries(child, params, entries, frames, depth + 1);
  }
}

function formatEntry(entry: SnapshotEntry, ref: string | undefined, compact: boolean): string {
  const prefix = "  ".repeat(entry.depth);
  if (compact) {
    const name = entry.name === undefined ? "" : ` ${JSON.stringify(entry.name)}`;
    const metadata = entry.metadata.length === 0 ? "" : ` ${entry.metadata.join(" ")}`;
    return `${prefix}${ref ?? "-"} ${entry.role}${name}${metadata}`;
  }

  const fields = [
    `ref=${ref ?? "-"}`,
    `role=${entry.role}`,
    `tag=${entry.element.localName}`,
    ...(entry.name === undefined ? [] : [`name=${JSON.stringify(entry.name)}`]),
    ...entry.metadata,
  ];
  return `${prefix}${fields.join(" ")}`;
}

function getRole(element: Element): string {
  const explicit = element.getAttribute("role");
  if (explicit !== null && explicit.length > 0) {
    return explicit;
  }

  switch (element.localName) {
    case "a":
      return element.hasAttribute("href") ? "link" : "generic";
    case "button":
      return "button";
    case "textarea":
      return "textbox";
    case "select":
      return "combobox";
    case "input":
      return inputRole(element.getAttribute("type"));
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "img":
      return "img";
    case "iframe":
      return "iframe";
    case "main":
      return "main";
    case "nav":
      return "navigation";
    case "form":
      return "form";
    case "label":
      return "label";
    default:
      return isScrollableContainer(element) ? "region" : "generic";
  }
}

function inputRole(type: string | null): string {
  switch ((type ?? "text").toLowerCase()) {
    case "button":
    case "submit":
    case "reset":
      return "button";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "range":
      return "slider";
    default:
      return "textbox";
  }
}

function getAccessibleName(element: Element): string | undefined {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) {
    return collapseWhitespace(ariaLabel);
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText =
    labelledBy
      ?.split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ") ?? "";
  if (labelledText.trim().length > 0) {
    return collapseWhitespace(labelledText);
  }

  const id = element.getAttribute("id");
  const label =
    id === null ? null : element.ownerDocument.querySelector(`label[for="${escapeCssString(id)}"]`);
  if (label?.textContent !== undefined && label.textContent.trim().length > 0) {
    return collapseWhitespace(label.textContent);
  }

  const wrappingLabel = element.closest("label");
  if (wrappingLabel?.textContent !== undefined && wrappingLabel.textContent.trim().length > 0) {
    return collapseWhitespace(wrappingLabel.textContent);
  }

  for (const attribute of ["alt", "title", "placeholder", "value"]) {
    const value = element.getAttribute(attribute);
    if (value !== null && value.trim().length > 0) {
      return collapseWhitespace(value);
    }
  }

  const text = element.textContent ?? "";
  return text.trim().length === 0 ? undefined : collapseWhitespace(text).slice(0, 160);
}

function getMetadata(element: Element, role: string): readonly string[] {
  const metadata: string[] = [];
  if (isScrollableContainer(element)) {
    metadata.push("scrollable=true");
  }

  if (element.localName.match(/^h[1-6]$/u)) {
    metadata.push(`level=${element.localName.slice(1)}`);
  }

  const type = element.getAttribute("type");
  if (type !== null && element.localName === "input") {
    metadata.push(`type=${type}`);
  }

  const href = element.getAttribute("href");
  if (href !== null && role === "link") {
    metadata.push(`href=${JSON.stringify(href)}`);
  }

  for (const [attribute, label] of [
    ["aria-checked", "checked"],
    ["aria-selected", "selected"],
    ["aria-disabled", "disabled"],
  ] as const) {
    const value = element.getAttribute(attribute);
    if (value !== null) {
      metadata.push(`${label}=${value}`);
    }
  }

  if ((element as HTMLInputElement).checked === true) {
    metadata.push("checked=true");
  }
  if ((element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled === true) {
    metadata.push("disabled=true");
  }
  if (element.hasAttribute("required")) {
    metadata.push("required=true");
  }
  if (element.hasAttribute("contenteditable")) {
    metadata.push("contenteditable=true");
  }

  return metadata;
}

function isInteractive(element: Element, role: string): boolean {
  if (isDisabled(element)) {
    return false;
  }

  if (isScrollableContainer(element)) {
    return true;
  }

  if (
    ["button", "link", "textbox", "checkbox", "radio", "combobox", "slider", "switch"].includes(
      role,
    )
  ) {
    return true;
  }

  const tabindex = element.getAttribute("tabindex");
  return (
    element.hasAttribute("contenteditable") ||
    (tabindex !== null && tabindex !== "-1") ||
    element.getAttribute("role") === "menuitem" ||
    element.getAttribute("role") === "tab"
  );
}

function isSemantic(element: Element, role: string, name: string | undefined): boolean {
  return (
    isInteractive(element, role) ||
    role !== "generic" ||
    (name !== undefined && ["p", "li", "summary"].includes(element.localName))
  );
}

function isVisible(element: Element): boolean {
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    if (isSelfHidden(current)) {
      return false;
    }
  }

  return true;
}

function isSelfHidden(element: Element): boolean {
  if (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    (element.localName === "input" && element.getAttribute("type") === "hidden")
  ) {
    return true;
  }

  const styleAttribute = element.getAttribute("style")?.toLowerCase() ?? "";
  if (styleAttribute.includes("display: none") || styleAttribute.includes("visibility: hidden")) {
    return true;
  }

  const view = element.ownerDocument.defaultView;
  if (view !== null) {
    const style = view.getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden";
  }

  return false;
}

function isScrollableContainer(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  const style =
    view === null
      ? (element.getAttribute("style")?.toLowerCase() ?? "")
      : view.getComputedStyle(element);
  const overflowX =
    typeof style === "string" ? readInlineStyle(style, "overflow-x") : style.overflowX;
  const overflowY =
    typeof style === "string" ? readInlineStyle(style, "overflow-y") : style.overflowY;
  const overflow = typeof style === "string" ? readInlineStyle(style, "overflow") : style.overflow;
  const canScroll =
    [overflowX, overflowY, overflow].some((value) => value === "auto" || value === "scroll") ||
    false;
  return (
    canScroll &&
    (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
  );
}

function readInlineStyle(style: string, property: string): string | undefined {
  return style
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${property}:`))
    ?.slice(property.length + 1)
    .trim();
}

function describeFrame(element: Element): string {
  const id = element.getAttribute("id");
  if (id !== null && id.length > 0) {
    return `iframe#${id}`;
  }

  const name = element.getAttribute("name");
  if (name !== null && name.length > 0) {
    return `iframe[name="${escapeCssString(name)}"]`;
  }

  const siblings: Element[] = Array.from(element.ownerDocument.querySelectorAll("iframe"));
  return `iframe:nth-of-type(${siblings.indexOf(element) + 1})`;
}

function truncateText(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) {
    return { text, truncated: false };
  }

  const marker = "[truncated]";
  if (encoder.encode(marker).length > maxBytes) {
    return { text: truncateToByteLimit(marker, maxBytes), truncated: true };
  }

  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const candidate = [...lines, line, marker].join("\n");
    if (encoder.encode(candidate).length > maxBytes) {
      break;
    }
    lines.push(line);
  }

  return {
    text: [...lines, marker].join("\n"),
    truncated: true,
  };
}

function truncateToByteLimit(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let truncated = "";
  for (const char of text) {
    const candidate = `${truncated}${char}`;
    if (encoder.encode(candidate).length > maxBytes) {
      break;
    }
    truncated = candidate;
  }
  return truncated;
}

function escapeCssString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export class ContentSnapshotError extends Error {
  readonly code: Extract<
    ErrorCode,
    | "SCRIPT_INJECTION_FAILED"
    | "SELECTOR_NOT_FOUND"
    | "REF_NOT_FOUND"
    | "OUTPUT_TOO_LARGE"
    | "UNSUPPORTED_CAPABILITY"
    | "TIMEOUT"
  >;

  constructor(code: ContentSnapshotError["code"], message: string) {
    super(message);
    this.name = "ContentSnapshotError";
    this.code = code;
  }
}
