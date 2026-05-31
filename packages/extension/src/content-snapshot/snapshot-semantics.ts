import type { ElementSummary, WaitElementSummary } from "@firefox-cli/protocol";
import { collapseWhitespace, escapeCssString } from "./format.js";

const SIMPLE_CSS_IDENTIFIER = /^-?[A-Za-z_][A-Za-z0-9_-]*$/u;

export type SnapshotSemantics = {
  readonly summarizeElement: (
    element: Element,
    options: { readonly ref: string; readonly generationId: string },
  ) => ElementSummary;
  readonly summarizeWaitElement: (
    element: Element,
    options?: { readonly ref: string; readonly generationId: string },
  ) => WaitElementSummary;
  readonly getElementValue: (element: Element) => string | undefined;
  readonly getElementChecked: (element: Element) => boolean | undefined;
  readonly isDisabled: (element: Element) => boolean;
  readonly getRole: (element: Element) => string;
  readonly getAccessibleName: (element: Element) => string | undefined;
  readonly getMetadata: (element: Element, role: string) => readonly string[];
  readonly isInteractive: (element: Element, role: string) => boolean;
  readonly isSemantic: (element: Element, role: string, name: string | undefined) => boolean;
  readonly isVisible: (element: Element) => boolean;
  readonly isScrollableContainer: (element: Element) => boolean;
  readonly describeFrame: (element: Element) => string;
  readonly findLabelText: (element: Element) => string;
};

/*
 * Snapshot semantics intentionally implement a product subset instead of a full
 * accessibility tree. The supported subset is kept in one adapter so snapshot,
 * find, wait, and action paths agree on these DOM facts:
 *
 * - Roles: explicit role, common native controls/landmarks/headings/images/iframes,
 *   input type roles, and scrollable generic regions.
 * - Names: aria-label, aria-labelledby, native labels, wrapping labels,
 *   alt/title/placeholder/value, then text fallback.
 * - Hidden: hidden, aria-hidden=true, hidden inputs, CSS display/visibility, and
 *   hidden ancestors.
 * - Disabled: aria-disabled=true plus native :disabled/fallback behavior for
 *   disabled form controls, fieldset first-legend exemption, and disabled optgroups.
 * - Scrollability: computed or inline overflow with actual scroll extent.
 * - Frames: diagnostic selectors only; iframe refs remain unsupported.
 */
export const defaultSnapshotSemantics: SnapshotSemantics = {
  summarizeElement,
  summarizeWaitElement,
  getElementValue,
  getElementChecked,
  isDisabled,
  getRole,
  getAccessibleName,
  getMetadata,
  isInteractive,
  isSemantic,
  isVisible,
  isScrollableContainer,
  describeFrame,
  findLabelText,
};

export function summarizeElement(
  element: Element,
  options: { readonly ref: string; readonly generationId: string },
): ElementSummary {
  return {
    ref: options.ref,
    generationId: options.generationId,
    ...summarizeElementBase(element),
  };
}

export function summarizeWaitElement(
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

export function getElementValue(element: Element): string | undefined {
  if (["input", "textarea", "select"].includes(element.localName) && "value" in element) {
    const value = element.value;
    return typeof value === "string" ? value : undefined;
  }

  return undefined;
}

export function getElementChecked(element: Element): boolean | undefined {
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

export function isDisabled(element: Element): boolean {
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

export function getRole(element: Element): string {
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

export function getAccessibleName(element: Element): string | undefined {
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

  const explicitLabelText = getExplicitLabelText(element);
  if (explicitLabelText !== undefined) {
    return explicitLabelText;
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

function getExplicitLabelText(element: Element): string | undefined {
  const id = element.getAttribute("id");
  if (id === null) {
    return undefined;
  }

  const label = Array.from(element.ownerDocument.getElementsByTagName("label")).find(
    (candidate) =>
      candidate.getAttribute("for") === id &&
      candidate.textContent !== null &&
      candidate.textContent.trim().length > 0,
  );
  return label === undefined ? undefined : collapseWhitespace(label.textContent ?? "");
}

export function getMetadata(element: Element, role: string): readonly string[] {
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

export function isInteractive(element: Element, role: string): boolean {
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

export function isSemantic(element: Element, role: string, name: string | undefined): boolean {
  return (
    isInteractive(element, role) ||
    role !== "generic" ||
    (name !== undefined && ["p", "li", "summary"].includes(element.localName))
  );
}

export function isVisible(element: Element): boolean {
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

export function isScrollableContainer(element: Element): boolean {
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

export function describeFrame(element: Element): string {
  const id = element.getAttribute("id");
  if (id !== null && id.length > 0) {
    return SIMPLE_CSS_IDENTIFIER.test(id) ? `iframe#${id}` : `iframe[id="${escapeCssString(id)}"]`;
  }

  const name = element.getAttribute("name");
  if (name !== null && name.length > 0) {
    return `iframe[name="${escapeCssString(name)}"]`;
  }

  const siblings: Element[] = Array.from(element.ownerDocument.querySelectorAll("iframe"));
  return `iframe:nth-of-type(${siblings.indexOf(element) + 1})`;
}

export function findLabelText(element: Element): string {
  if (element.localName === "label") {
    return "";
  }
  const view = element.ownerDocument.defaultView;
  if (view !== null && element instanceof view.HTMLInputElement && element.labels !== null) {
    return Array.from(element.labels)
      .map((label) => label.textContent ?? "")
      .join(" ");
  }
  return element.closest("label")?.textContent ?? "";
}
