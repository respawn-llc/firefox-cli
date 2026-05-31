import { z } from "zod";

import { waitElementSummarySchema } from "../content.js";
import { resolvedTargetSchema, targetSelectorSchema } from "../target.js";

export const findKinds = ["role", "text", "label", "placeholder", "alt", "title", "testid"] as const;
export const findKindSchema = z.enum(findKinds);
export type FindKind = z.infer<typeof findKindSchema>;

export const findParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    kind: findKindSchema,
    value: z.string().min(1),
    first: z.boolean().optional(),
    last: z.boolean().optional(),
    nth: z.number().int().nonnegative().optional(),
  })
  .strict();
export type FindParams = z.infer<typeof findParamsSchema>;

export const findResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    elements: z.array(waitElementSummarySchema),
  })
  .strict();
export type FindResult = z.infer<typeof findResultSchema>;

export const frameParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
  })
  .strict();
export const frameSummarySchema = z
  .object({
    index: z.number().int().nonnegative(),
    selector: z.string().min(1).optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();
export const frameResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    frames: z.array(frameSummarySchema),
  })
  .strict();
export type FrameResult = z.infer<typeof frameResultSchema>;
