import { z } from "zod";

import { elementRefSchema, waitElementSummarySchema } from "./content.js";
import { resolvedTargetSchema, targetSelectorSchema } from "./target.js";

export const actionKinds = [
  "click",
  "dblclick",
  "focus",
  "hover",
  "fill",
  "type",
  "press",
  "keyboard.type",
  "keyboard.inserttext",
  "check",
  "uncheck",
  "select",
  "scroll",
  "scrollintoview",
  "swipe",
  "drag",
  "upload",
  "mouse",
  "keydown",
  "keyup",
] as const;
export const actionKindSchema = z.enum(actionKinds);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const scrollDirections = ["up", "down", "left", "right"] as const;
export const scrollDirectionSchema = z.enum(scrollDirections);
export type ScrollDirection = z.infer<typeof scrollDirectionSchema>;

export const elementTargetRefinement = (
  params: {
    readonly selector?: string | undefined;
    readonly ref?: string | undefined;
    readonly generationId?: string | undefined;
  },
  context: z.RefinementCtx,
): void => {
  if ((params.selector === undefined) === (params.ref === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Element actions require exactly one selector or ref.",
      path: ["selector"],
    });
  }

  if (params.ref === undefined && params.generationId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Generation IDs apply only to refs.",
      path: ["generationId"],
    });
  }
};

export const elementActionParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(elementTargetRefinement);
export type ElementActionParams = z.infer<typeof elementActionParamsSchema>;

export const textActionParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
    text: z.string(),
  })
  .strict()
  .superRefine(elementTargetRefinement);
export type TextActionParams = z.infer<typeof textActionParamsSchema>;

export const keyboardTextActionParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    text: z.string(),
  })
  .strict();
export type KeyboardTextActionParams = z.infer<typeof keyboardTextActionParamsSchema>;

export const pressParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    key: z.string().min(1).max(100),
  })
  .strict();
export type PressParams = z.infer<typeof pressParamsSchema>;

export const selectParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
    values: z.array(z.string()).min(1),
  })
  .strict()
  .superRefine(elementTargetRefinement);
export type SelectParams = z.infer<typeof selectParamsSchema>;

export const scrollParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
    direction: scrollDirectionSchema,
    distancePx: z.number().int().positive().max(100_000).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    if (params.selector !== undefined && params.ref !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Scroll actions accept at most one selector or ref.",
        path: ["selector"],
      });
    }

    if (params.ref === undefined && params.generationId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Generation IDs apply only to refs.",
        path: ["generationId"],
      });
    }
  });
export type ScrollParams = z.infer<typeof scrollParamsSchema>;

const actionBaseResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    ok: z.literal(true),
  })
  .strict();

export const elementActionResultSchemaFor = <A extends ActionKind>(action: A) =>
  actionBaseResultSchema
    .extend({
      action: z.literal(action),
      element: waitElementSummarySchema,
    })
    .strict();

export const textActionResultSchemaFor = <A extends ActionKind>(action: A) =>
  elementActionResultSchemaFor(action)
    .extend({
      valueLength: z.number().int().nonnegative(),
    })
    .strict();

export const selectActionResultSchema = elementActionResultSchemaFor("select")
  .extend({
    selectedValues: z.array(z.string()),
  })
  .strict();

export const scrollActionResultSchemaFor = <A extends ActionKind>(action: A) =>
  actionBaseResultSchema
    .extend({
      action: z.literal(action),
      element: waitElementSummarySchema.optional(),
      scroll: z
        .object({
          x: z.number(),
          y: z.number(),
        })
        .strict(),
    })
    .strict();

export const actionResultSchema = z.union([
  elementActionResultSchemaFor("click"),
  elementActionResultSchemaFor("dblclick"),
  elementActionResultSchemaFor("focus"),
  elementActionResultSchemaFor("hover"),
  textActionResultSchemaFor("fill"),
  textActionResultSchemaFor("type"),
  elementActionResultSchemaFor("press"),
  textActionResultSchemaFor("keyboard.type"),
  textActionResultSchemaFor("keyboard.inserttext"),
  elementActionResultSchemaFor("check"),
  elementActionResultSchemaFor("uncheck"),
  selectActionResultSchema,
  scrollActionResultSchemaFor("scroll"),
  elementActionResultSchemaFor("scrollintoview"),
  scrollActionResultSchemaFor("swipe"),
  elementActionResultSchemaFor("drag"),
  textActionResultSchemaFor("upload"),
  elementActionResultSchemaFor("mouse"),
  elementActionResultSchemaFor("keydown"),
  elementActionResultSchemaFor("keyup"),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;
