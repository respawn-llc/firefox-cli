import type { SnapshotFrameDiagnostic, SnapshotParams, SnapshotResult } from "@firefox-cli/protocol";
import type { ElementRefRegistry } from "../element-ref-registry.js";
import { defaultSnapshotSemantics, type SnapshotSemantics } from "./snapshot-semantics.js";
import { resolveScope } from "./dom.js";
import { DEFAULT_MAX_OUTPUT_BYTES, truncateText } from "./format.js";

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
  semantics: SnapshotSemantics = defaultSnapshotSemantics,
): SnapshotResult {
  const scope = resolveScope(document, params.selector);
  const entries: SnapshotEntry[] = [];
  const frames: SnapshotFrameDiagnostic[] = [];
  collectEntries(scope, params, entries, frames, 0, semantics);
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

function collectEntries(
  element: Element,
  params: SnapshotParams,
  entries: SnapshotEntry[],
  frames: SnapshotFrameDiagnostic[],
  depth: number,
  semantics: SnapshotSemantics,
): void {
  const maxDepth = params.maxDepth ?? 8;
  if (depth > maxDepth || !semantics.isVisible(element)) {
    return;
  }

  const role = semantics.getRole(element);
  const name = semantics.getAccessibleName(element);
  const interactive = semantics.isInteractive(element, role);
  const include = params.interactiveOnly === true ? interactive : semantics.isSemantic(element, role, name);
  if (include) {
    entries.push({
      element,
      depth,
      role,
      ...(name === undefined ? {} : { name }),
      metadata: semantics.getMetadata(element, role),
    });
  }

  if (element.localName === "iframe") {
    frames.push({
      selector: semantics.describeFrame(element),
      ...(element.getAttribute("title") === null ? {} : { title: element.getAttribute("title") ?? "" }),
      ...(element.getAttribute("src") === null ? {} : { url: element.getAttribute("src") ?? "" }),
      unsupported: true,
      reason: "Iframe refs are prototype-gated.",
    });
    return;
  }

  for (const child of Array.from(element.children)) {
    collectEntries(child, params, entries, frames, depth + 1, semantics);
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
