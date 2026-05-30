import type { DragParams } from "@firefox-cli/protocol";
import type { ElementRefRegistry } from "../element-ref-registry.js";
import { ContentSnapshotError } from "./errors.js";

export type ElementTarget = {
  readonly selector?: string | undefined;
  readonly ref?: string | undefined;
  readonly generationId?: string | undefined;
};

export type ElementResolution = {
  readonly element: Element;
  readonly ref?: string;
  readonly generationId?: string;
};

export type RefElementResolution = ElementResolution & {
  readonly ref: string;
  readonly generationId: string;
};

export type ContentElementResolver = {
  resolveScope(selector: string | undefined): Element;
  resolveRequiredTarget(
    params: ElementTarget,
    options: {
      readonly missingMessage: string;
      readonly now?: number;
    },
  ): ElementResolution;
  resolveOptionalTarget(params: ElementTarget, now?: number): ElementResolution | undefined;
  resolveContentCommandTarget(params: ElementTarget, now?: number): ElementResolution;
  resolveRequiredDragTarget(
    params: DragParams,
    role: "source" | "target",
    now?: number,
  ): ElementResolution;
  resolveRef(
    ref: string,
    options: { readonly generationId?: string; readonly now?: number },
  ): RefElementResolution;
  querySingle(selector: string): Element;
  queryOptional(selector: string): Element | null;
  queryAll(selector: string): readonly Element[];
};

export function createContentElementResolver(options: {
  readonly document: Document;
  readonly registry: ElementRefRegistry<Element>;
  readonly now?: number;
}): ContentElementResolver {
  const now = (value?: number) => value ?? options.now ?? Date.now();
  return {
    resolveScope: (selector) => resolveScope(options.document, selector),
    resolveRequiredTarget: (params, resolveOptions) =>
      resolveRequiredTarget(options.document, options.registry, params, {
        missingMessage: resolveOptions.missingMessage,
        now: now(resolveOptions.now),
      }),
    resolveOptionalTarget: (params, resolveNow) =>
      resolveOptionalTarget(options.document, options.registry, params, now(resolveNow)),
    resolveContentCommandTarget: (params, resolveNow) =>
      resolveRequiredTarget(options.document, options.registry, params, {
        missingMessage: "Element selector is required.",
        now: now(resolveNow),
      }),
    resolveRequiredDragTarget: (params, role, resolveNow) => {
      const selector = role === "source" ? params.sourceSelector : params.targetSelector;
      const ref = role === "source" ? params.sourceRef : params.targetRef;
      const generationId =
        role === "source" ? params.sourceGenerationId : params.targetGenerationId;
      return resolveRequiredTarget(
        options.document,
        options.registry,
        {
          ...(selector === undefined ? {} : { selector }),
          ...(ref === undefined ? {} : { ref }),
          ...(generationId === undefined ? {} : { generationId }),
        },
        {
          missingMessage: `Drag ${role} is required.`,
          now: now(resolveNow),
        },
      );
    },
    resolveRef: (ref, resolveOptions) => {
      const resolved = options.registry.resolveRef(ref, {
        ...(resolveOptions.generationId === undefined
          ? {}
          : { generationId: resolveOptions.generationId }),
        now: now(resolveOptions.now),
      });
      return { element: resolved.element, ref, generationId: resolved.generationId };
    },
    querySingle: (selector) => querySingleElement(options.document, selector),
    queryOptional: (selector) => queryOptionalElement(options.document, selector),
    queryAll: (selector) => queryAllElements(options.document, selector),
  };
}

function resolveScope(document: Document, selector: string | undefined): Element {
  if (selector === undefined) {
    const root = document.body ?? document.documentElement;
    if (root === null) {
      throw new ContentSnapshotError("SCRIPT_INJECTION_FAILED", "Document has no snapshot root.");
    }
    return root;
  }

  return querySingleElement(document, selector);
}

function resolveRequiredTarget(
  document: Document,
  registry: ElementRefRegistry<Element>,
  params: ElementTarget,
  options: { readonly missingMessage: string; readonly now: number },
): ElementResolution {
  const resolved = resolveOptionalTarget(document, registry, params, options.now);
  if (resolved === undefined) {
    throw new ContentSnapshotError("SELECTOR_NOT_FOUND", options.missingMessage);
  }
  return resolved;
}

function resolveOptionalTarget(
  document: Document,
  registry: ElementRefRegistry<Element>,
  params: ElementTarget,
  now: number,
): ElementResolution | undefined {
  if (params.ref !== undefined) {
    const resolved = registry.resolveRef(params.ref, {
      ...(params.generationId === undefined ? {} : { generationId: params.generationId }),
      now,
    });
    return { element: resolved.element, ref: params.ref, generationId: resolved.generationId };
  }

  if (params.selector === undefined) {
    return undefined;
  }

  const element = queryOptionalElement(document, params.selector);
  if (element === null) {
    throw new ContentSnapshotError("SELECTOR_NOT_FOUND", `Selector not found: ${params.selector}`);
  }
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
