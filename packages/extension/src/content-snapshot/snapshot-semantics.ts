import type { ElementSummary, WaitElementSummary } from "@firefox-cli/protocol";
import { collapseWhitespace, escapeCssString } from "./format.js";

const SIMPLE_CSS_IDENTIFIER = /^-?[A-Za-z_][A-Za-z0-9_-]*$/u;
const CHECKED_ARIA_ROLES = ["checkbox", "menuitemcheckbox", "menuitemradio", "radio", "switch"];
const DISABLED_FALLBACK_TAGS = ["button", "fieldset", "input", "optgroup", "option", "select", "textarea"];
const INTERACTIVE_ROLES = ["button", "link", "textbox", "checkbox", "radio", "combobox", "slider", "switch"];
const TEXT_NAMING_ATTRIBUTES = ["alt", "title", "placeholder", "value"];
const NATIVE_ROLES = new Map([
  ["button", "button"],
  ["textarea", "textbox"],
  ["select", "combobox"],
  ["img", "img"],
  ["iframe", "iframe"],
  ["main", "main"],
  ["nav", "navigation"],
  ["form", "form"],
  ["label", "label"],
]);
const METADATA_ATTRIBUTES = [
  ["aria-checked", "checked"],
  ["aria-selected", "selected"],
  ["aria-disabled", "disabled"],
] as const;

export interface SnapshotSemantics {
  readonly summarizeElement: (element: Element, options: ElementRefOptions) => ElementSummary;
  readonly summarizeWaitElement: (element: Element, options?: ElementRefOptions) => WaitElementSummary;
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
}

interface ElementRefOptions {
  readonly ref: string;
  readonly generationId: string;
}

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

export function summarizeElement(element: Element, options: ElementRefOptions): ElementSummary {
  return { ref: options.ref, generationId: options.generationId, ...summarizeElementBase(element) };
}

export function summarizeWaitElement(element: Element, options?: ElementRefOptions): WaitElementSummary {
  return { ...(options ?? {}), ...summarizeElementBase(element) };
}

function summarizeElementBase(element: Element): Omit<ElementSummary, "ref" | "generationId"> {
  const text = collapseWhitespace(element.textContent).slice(0, 500);
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
    return typeof element.value === "string" ? element.value : undefined;
  }
  return undefined;
}

export function getElementChecked(element: Element): boolean | undefined {
  return getNativeChecked(element) ?? getAriaChecked(element);
}

function getNativeChecked(element: Element): boolean | undefined {
  if (element.localName !== "input" || !("type" in element) || !("checked" in element)) {
    return undefined;
  }
  return typeof element.type === "string" && typeof element.checked === "boolean" && ["checkbox", "radio"].includes(element.type) ? element.checked : undefined;
}

