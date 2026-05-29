import { z } from "zod";

import {
  MAX_EVAL_RESULT_BYTES,
  MAX_EVAL_SCRIPT_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
} from "./constants.js";
import { elementTargetRefinement } from "./actions.js";
import { elementRefSchema, waitElementSummarySchema } from "./content.js";
import { encodedByteLength, getBase64DecodedByteLength } from "./core.js";
import { resolvedTargetSchema, targetSelectorSchema, windowSummarySchema } from "./target.js";

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

export const phase8ElementTargetParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(elementTargetRefinement);

export const dragParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    sourceSelector: z.string().min(1).optional(),
    sourceRef: elementRefSchema.optional(),
    sourceGenerationId: z.string().min(1).optional(),
    targetSelector: z.string().min(1).optional(),
    targetRef: elementRefSchema.optional(),
    targetGenerationId: z.string().min(1).optional(),
  })
  .strict();
export type DragParams = z.infer<typeof dragParamsSchema>;

export const uploadFileSchema = z
  .object({
    name: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    dataBase64: z.string().min(1),
  })
  .strict()
  .superRefine((file, context) => {
    const decodedBytes = getBase64DecodedByteLength(file.dataBase64);
    if (decodedBytes === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Upload file data must be valid base64.",
        path: ["dataBase64"],
      });
      return;
    }

    if (decodedBytes > MAX_UPLOAD_FILE_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Upload file exceeds the ${MAX_UPLOAD_FILE_BYTES} byte per-file limit.`,
        path: ["dataBase64"],
        params: {
          actualBytes: decodedBytes,
          maxBytes: MAX_UPLOAD_FILE_BYTES,
        },
      });
    }
  });
export type UploadFile = z.infer<typeof uploadFileSchema>;

export const uploadParamsSchema = phase8ElementTargetParamsSchema
  .extend({
    files: z.array(uploadFileSchema).min(1).max(MAX_UPLOAD_FILES),
  })
  .superRefine((params, context) => {
    addUploadTotalIssue(params.files, context, ["files"]);
  });
export type UploadParams = z.infer<typeof uploadParamsSchema>;

export function getUploadFilesDecodedByteLength(
  files: readonly Pick<UploadFile, "dataBase64">[],
): number | null {
  let total = 0;
  for (const file of files) {
    const decodedBytes = getBase64DecodedByteLength(file.dataBase64);
    if (decodedBytes === null) {
      return null;
    }
    total += decodedBytes;
  }
  return total;
}

export function addUploadTotalIssue(
  files: readonly Pick<UploadFile, "dataBase64">[],
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  const totalBytes = getUploadFilesDecodedByteLength(files);
  if (totalBytes === null || totalBytes <= MAX_UPLOAD_TOTAL_BYTES) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Upload files exceed the ${MAX_UPLOAD_TOTAL_BYTES} byte total limit.`,
    path,
    params: {
      actualBytes: totalBytes,
      maxBytes: MAX_UPLOAD_TOTAL_BYTES,
    },
  });
}

export const mouseParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    action: z.enum(["move", "down", "up", "wheel"]),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    button: z.number().int().nonnegative().max(4).optional(),
    deltaX: z.number().optional(),
    deltaY: z.number().optional(),
  })
  .strict()
  .superRefine((params, context) => {
    if (params.ref === undefined && params.generationId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Generation IDs apply only to refs.",
        path: ["generationId"],
      });
    }
  });
export type MouseParams = z.infer<typeof mouseParamsSchema>;

export const keyEventParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    key: z.string().min(1).max(100),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    if (params.ref === undefined && params.generationId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Generation IDs apply only to refs.",
        path: ["generationId"],
      });
    }
  });
export type KeyEventParams = z.infer<typeof keyEventParamsSchema>;

export const findKinds = [
  "role",
  "text",
  "label",
  "placeholder",
  "alt",
  "title",
  "testid",
] as const;
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

export const downloadParamsSchema = z
  .object({
    url: z.string().min(1),
    filename: z.string().min(1).optional(),
    saveAs: z.boolean().optional(),
  })
  .strict();
export const downloadResultSchema = z
  .object({
    id: z.number().int(),
    filename: z.string().optional(),
    state: z.string().optional(),
  })
  .strict();
export type DownloadResult = z.infer<typeof downloadResultSchema>;

export const dialogActions = ["status", "accept", "dismiss"] as const;
export const dialogParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    action: z.enum(dialogActions),
    promptText: z.string().optional(),
  })
  .strict();
export const dialogResultSchema = z
  .object({
    action: z.enum(dialogActions),
    handled: z.boolean(),
    message: z.string().optional(),
    type: z.string().optional(),
  })
  .strict();
export type DialogResult = z.infer<typeof dialogResultSchema>;

export const clipboardActions = ["read", "write", "copy", "paste"] as const;
export const clipboardParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    action: z.enum(clipboardActions),
    text: z.string().optional(),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
  })
  .strict();
export const clipboardResultSchema = z
  .object({
    action: z.enum(clipboardActions),
    ok: z.literal(true),
    text: z.string().optional(),
  })
  .strict();
export type ClipboardResult = z.infer<typeof clipboardResultSchema>;

export const cookieActions = ["list", "get", "set", "remove"] as const;
export const cookieParamsSchema = z
  .object({
    action: z.enum(cookieActions),
    url: z.string().min(1),
    name: z.string().min(1).optional(),
    value: z.string().optional(),
    domain: z.string().optional(),
    path: z.string().optional(),
  })
  .strict();
export const cookieSummarySchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
  })
  .strict();
export const cookieResultSchema = z
  .object({
    action: z.enum(cookieActions),
    ok: z.literal(true),
    cookies: z.array(cookieSummarySchema).optional(),
    cookie: cookieSummarySchema.nullable().optional(),
  })
  .strict();
export type CookieResult = z.infer<typeof cookieResultSchema>;

export const storageAreas = ["local", "session"] as const;
export const storageActions = ["get", "set", "remove", "clear"] as const;
export const storageParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    area: z.enum(storageAreas),
    action: z.enum(storageActions),
    key: z.string().min(1).optional(),
    value: z.string().optional(),
  })
  .strict();
export const storageResultSchema = z
  .object({
    area: z.enum(storageAreas),
    action: z.enum(storageActions),
    ok: z.literal(true),
    value: z.string().nullable().optional(),
    entries: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type StorageResult = z.infer<typeof storageResultSchema>;

export const networkActions = ["list", "clear"] as const;
export const networkParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    action: z.enum(networkActions),
    urlGlob: z.string().min(1).optional(),
  })
  .strict();
export const networkRequestSummarySchema = z
  .object({
    id: z.string(),
    url: z.string(),
    method: z.string().optional(),
    type: z.string().optional(),
    statusCode: z.number().int().optional(),
  })
  .strict();
export const networkResultSchema = z
  .object({
    action: z.enum(networkActions),
    ok: z.literal(true),
    requests: z.array(networkRequestSummarySchema).optional(),
  })
  .strict();
export type NetworkResult = z.infer<typeof networkResultSchema>;

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

export const pdfParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
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
