import type { DragParams, ElementActionParams, MouseParams, ScrollParams, SelectParams, TextActionParams, UploadParams } from "@firefox-cli/protocol";
import type { ActionOptions, ContentActionResult, ElementResolution } from "../content-action-types.js";

type ElementTargetParams = ElementActionParams | TextActionParams | SelectParams | UploadParams;

type OptionalElementTargetParams = ElementTargetParams | MouseParams | Pick<ScrollParams, "selector" | "ref" | "generationId">;

export function resolveRequiredElement(options: ActionOptions, params: ElementTargetParams): ElementResolution {
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

export function resolveOptionalElement(options: ActionOptions, params: OptionalElementTargetParams): ElementResolution | undefined {
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

export function resolveRequiredDragElement(options: ActionOptions, params: DragParams, role: "source" | "target"): ElementResolution {
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

export function elementActionResult(options: ActionOptions, resolution: ElementResolution): ContentActionResult {
  return {
    action: options.command,
    ok: true,
    element: options.summarizeElement(
      resolution.element,
      resolution.ref === undefined || resolution.generationId === undefined ? undefined : { ref: resolution.ref, generationId: resolution.generationId },
    ),
  };
}

export function assertActionableElement(options: ActionOptions, element: Element): void {
  assertVisible(options, element);
  assertEnabled(options, element);
}

export function assertVisible(options: ActionOptions, element: Element): void {
  if (!options.isVisible(element)) {
    throw options.createError("ELEMENT_NOT_VISIBLE", "Element is not visible.");
  }
}

export function assertEnabled(options: ActionOptions, element: Element): void {
  if (options.isDisabled(element)) {
    throw options.createError("ELEMENT_DISABLED", "Element is disabled.");
  }
}
