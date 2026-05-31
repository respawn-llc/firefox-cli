import { z } from "zod";

import { MAX_EVAL_RESULT_BYTES, MAX_EVAL_SCRIPT_BYTES, MAX_SCREENSHOT_BYTES } from "../constants.js";
import { encodedByteLength } from "../core.js";
import { resolvedTargetSchema, targetSelectorSchema } from "../target.js";

export const evalSources = ["argv", "stdin", "base64"] as const;
export const evalSourceSchema = z.enum(evalSources);
export type EvalSource = z.infer<typeof evalSourceSchema>;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const evalParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    script: z.string().min(1),
    source: evalSourceSchema,
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    maxResultBytes: z.number().int().positive().max(MAX_EVAL_RESULT_BYTES).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    if (encodedByteLength(params.script) > MAX_EVAL_SCRIPT_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_EVAL_SCRIPT_BYTES,
        origin: "string",
        inclusive: true,
        message: `Eval scripts must be at most ${MAX_EVAL_SCRIPT_BYTES} bytes.`,
        path: ["script"],
      });
    }
  });
export type EvalParams = z.infer<typeof evalParamsSchema>;

export const evalSerializedValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("undefined") }).strict(),
  z.object({ type: z.literal("json"), value: jsonValueSchema }).strict(),
]);
export type EvalSerializedValue = z.infer<typeof evalSerializedValueSchema>;

export const evalResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    value: evalSerializedValueSchema,
    elapsedMs: z.number().int().nonnegative(),
  })
  .strict();
export type EvalResult = z.infer<typeof evalResultSchema>;

export const screenshotFormats = ["png", "jpeg"] as const;
export const screenshotFormatSchema = z.enum(screenshotFormats);
export type ScreenshotFormat = z.infer<typeof screenshotFormatSchema>;

export const screenshotParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    path: z.string().min(1),
    format: screenshotFormatSchema,
    fullPage: z.boolean().optional(),
    quality: z.number().int().min(1).max(100).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    maxImageBytes: z.number().int().positive().max(MAX_SCREENSHOT_BYTES).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    if (params.quality !== undefined && params.format !== "jpeg") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Screenshot quality applies only to JPEG screenshots.",
        path: ["quality"],
      });
    }
  });
export type ScreenshotParams = z.infer<typeof screenshotParamsSchema>;

export const screenshotActivationSchema = z
  .object({
    tabActivated: z.boolean(),
    windowFocused: z.boolean(),
  })
  .strict();
export type ScreenshotActivation = z.infer<typeof screenshotActivationSchema>;

export const screenshotResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    path: z.string().min(1),
    format: screenshotFormatSchema,
    bytes: z.number().int().nonnegative().max(MAX_SCREENSHOT_BYTES),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    activation: screenshotActivationSchema,
    imageBase64: z.string().min(1).optional(),
  })
  .strict();
export type ScreenshotResult = z.infer<typeof screenshotResultSchema>;
