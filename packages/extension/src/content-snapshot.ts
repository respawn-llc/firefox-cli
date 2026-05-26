import {
  createErrorResponse,
  createOkResponse,
  type ErrorCode,
  type RequestEnvelope,
  type ResponseEnvelope,
  type SnapshotFrameDiagnostic,
  type SnapshotParams,
  type SnapshotResult,
} from "@firefox-cli/protocol";

const DEFAULT_REF_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_GENERATIONS = 5;
const DEFAULT_MAX_REFS = 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 60_000;

type SnapshotEntry = {
  readonly element: Element;
  readonly depth: number;
  readonly role: string;
  readonly name?: string;
  readonly metadata: readonly string[];
};

type SnapshotGeneration<TElement> = {
  readonly id: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly refs: ReadonlyMap<string, TElement>;
};

export class ElementRefRegistry<TElement> {
  readonly #ttlMs: number;
  readonly #maxGenerations: number;
  readonly #maxRefs: number;
  #counter = 0;
  #latestGenerationId: string | undefined;
  readonly #generations = new Map<string, SnapshotGeneration<TElement>>();

  constructor(
    options: {
      readonly ttlMs?: number;
      readonly maxGenerations?: number;
      readonly maxRefs?: number;
    } = {},
  ) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_REF_TTL_MS;
    this.#maxGenerations = options.maxGenerations ?? DEFAULT_MAX_GENERATIONS;
    this.#maxRefs = options.maxRefs ?? DEFAULT_MAX_REFS;
  }

  createGeneration(
    elements: readonly TElement[],
    now = Date.now(),
  ): {
    readonly generationId: string;
    readonly refsByElement: ReadonlyMap<TElement, string>;
    readonly refCount: number;
  } {
    this.#prune(now);
    this.#counter += 1;
    const generationId = `g${now.toString(36)}-${this.#counter.toString(36)}`;
    const refs = new Map<string, TElement>();
    const refsByElement = new Map<TElement, string>();
    for (const [index, element] of elements.slice(0, this.#maxRefs).entries()) {
      const ref = `@e${index + 1}`;
      refs.set(ref, element);
      refsByElement.set(element, ref);
    }

    this.#generations.set(generationId, {
      id: generationId,
      createdAt: now,
      expiresAt: now + this.#ttlMs,
      refs,
    });
    this.#latestGenerationId = generationId;
    this.#trimGenerations();
    return { generationId, refsByElement, refCount: refs.size };
  }

  resolve(
    ref: string,
    options: { readonly generationId?: string; readonly now?: number } = {},
  ): TElement {
    const now = options.now ?? Date.now();
    this.#prune(now);
    const generationId = options.generationId ?? this.#latestGenerationId;
    const generation = generationId === undefined ? undefined : this.#generations.get(generationId);
    const element = generation?.refs.get(ref);
    if (element === undefined) {
      throw new ContentSnapshotError(
        "REF_NOT_FOUND",
        "Element ref is stale or unknown. Run `firefox-cli snapshot -i` again.",
      );
    }

    return element;
  }

  invalidate(): void {
    this.#latestGenerationId = undefined;
    this.#generations.clear();
  }

  #prune(now: number): void {
    for (const generation of this.#generations.values()) {
      if (generation.expiresAt <= now) {
        this.#generations.delete(generation.id);
      }
    }

    if (
      this.#latestGenerationId !== undefined &&
      !this.#generations.has(this.#latestGenerationId)
    ) {
      this.#latestGenerationId = [...this.#generations.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .at(0)?.id;
    }
  }

  #trimGenerations(): void {
    const ordered = [...this.#generations.values()].sort((a, b) => b.createdAt - a.createdAt);
    for (const generation of ordered.slice(this.#maxGenerations)) {
      this.#generations.delete(generation.id);
    }
  }
}

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
  },
): ResponseEnvelope {
  if (request.command !== "snapshot") {
    return createErrorResponse(request.id, {
      code: "UNSUPPORTED_CAPABILITY",
      message: `Unsupported content command: ${request.command}`,
    });
  }

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
    return createErrorResponse(request.id, {
      code: error instanceof ContentSnapshotError ? error.code : "SCRIPT_INJECTION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
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
      return "generic";
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
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
    return false;
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
  if (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    (element.localName === "input" && element.getAttribute("type") === "hidden")
  ) {
    return false;
  }

  const styleAttribute = element.getAttribute("style")?.toLowerCase() ?? "";
  if (styleAttribute.includes("display: none") || styleAttribute.includes("visibility: hidden")) {
    return false;
  }

  const view = element.ownerDocument.defaultView;
  if (view !== null) {
    const style = view.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  return true;
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

  const marker = "\n[truncated]";
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const candidate = [...lines, line, marker].join("\n");
    if (encoder.encode(candidate).length > maxBytes) {
      break;
    }
    lines.push(line);
  }

  return {
    text: [...lines, marker.trimStart()].join("\n"),
    truncated: true,
  };
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
    "SCRIPT_INJECTION_FAILED" | "SELECTOR_NOT_FOUND" | "REF_NOT_FOUND" | "OUTPUT_TOO_LARGE"
  >;

  constructor(code: ContentSnapshotError["code"], message: string) {
    super(message);
    this.name = "ContentSnapshotError";
    this.code = code;
  }
}
