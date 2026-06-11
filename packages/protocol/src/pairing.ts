import { z } from "zod";

export const pairApproveParamsSchema = z.object({}).strict();
export const pairApproveResultSchema = z
  .object({
    hostId: z.string().min(1),
    extensionId: z.string().min(1),
    token: z.string().min(1),
    generation: z.number().int().positive(),
    approvedAt: z.string().min(1),
  })
  .strict();

export const pairResetParamsSchema = z.object({}).strict();
export const pairResetResultSchema = z.object({
  ok: z.literal(true),
});

export const pairOpenApprovalParamsSchema = z.object({}).strict();
export const pairOpenApprovalResultSchema = z
  .object({
    ok: z.literal(true),
    url: z.string().min(1),
  })
  .strict();

export const pairRequestApprovalParamsSchema = z.object({}).strict();
export const pairRequestApprovalResultSchema = z
  .object({
    ok: z.literal(true),
    url: z.string().min(1),
  })
  .strict();
