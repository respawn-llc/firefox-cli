import type { ElementRefRegistry } from "../element-ref-registry.js";
import { ContentSnapshotError } from "./errors.js";

export function resolveScope(document: Document, selector: string | undefined): Element {
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

export function resolveElement(
  document: Document,
  params: { readonly selector?: string; readonly ref?: string; readonly generationId?: string },
  registry: ElementRefRegistry<Element>,
  now = Date.now(),
): Element {
  if (params.ref !== undefined) {
    return registry.resolveRef(params.ref, {
      ...(params.generationId === undefined ? {} : { generationId: params.generationId }),
      now,
    }).element;
  }
  if (params.selector === undefined) {
    throw new ContentSnapshotError("SELECTOR_NOT_FOUND", "Selector or ref is required.");
  }
  const element = queryOptionalElement(document, params.selector);
  if (element === null) {
    throw new ContentSnapshotError("SELECTOR_NOT_FOUND", `Selector not found: ${params.selector}`);
  }
  return element;
}

export function resolveElementForContentCommand(
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

export function querySingleElement(document: Document, selector: string): Element {
  const element = queryOptionalElement(document, selector);
  if (element === null) {
    throw new ContentSnapshotError("SELECTOR_NOT_FOUND", `Selector not found: ${selector}`);
  }

  return element;
}

export function queryOptionalElement(document: Document, selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch (error) {
    throw new ContentSnapshotError(
      "SELECTOR_NOT_FOUND",
      `Selector is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function queryAllElements(document: Document, selector: string): readonly Element[] {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch (error) {
    throw new ContentSnapshotError(
      "SELECTOR_NOT_FOUND",
      `Selector is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
