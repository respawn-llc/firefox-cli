import { z } from "zod";

import { MAX_BATCH_RESULT_BYTES } from "./constants.js";
import { protocolErrorSchema } from "./core.js";
import { addUploadTotalIssue, uploadParamsSchema } from "./browser.js";
import { targetSelectorSchema } from "./target.js";

export type BatchRegistryLookup = {
  readonly hasCommand: (command: string) => boolean;
  readonly isBatchable: (command: string) => boolean;
  readonly paramsFor: (command: string) => z.ZodType | undefined;
  readonly resultFor: (command: string) => z.ZodType | undefined;
  readonly paramsWithDefaultTarget: (command: string, params: unknown) => unknown | undefined;
};

export function createBatchSchemas(registry: BatchRegistryLookup) {
  const batchStepSchema = z
    .object({
      command: z.string().min(1),
      params: z.unknown().default({}),
    })
    .strict()
    .superRefine((step, context) => {
      if (!registry.hasCommand(step.command)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown batch command: ${step.command}`,
          path: ["command"],
        });
        return;
      }

      if (!registry.isBatchable(step.command)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Command cannot run inside batch: ${step.command}`,
          path: ["command"],
        });
        return;
      }

      const paramsSchema = registry.paramsFor(step.command);
      if (paramsSchema === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown batch command: ${step.command}`,
          path: ["command"],
        });
        return;
      }

      const params = paramsSchema.safeParse(step.params);
      const paramsWithDefaultTarget = registry.paramsWithDefaultTarget(step.command, step.params);
      const fallbackParams =
        params.success || paramsWithDefaultTarget === undefined
          ? params
          : paramsSchema.safeParse(paramsWithDefaultTarget);
      if (!fallbackParams.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Batch step params are invalid.",
          path: ["params"],
          params: {
            command: step.command,
            issues: fallbackParams.error.issues,
          },
        });
      }
    });

  const batchParamsSchema = z
    .object({
      target: targetSelectorSchema.optional(),
      steps: z.array(batchStepSchema).min(1).max(100),
      bail: z.boolean().optional(),
      timeoutMs: z.number().int().positive().max(600_000).optional(),
      maxResultBytes: z.number().int().positive().max(MAX_BATCH_RESULT_BYTES).optional(),
    })
    .strict()
    .superRefine((params, context) => {
      const uploadFiles = params.steps.flatMap((step) => {
        if (step.command !== "upload") {
          return [];
        }

        const parsed = uploadParamsSchema.safeParse(step.params);
        return parsed.success ? parsed.data.files : [];
      });

      addUploadTotalIssue(uploadFiles, context, ["steps"]);
    });

  const batchStepResultBaseSchema = z
    .object({
      index: z.number().int().nonnegative(),
      command: z.string().min(1),
    })
    .strict();

  const batchStepResultSchema = z
    .discriminatedUnion("ok", [
      batchStepResultBaseSchema
        .extend({
          ok: z.literal(true),
          result: z.unknown(),
        })
        .strict(),
      batchStepResultBaseSchema
        .extend({
          ok: z.literal(false),
          error: protocolErrorSchema,
        })
        .strict(),
    ])
    .superRefine((step, context) => {
      if (!registry.hasCommand(step.command)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown batch result command: ${step.command}`,
          path: ["command"],
        });
        return;
      }

      if (!registry.isBatchable(step.command)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Command cannot appear in batch results: ${step.command}`,
          path: ["command"],
        });
        return;
      }

      if (step.ok) {
        const resultSchema = registry.resultFor(step.command);
        if (resultSchema === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown batch result command: ${step.command}`,
            path: ["command"],
          });
          return;
        }

        const result = resultSchema.safeParse(step.result);
        if (!result.success) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Batch step result is invalid.",
            path: ["result"],
            params: {
              command: step.command,
              issues: result.error.issues,
            },
          });
        }
      }
    });

  const batchResultSchema = z
    .object({
      ok: z.boolean(),
      steps: z.array(batchStepResultSchema),
      firstFailedIndex: z.number().int().nonnegative().optional(),
      elapsedMs: z.number().int().nonnegative(),
    })
    .strict()
    .superRefine((result, context) => {
      const firstFailedIndex = result.steps.find((step) => !step.ok)?.index;
      if (result.ok) {
        if (firstFailedIndex !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Successful batch results cannot contain failed steps.",
            path: ["ok"],
          });
        }

        if (result.firstFailedIndex !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Successful batch results cannot include firstFailedIndex.",
            path: ["firstFailedIndex"],
          });
        }
        return;
      }

      if (firstFailedIndex === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Failed batch results must contain a failed step.",
          path: ["ok"],
        });
        return;
      }

      if (result.firstFailedIndex !== firstFailedIndex) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Batch firstFailedIndex must match the first failed step.",
          path: ["firstFailedIndex"],
        });
      }
    });

  return {
    batchStepSchema,
    batchParamsSchema,
    batchStepResultSchema,
    batchResultSchema,
  } as const;
}
