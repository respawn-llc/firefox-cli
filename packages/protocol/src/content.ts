import { z } from "zod";

import { refineGetParams, refineWaitParams, requireExclusiveElementLocator } from "./content-refinements.js";
import { resolvedTargetSchema, targetSelectorSchema } from "./target.js";

export const snapshotParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    interactiveOnly: z.boolean().optional(),
    compact: z.boolean().optional(),
    maxDepth: z.number().int().nonnegative().max(50).optional(),
    selector: z.string().min(1).optional(),
    maxOutputBytes: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict();
export type SnapshotParams = z.infer<typeof snapshotParamsSchema>;

export const snapshotFrameDiagnosticSchema = z
  .object({
    selector: z.string().min(1).optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    unsupported: z.literal(true),
    reason: z.string().min(1),
  })
  .strict();
export type SnapshotFrameDiagnostic = z.infer<typeof snapshotFrameDiagnosticSchema>;

export const snapshotResultSchema = z.object({
  target: resolvedTargetSchema.optional(),
  text: z.string(),
  generationId: z.string().min(1),
  refs: z.number().int().nonnegative(),
  truncated: z.boolean(),
  frames: z.array(snapshotFrameDiagnosticSchema).default([]),
});
export type SnapshotResult = z.infer<typeof snapshotResultSchema>;

export const elementRefSchema = z.string().regex(/^@e[1-9]\d*$/u);
export type ElementRef = z.infer<typeof elementRefSchema>;

export const elementSummarySchema = z
  .object({
    ref: elementRefSchema,
    generationId: z.string().min(1),
    tagName: z.string().min(1),
    role: z.string().min(1),
    visible: z.boolean(),
    name: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    href: z.string().optional(),
    disabled: z.boolean().optional(),
    checked: z.boolean().optional(),
  })
  .strict();
export type ElementSummary = z.infer<typeof elementSummarySchema>;

export const waitElementSummarySchema = elementSummarySchema
  .omit({
    ref: true,
    generationId: true,
  })
  .extend({
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((summary, context) => {
    if ((summary.ref === undefined) !== (summary.generationId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Wait element summaries require both ref and generationId, or neither.",
        path: summary.ref === undefined ? ["generationId"] : ["ref"],
      });
    }
  });
export type WaitElementSummary = z.infer<typeof waitElementSummarySchema>;

export const refResolveParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    ref: elementRefSchema,
    generationId: z.string().min(1).optional(),
  })
  .strict();
export type RefResolveParams = z.infer<typeof refResolveParamsSchema>;

export const refResolveResultSchema = z.object({
  target: resolvedTargetSchema.optional(),
  element: elementSummarySchema,
});
export type RefResolveResult = z.infer<typeof refResolveResultSchema>;

export const getKinds = ["text", "html", "value", "attr", "title", "url", "count", "box", "styles"] as const;
export const getKindSchema = z.enum(getKinds);
export type GetKind = z.infer<typeof getKindSchema>;

export const getParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    kind: getKindSchema,
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
    attribute: z.string().min(1).optional(),
    maxOutputBytes: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict()
  .superRefine(refineGetParams);
export type GetParams = z.infer<typeof getParamsSchema>;

export const getScalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const getObjectValueSchema = z.record(z.string(), getScalarValueSchema);
export const getValueSchema = z.union([getScalarValueSchema, getObjectValueSchema]);
export type GetValue = z.infer<typeof getValueSchema>;
export const getBoxValueSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  })
  .strict();
export type GetBoxValue = z.infer<typeof getBoxValueSchema>;
export const getStylesValueSchema = z
  .object({
    display: z.string(),
    visibility: z.string(),
    opacity: z.string(),
    pointerEvents: z.string(),
    position: z.string(),
    overflow: z.string(),
    overflowX: z.string(),
    overflowY: z.string(),
    color: z.string(),
    backgroundColor: z.string(),
    fontSize: z.string(),
  })
  .strict();
export type GetStylesValue = z.infer<typeof getStylesValueSchema>;

const getBaseResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    element: elementSummarySchema.optional(),
  })
  .strict();

export const getResultSchema = z.discriminatedUnion("kind", [
  getBaseResultSchema
    .extend({
      kind: z.literal("text"),
      value: z.string(),
      truncated: z.boolean().optional(),
    })
    .strict(),
  getBaseResultSchema
    .extend({
      kind: z.literal("html"),
      value: z.string(),
      truncated: z.boolean().optional(),
    })
    .strict(),
  getBaseResultSchema.extend({ kind: z.literal("value"), value: z.string().nullable() }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("attr"), value: z.string().nullable() }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("title"), value: z.string() }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("url"), value: z.string() }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("count"), value: z.number().int().nonnegative() }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("box"), value: getBoxValueSchema }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("styles"), value: getStylesValueSchema }).strict(),
]);
export type GetResult = z.infer<typeof getResultSchema>;

export const isKinds = ["visible", "enabled", "checked"] as const;
export const isKindSchema = z.enum(isKinds);
export type IsKind = z.infer<typeof isKindSchema>;

export const isParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    kind: isKindSchema,
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    requireExclusiveElementLocator(params, context, "State checks require exactly one selector or ref.");
  });
export type IsParams = z.infer<typeof isParamsSchema>;

export const isResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    kind: isKindSchema,
    value: z.boolean(),
    element: elementSummarySchema.optional(),
  })
  .strict();
export type IsResult = z.infer<typeof isResultSchema>;

export const waitKinds = ["ms", "element", "text", "url", "function", "load-state", "download"] as const;
export const waitKindSchema = z.enum(waitKinds);
export type WaitKind = z.infer<typeof waitKindSchema>;
export const waitStates = ["visible", "hidden", "attached", "domcontentloaded", "complete", "networkidle"] as const;
export const waitStateSchema = z.enum(waitStates);
export type WaitState = z.infer<typeof waitStateSchema>;

export const waitParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    kind: waitKindSchema,
    durationMs: z.number().int().nonnegative().max(600_000).optional(),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
    state: waitStateSchema.optional(),
    text: z.string().min(1).optional(),
    urlGlob: z.string().min(1).optional(),
    expression: z.string().min(1).max(20_000).optional(),
    downloadId: z.number().int().positive().optional(),
    filenameGlob: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    intervalMs: z.number().int().positive().max(60_000).optional(),
  })
  .strict()
  .superRefine(refineWaitParams);
export type WaitParams = z.infer<typeof waitParamsSchema>;

const waitBaseResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    matched: z.literal(true),
    elapsedMs: z.number().int().nonnegative(),
  })
  .strict();

export const waitResultSchema = z.discriminatedUnion("kind", [
  waitBaseResultSchema.extend({ kind: z.literal("ms") }).strict(),
  waitBaseResultSchema
    .extend({
      kind: z.literal("element"),
      element: waitElementSummarySchema.optional(),
    })
    .strict(),
  waitBaseResultSchema.extend({ kind: z.literal("text"), value: z.string() }).strict(),
  waitBaseResultSchema.extend({ kind: z.literal("url"), value: z.string() }).strict(),
  waitBaseResultSchema.extend({ kind: z.literal("function"), value: getValueSchema }).strict(),
  waitBaseResultSchema.extend({ kind: z.literal("load-state") }).strict(),
  waitBaseResultSchema
    .extend({
      kind: z.literal("download"),
      download: z
        .object({
          id: z.number().int(),
          filename: z.string().optional(),
          state: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type WaitResult = z.infer<typeof waitResultSchema>;
