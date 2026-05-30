import type { ElementRefRegistry } from "../element-ref-registry.js";
import { createContentElementResolver } from "./element-resolver.js";

export function resolveScope(document: Document, selector: string | undefined): Element {
  return createContentElementResolver({
    document,
    registry: createSelectorOnlyRegistry(),
  }).resolveScope(selector);
}

export function resolveElement(
  document: Document,
  params: { readonly selector?: string; readonly ref?: string; readonly generationId?: string },
  registry: ElementRefRegistry<Element>,
  now = Date.now(),
): Element {
  return createContentElementResolver({ document, registry, now }).resolveRequiredTarget(params, {
    missingMessage: "Selector or ref is required.",
  }).element;
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
  return createContentElementResolver({ document, registry, now }).resolveContentCommandTarget(
    params,
  );
}

export function querySingleElement(document: Document, selector: string): Element {
  return createContentElementResolver({
    document,
    registry: createSelectorOnlyRegistry(),
  }).querySingle(selector);
}

export function queryOptionalElement(document: Document, selector: string): Element | null {
  return createContentElementResolver({
    document,
    registry: createSelectorOnlyRegistry(),
  }).queryOptional(selector);
}

export function queryAllElements(document: Document, selector: string): readonly Element[] {
  return createContentElementResolver({
    document,
    registry: createSelectorOnlyRegistry(),
  }).queryAll(selector);
}

function createSelectorOnlyRegistry(): ElementRefRegistry<Element> {
  return {
    createGeneration: () => {
      throw new Error("Unexpected ref generation through selector-only resolver.");
    },
    resolve: () => {
      throw new Error("Unexpected ref resolution through selector-only resolver.");
    },
    resolveRef: () => {
      throw new Error("Unexpected ref resolution through selector-only resolver.");
    },
    invalidate: () => undefined,
  } as unknown as ElementRefRegistry<Element>;
}
