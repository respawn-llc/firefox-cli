import type { z } from "zod";

export interface ElementLocatorParams {
  readonly selector?: string | undefined;
  readonly ref?: string | undefined;
  readonly generationId?: string | undefined;
}

export function requireExclusiveElementLocator(params: ElementLocatorParams, context: z.RefinementCtx, message: string): void {
  if ((params.selector === undefined) === (params.ref === undefined)) {
    context.addIssue({
      code: "custom",
      message,
      path: ["selector"],
    });
  }

  rejectGenerationIdWithoutRef(params, context);
}

export function rejectGenerationIdWithoutRef(params: Pick<ElementLocatorParams, "ref" | "generationId">, context: z.RefinementCtx): void {
  if (params.ref === undefined && params.generationId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Generation IDs apply only to refs.",
      path: ["generationId"],
    });
  }
}

export function refineGetParams(
  params: ElementLocatorParams & {
    readonly kind: string;
    readonly attribute?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  const isTabGetter = params.kind === "title" || params.kind === "url";
  if (isTabGetter) {
    rejectElementLocator(params, context, `${params.kind} does not accept an element selector or ref.`);
  } else {
    requireExclusiveElementLocator(params, context, "Element getters require exactly one selector or ref.");
  }

  if (params.kind === "attr" && params.attribute === undefined) {
    context.addIssue({
      code: "custom",
      message: "Attribute getters require an attribute name.",
      path: ["attribute"],
    });
  }

  if (params.kind !== "attr" && params.attribute !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Only attr getters accept an attribute name.",
      path: ["attribute"],
    });
  }

  rejectGenerationIdWithoutRef(params, context);
}

export function refineWaitParams(
  params: ElementLocatorParams & {
    readonly kind: string;
    readonly durationMs?: number | undefined;
    readonly state?: string | undefined;
    readonly text?: string | undefined;
    readonly urlGlob?: string | undefined;
    readonly expression?: string | undefined;
    readonly downloadId?: number | undefined;
    readonly filenameGlob?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  validateKindRequiredFields(params, context);
  validateKindExclusiveFields(params, context);
  validateWaitState(params, context);
  rejectGenerationIdWithoutRef(params, context);
}

function rejectElementLocator(params: ElementLocatorParams, context: z.RefinementCtx, message: string): void {
  if (params.selector !== undefined || params.ref !== undefined) {
    context.addIssue({
      code: "custom",
      message,
      path: params.selector === undefined ? ["ref"] : ["selector"],
    });
  }
}

function validateKindRequiredFields(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  const requiredChecks = [
    { invalid: params.kind === "ms" && params.durationMs === undefined, message: "Duration waits require durationMs.", path: ["durationMs"] },
    {
      invalid: params.kind === "element" && (params.selector === undefined) === (params.ref === undefined),
      message: "Element waits require exactly one selector or ref.",
      path: ["selector"],
    },
    { invalid: params.kind === "text" && params.text === undefined, message: "Text waits require text.", path: ["text"] },
    { invalid: params.kind === "url" && params.urlGlob === undefined, message: "URL waits require urlGlob.", path: ["urlGlob"] },
    { invalid: params.kind === "function" && params.expression === undefined, message: "Function waits require expression.", path: ["expression"] },
  ] as const;

  for (const check of requiredChecks) {
    if (check.invalid) {
      context.addIssue({ code: "custom", message: check.message, path: [...check.path] });
    }
  }
}

function validateKindExclusiveFields(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  validateDurationExclusivity(params, context);
  validateTextExclusivity(params, context);
  validateUrlExclusivity(params, context);
  validateFunctionExclusivity(params, context);
  validateDownloadExclusivity(params, context);
  if (params.kind !== "element") {
    rejectElementLocator(params, context, "Only element waits accept selector or ref.");
  }
}

function validateDurationExclusivity(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  if (params.kind !== "ms" && params.durationMs !== undefined) {
    context.addIssue({ code: "custom", message: "Only duration waits accept durationMs.", path: ["durationMs"] });
  }
}

function validateTextExclusivity(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  if (params.kind !== "text" && params.text !== undefined) {
    context.addIssue({ code: "custom", message: "Only text waits accept text.", path: ["text"] });
  }
}

function validateUrlExclusivity(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  if (params.kind !== "url" && params.urlGlob !== undefined) {
    context.addIssue({ code: "custom", message: "Only URL waits accept urlGlob.", path: ["urlGlob"] });
  }
}

function validateFunctionExclusivity(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  if (params.kind !== "function" && params.expression !== undefined) {
    context.addIssue({ code: "custom", message: "Only function waits accept expression.", path: ["expression"] });
  }
}

function validateDownloadExclusivity(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  if (params.kind !== "download" && (params.downloadId !== undefined || params.filenameGlob !== undefined)) {
    context.addIssue({
      code: "custom",
      message: "Only download waits accept download criteria.",
      path: params.downloadId === undefined ? ["filenameGlob"] : ["downloadId"],
    });
  }
}

function validateWaitState(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  validateElementWaitState(params, context);
  validateLoadWaitState(params, context);
  validateStateExclusivity(params, context);
}

function validateElementWaitState(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  if (params.kind === "element" && params.state !== undefined && params.state !== "visible" && params.state !== "hidden" && params.state !== "attached") {
    context.addIssue({
      code: "custom",
      message: "Element waits require visible, hidden, or attached state.",
      path: ["state"],
    });
  }
}

function validateLoadWaitState(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  if (params.kind === "load-state" && params.state !== "domcontentloaded" && params.state !== "complete" && params.state !== "networkidle") {
    context.addIssue({
      code: "custom",
      message: "Load-state waits require domcontentloaded, complete, or networkidle state.",
      path: ["state"],
    });
  }
}

function validateStateExclusivity(params: Parameters<typeof refineWaitParams>[0], context: z.RefinementCtx): void {
  if (params.kind !== "element" && params.kind !== "load-state" && params.state !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Only element and load-state waits accept state.",
      path: ["state"],
    });
  }
}
