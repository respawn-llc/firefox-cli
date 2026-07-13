import { z } from "zod";

import { waitElementSummarySchema } from "../content.js";
import { resolvedTargetSchema, targetSelectorSchema, windowSummarySchema } from "../target.js";
import { phase8ElementTargetParamsSchema } from "./interactions.js";

export const logActions = ["list", "clear"] as const;
export const consoleParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    action: z.enum(logActions),
  })
  .strict();
export const consoleEntrySchema = z
  .object({
    level: z.string(),
    text: z.string(),
    timestamp: z.number(),
  })
  .strict();
export const consoleResultSchema = z
  .object({
    action: z.enum(logActions),
    ok: z.literal(true),
    entries: z.array(consoleEntrySchema).optional(),
    truncated: z.boolean().optional(),
    droppedEntries: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ConsoleResult = z.infer<typeof consoleResultSchema>;

export const errorsParamsSchema = consoleParamsSchema;
export const errorsResultSchema = z
  .object({
    action: z.enum(logActions),
    ok: z.literal(true),
    errors: z.array(consoleEntrySchema).optional(),
    truncated: z.boolean().optional(),
    droppedEntries: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ErrorsResult = z.infer<typeof errorsResultSchema>;

export const highlightParamsSchema = phase8ElementTargetParamsSchema.extend({
  durationMs: z.number().int().positive().max(60_000).optional(),
});
export const highlightResultSchema = z
  .object({
    ok: z.literal(true),
    element: waitElementSummarySchema,
    target: resolvedTargetSchema.optional(),
  })
  .strict();
export type HighlightResult = z.infer<typeof highlightResultSchema>;

export const notifyParamsSchema = z
  .object({
    id: z.string().min(1).max(256).optional(),
    title: z.string().min(1).max(256),
    message: z.string().max(1024).optional(),
  })
  .strict();
export const notifyResultSchema = z
  .object({
    ok: z.literal(true),
    id: z.string().min(1),
  })
  .strict();
export type NotifyResult = z.infer<typeof notifyResultSchema>;

export const pdfParamsSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();
export const pdfResultSchema = z.object({ path: z.string().min(1) }).strict();

export const setViewportParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    width: z.number().int().positive().max(10_000),
    height: z.number().int().positive().max(10_000),
  })
  .strict();
export const setViewportResultSchema = z
  .object({
    window: windowSummarySchema,
  })
  .strict();
export type SetViewportResult = z.infer<typeof setViewportResultSchema>;

export const diffKinds = ["url", "title", "snapshot"] as const;
export const diffParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    kind: z.enum(diffKinds),
    expected: z.string(),
    selector: z.string().min(1).optional(),
  })
  .strict();
export const diffResultSchema = z
  .object({
    kind: z.enum(diffKinds),
    matches: z.boolean(),
    expected: z.string(),
    actual: z.string(),
  })
  .strict();
export type DiffResult = z.infer<typeof diffResultSchema>;
