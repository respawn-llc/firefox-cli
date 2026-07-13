import { z } from "zod";

export const tabSummarySchema = z
  .object({
    id: z.number().int(),
    index: z.number().int().nonnegative(),
    active: z.boolean(),
    title: z.string().optional(),
    url: z.string().optional(),
    windowId: z.number().int(),
    private: z.boolean().optional(),
    cookieStoreId: z.string().optional(),
  })
  .strict();
export type TabSummary = z.infer<typeof tabSummarySchema>;

export const targetDimensionSelectorSchema = z.union([
  z.object({ kind: z.literal("active") }).strict(),
  z.object({ kind: z.literal("id"), id: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("index"), index: z.number().int().nonnegative() }).strict(),
]);

export const targetSelectorSchema = z
  .object({
    window: targetDimensionSelectorSchema.optional(),
    tab: targetDimensionSelectorSchema.optional(),
  })
  .strict();
export type TargetSelector = z.infer<typeof targetSelectorSchema>;

export const windowTargetSelectorSchema = z
  .object({
    window: targetDimensionSelectorSchema,
  })
  .strict();
export type WindowTargetSelector = z.infer<typeof windowTargetSelectorSchema>;

export const resolvedTargetSchema = z
  .object({
    windowId: z.number().int(),
    windowIndex: z.number().int().nonnegative(),
    tabId: z.number().int(),
    tabIndex: z.number().int().nonnegative(),
    title: z.string().optional(),
    url: z.string().optional(),
    private: z.boolean().optional(),
    cookieStoreId: z.string().optional(),
  })
  .strict();
export type ResolvedTarget = z.infer<typeof resolvedTargetSchema>;

export const windowSummarySchema = z
  .object({
    id: z.number().int(),
    index: z.number().int().nonnegative(),
    focused: z.boolean(),
    activeTabId: z.number().int().optional(),
    tabCount: z.number().int().nonnegative(),
    private: z.boolean().optional(),
    left: z.number().int().optional(),
    top: z.number().int().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();
export type WindowSummary = z.infer<typeof windowSummarySchema>;

export const tabsListParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
  })
  .strict();
export const tabsListResultSchema = z.object({
  target: resolvedTargetSchema.optional(),
  tabs: z.array(tabSummarySchema),
});

export const tabNewParamsSchema = z
  .object({
    url: z.string().min(1).optional(),
    target: windowTargetSelectorSchema.optional(),
  })
  .strict();
export const tabTargetParamsSchema = z
  .object({
    target: targetSelectorSchema,
  })
  .strict();
export const tabNewResultSchema = z.object({
  target: resolvedTargetSchema,
});
export const tabCloseResultSchema = z.object({
  closedTabId: z.number().int(),
  nextActiveTabId: z.number().int().optional(),
});

export const windowsListParamsSchema = z.object({}).strict();
export const windowsListResultSchema = z.object({
  windows: z.array(windowSummarySchema),
});
export const windowNewParamsSchema = z
  .object({
    url: z.string().min(1).optional(),
  })
  .strict();
export const windowTargetParamsSchema = z
  .object({
    target: windowTargetSelectorSchema,
  })
  .strict();
export const windowNewResultSchema = z.object({
  window: windowSummarySchema,
  target: resolvedTargetSchema.optional(),
});
export const windowSelectResultSchema = z.object({
  window: windowSummarySchema,
  target: resolvedTargetSchema.optional(),
});
export const windowCloseResultSchema = z.object({
  closedWindowId: z.number().int(),
});

export const openParamsSchema = z
  .object({
    url: z.string().min(1),
    newTab: z.boolean().default(false),
    target: targetSelectorSchema.optional(),
  })
  .strict();
export const navigationParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
  })
  .strict();
export const navigationResultSchema = z.object({
  target: resolvedTargetSchema,
  url: z.string().optional(),
  loadState: z.enum(["unknown", "complete"]).optional(),
});