function getAriaChecked(element: Element): boolean | undefined {
  const ariaChecked = element.getAttribute("aria-checked");
  const role = element.getAttribute("role");
  if (role === null || !CHECKED_ARIA_ROLES.includes(role)) {
    return undefined;
  }
  return ariaChecked === "true" ? true : ariaChecked === "false" ? false : undefined;
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
  if (!DISABLED_FALLBACK_TAGS.includes(element.localName)) {
    return false;
  }
  if (element.hasAttribute("disabled") || (element.localName === "option" && element.closest("optgroup[disabled]") !== null)) {
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
  if (element.localName === "a") {
    return element.hasAttribute("href") ? "link" : "generic";
  }
  if (element.localName === "input") {
    return inputRole(element.getAttribute("type"));
  }
  return nativeRole(element) ?? (isScrollableContainer(element) ? "region" : "generic");
}

function nativeRole(element: Element): string | undefined {
  return /^h[1-6]$/u.exec(element.localName) === null ? NATIVE_ROLES.get(element.localName) : "heading";
}

function inputRole(type: string | null): string {
  const normalized = (type ?? "text").toLowerCase();
  if (["button", "submit", "reset"].includes(normalized)) {
    return "button";
  }
  if (["checkbox", "radio"].includes(normalized)) {
    return normalized;
  }
  return normalized === "range" ? "slider" : "textbox";
}

export function getAccessibleName(element: Element): string | undefined {
  return getAriaName(element) ?? getExplicitLabelText(element) ?? getWrappingLabelText(element) ?? getAttributeName(element) ?? getTextName(element);
}

function getAriaName(element: Element): string | undefined {
  const ariaLabel = getNonEmptyAttribute(element, "aria-label");
  if (ariaLabel !== undefined) {
    return ariaLabel;
  }
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText = labelledBy === null ? "" : labelledBy.split(/\s+/).map(labelledByText(element)).join(" ");
  return labelledText.trim().length === 0 ? undefined : collapseWhitespace(labelledText);
}

function labelledByText(element: Element): (id: string) => string {
  return (id) => element.ownerDocument.getElementById(id)?.textContent ?? "";
}

function getExplicitLabelText(element: Element): string | undefined {
  const id = element.getAttribute("id");
  if (id === null) {
    return undefined;
  }
  const label = Array.from(element.ownerDocument.getElementsByTagName("label")).find(
    (candidate) => candidate.getAttribute("for") === id && candidate.textContent.trim().length > 0,
  );
  return label === undefined ? undefined : collapseWhitespace(label.textContent);
}

function getWrappingLabelText(element: Element): string | undefined {
  const labelText = element.closest("label")?.textContent;
  return labelText === undefined || labelText.trim().length === 0 ? undefined : collapseWhitespace(labelText);
}

function getAttributeName(element: Element): string | undefined {
  return TEXT_NAMING_ATTRIBUTES.map((attribute) => getNonEmptyAttribute(element, attribute)).find(isPresent);
}

function getNonEmptyAttribute(element: Element, attribute: string): string | undefined {
  const value = element.getAttribute(attribute);
  return value === null || value.trim().length === 0 ? undefined : collapseWhitespace(value);
}

function getTextName(element: Element): string | undefined {
  const text = element.textContent;
  return text.trim().length === 0 ? undefined : collapseWhitespace(text).slice(0, 160);
}

export function getMetadata(element: Element, role: string): readonly string[] {
  const metadata: string[] = [];
  appendMetadata(metadata, isScrollableContainer(element), "scrollable=true");
  appendMetadata(metadata, /^h[1-6]$/u.exec(element.localName) !== null, `level=${element.localName.slice(1)}`);
  const type = element.getAttribute("type");
  appendMetadata(metadata, type !== null && element.localName === "input", `type=${type ?? ""}`);
  const href = element.getAttribute("href");
  appendMetadata(metadata, href !== null && role === "link", `href=${JSON.stringify(href)}`);
  for (const [attribute, label] of METADATA_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    appendMetadata(metadata, value !== null, `${label}=${value ?? ""}`);
  }
  appendMetadata(metadata, "checked" in element && element.checked === true, "checked=true");
  appendMetadata(metadata, "disabled" in element && element.disabled === true, "disabled=true");
  appendMetadata(metadata, element.hasAttribute("required"), "required=true");
  appendMetadata(metadata, element.hasAttribute("contenteditable"), "contenteditable=true");
  return metadata;
}

function appendMetadata(metadata: string[], shouldAppend: boolean, value: string): void {
  if (shouldAppend) {
    metadata.push(value);
  }
}

export function isInteractive(element: Element, role: string): boolean {
  if (isDisabled(element)) {
    return false;
  }
  if (isScrollableContainer(element) || INTERACTIVE_ROLES.includes(role)) {
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
  return isInteractive(element, role) || role !== "generic" || (name !== undefined && ["p", "li", "summary"].includes(element.localName));
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
  const style = view === null ? (element.getAttribute("style")?.toLowerCase() ?? "") : view.getComputedStyle(element);
  const overflowX = typeof style === "string" ? readInlineStyle(style, "overflow-x") : style.overflowX;
  const overflowY = typeof style === "string" ? readInlineStyle(style, "overflow-y") : style.overflowY;
  const overflow = typeof style === "string" ? readInlineStyle(style, "overflow") : style.overflow;
  const canScroll = [overflowX, overflowY, overflow].some((value) => value === "auto" || value === "scroll");
  return canScroll && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);
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
  const siblings = Array.from<Element>(element.ownerDocument.querySelectorAll("iframe"));
  return `iframe:nth-of-type(${String(siblings.indexOf(element) + 1)})`;
}

export function findLabelText(element: Element): string {
  if (element.localName === "label") {
    return "";
  }
  const view = element.ownerDocument.defaultView;
  if (view !== null && element instanceof view.HTMLInputElement && element.labels !== null) {
    return Array.from(element.labels)
      .map((label) => label.textContent)
      .join(" ");
  }
  return element.closest("label")?.textContent ?? "";
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
