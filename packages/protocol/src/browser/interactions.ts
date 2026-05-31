import { z } from "zod";

import { elementTargetRefinement } from "../actions.js";
import { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_TOTAL_BYTES } from "../constants.js";
import { elementRefSchema } from "../content.js";
import { getBase64DecodedByteLength } from "../core.js";
import { targetSelectorSchema } from "../target.js";

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
        code: "custom",
        message: "Upload file data must be valid base64.",
        path: ["dataBase64"],
      });
      return;
    }

    if (decodedBytes > MAX_UPLOAD_FILE_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Upload file exceeds the ${String(MAX_UPLOAD_FILE_BYTES)} byte per-file limit.`,
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

export function getUploadFilesDecodedByteLength(files: readonly Pick<UploadFile, "dataBase64">[]): number | null {
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

export function addUploadTotalIssue(files: readonly Pick<UploadFile, "dataBase64">[], context: z.RefinementCtx, path: (string | number)[]): void {
  const totalBytes = getUploadFilesDecodedByteLength(files);
  if (totalBytes === null || totalBytes <= MAX_UPLOAD_TOTAL_BYTES) {
    return;
  }

  context.addIssue({
    code: "custom",
    message: `Upload files exceed the ${String(MAX_UPLOAD_TOTAL_BYTES)} byte total limit.`,
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
        code: "custom",
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
        code: "custom",
        message: "Generation IDs apply only to refs.",
        path: ["generationId"],
      });
    }
  });
export type KeyEventParams = z.infer<typeof keyEventParamsSchema>;
