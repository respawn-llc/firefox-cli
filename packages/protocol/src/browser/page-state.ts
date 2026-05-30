import { z } from "zod";

import { elementRefSchema } from "../content.js";
import { targetSelectorSchema } from "../target.js";

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
