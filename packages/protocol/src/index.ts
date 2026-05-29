import { z } from "zod";

export * from "./request-tracker.js";

export const PRODUCT_NAME = "firefox-cli";
export const NATIVE_HOST_NAME = "firefox_cli";
export const FIREFOX_CLI_EXTENSION_ID = "firefox-cli@example.invalid";
export const PROTOCOL_VERSION = 1;
export const MAX_EVAL_SCRIPT_BYTES = 100_000;
export const MAX_EVAL_RESULT_BYTES = 900_000;
export const MAX_SCREENSHOT_BYTES = 8_000_000;
export const MAX_BATCH_RESULT_BYTES = 900_000;
export const MAX_UPLOAD_FILES = 20;
export const MAX_UPLOAD_FILE_BYTES = 512_000;
export const MAX_UPLOAD_TOTAL_BYTES = 640_000;

export const componentSchema = z.enum(["cli", "native-host", "extension", "content-script"]);
export type Component = z.infer<typeof componentSchema>;

export const boundarySchema = z.enum([
  "cli-to-host",
  "host-to-extension",
  "extension-to-content-script",
]);
export type Boundary = z.infer<typeof boundarySchema>;

export const capabilityStatuses = ["mvp", "prototype-gated", "deferred", "unsupported"] as const;
export const capabilityStatusSchema = z.enum(capabilityStatuses);
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;

export const errorCodeSchema = z.enum([
  "INVALID_JSON",
  "INVALID_ENVELOPE",
  "INVALID_RESPONSE",
  "VERSION_MISMATCH",
  "UNKNOWN_COMMAND",
  "UNSUPPORTED_CAPABILITY",
  "NOT_APPROVED",
  "EXTENSION_NOT_CONNECTED",
  "NATIVE_HOST_UNAVAILABLE",
  "PAIRING_MISMATCH",
  "PERMISSION_DENIED",
  "NO_ACTIVE_TAB",
  "INVALID_TARGET",
  "NAVIGATION_FAILED",
  "SCRIPT_INJECTION_FAILED",
  "SELECTOR_NOT_FOUND",
  "REF_NOT_FOUND",
  "OUTPUT_TOO_LARGE",
  "TIMEOUT",
  "ELEMENT_NOT_VISIBLE",
  "ELEMENT_DISABLED",
  "NOT_EDITABLE",
  "ACTION_REJECTED",
  "NO_FOCUSED_ELEMENT",
  "INVALID_KEY",
  "OPTION_NOT_FOUND",
  "EVAL_ERROR",
  "SERIALIZATION_FAILED",
  "UNSUPPORTED_EXECUTION_WORLD",
  "RESULT_TOO_LARGE",
  "CAPTURE_FAILED",
  "FILE_WRITE_FAILED",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const protocolErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ProtocolError = z.infer<typeof protocolErrorSchema>;

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProtocolError };

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function getBase64DecodedByteLength(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0 || !base64Pattern.test(value)) {
    return null;
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const capabilitySchema = z.object({
  command: z.string().min(1),
  status: capabilityStatusSchema,
  reason: z.string().min(1).optional(),
});
export type CapabilitySummary = z.infer<typeof capabilitySchema>;

export const componentIdentitySchema = z.object({
  component: componentSchema,
  productName: z.literal(PRODUCT_NAME),
  productVersion: z.string().min(1),
  protocolMin: z.number().int().positive(),
  protocolMax: z.number().int().positive(),
  features: z.array(z.string().min(1)).default([]),
});
export type ComponentIdentity = z.infer<typeof componentIdentitySchema>;

export const helloParamsSchema = componentIdentitySchema.extend({
  pairToken: z.string().min(1).optional(),
});
export const helloResultSchema = z.object({
  accepted: z.literal(true),
  negotiatedProtocolVersion: z.literal(PROTOCOL_VERSION),
  peer: componentIdentitySchema,
  pairing: z
    .object({
      hostId: z.string().min(1),
      extensionId: z.string().min(1),
      approved: z.boolean(),
      status: z.enum(["approved", "not-approved", "invalid-pair-state"]).optional(),
      message: z.string().min(1).optional(),
      generation: z.number().int().positive().optional(),
    })
    .strict()
    .superRefine((pairing, context) => {
      if (pairing.approved && pairing.status !== undefined && pairing.status !== "approved") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Approved pairing cannot have an invalid or not-approved status.",
          path: ["status"],
        });
      }
      if (!pairing.approved && pairing.status === "approved") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Unapproved pairing cannot have approved status.",
          path: ["status"],
        });
      }
      if (pairing.status === "invalid-pair-state" && pairing.message === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid pair-state status requires a message.",
          path: ["message"],
        });
      }
    })
    .optional(),
});

export const noOpParamsSchema = z.object({}).strict();
export const noOpResultSchema = z.object({
  ok: z.literal(true),
});

export const capabilitiesParamsSchema = z.object({}).strict();
export const capabilitiesResultSchema = z.object({
  capabilities: z.array(capabilitySchema),
});

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

export const targetSelectorSchema = z
  .object({
    window: z
      .union([
        z.object({ kind: z.literal("active") }).strict(),
        z.object({ kind: z.literal("id"), id: z.number().int() }).strict(),
        z.object({ kind: z.literal("index"), index: z.number().int().nonnegative() }).strict(),
      ])
      .optional(),
    tab: z
      .union([
        z.object({ kind: z.literal("active") }).strict(),
        z.object({ kind: z.literal("id"), id: z.number().int() }).strict(),
        z.object({ kind: z.literal("index"), index: z.number().int().nonnegative() }).strict(),
      ])
      .optional(),
  })
  .strict();
export type TargetSelector = z.infer<typeof targetSelectorSchema>;

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
    target: targetSelectorSchema.optional(),
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
    target: targetSelectorSchema,
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

export const snapshotParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    interactiveOnly: z.boolean().optional(),
    compact: z.boolean().optional(),
    maxDepth: z.number().int().nonnegative().max(50).optional(),
    selector: z.string().min(1).optional(),
    maxOutputBytes: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict();
export type SnapshotParams = z.infer<typeof snapshotParamsSchema>;

export const snapshotFrameDiagnosticSchema = z
  .object({
    selector: z.string().min(1).optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    unsupported: z.literal(true),
    reason: z.string().min(1),
  })
  .strict();
export type SnapshotFrameDiagnostic = z.infer<typeof snapshotFrameDiagnosticSchema>;

export const snapshotResultSchema = z.object({
  target: resolvedTargetSchema.optional(),
  text: z.string(),
  generationId: z.string().min(1),
  refs: z.number().int().nonnegative(),
  truncated: z.boolean(),
  frames: z.array(snapshotFrameDiagnosticSchema).default([]),
});
export type SnapshotResult = z.infer<typeof snapshotResultSchema>;

export const elementRefSchema = z.string().regex(/^@e[1-9]\d*$/u);
export type ElementRef = z.infer<typeof elementRefSchema>;

export const elementSummarySchema = z
  .object({
    ref: elementRefSchema,
    generationId: z.string().min(1),
    tagName: z.string().min(1),
    role: z.string().min(1),
    visible: z.boolean(),
    name: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    href: z.string().optional(),
    disabled: z.boolean().optional(),
    checked: z.boolean().optional(),
  })
  .strict();
export type ElementSummary = z.infer<typeof elementSummarySchema>;

export const waitElementSummarySchema = elementSummarySchema
  .omit({
    ref: true,
    generationId: true,
  })
  .extend({
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((summary, context) => {
    if ((summary.ref === undefined) !== (summary.generationId === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Wait element summaries require both ref and generationId, or neither.",
        path: summary.ref === undefined ? ["generationId"] : ["ref"],
      });
    }
  });
export type WaitElementSummary = z.infer<typeof waitElementSummarySchema>;

export const refResolveParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    ref: elementRefSchema,
    generationId: z.string().min(1).optional(),
  })
  .strict();
export type RefResolveParams = z.infer<typeof refResolveParamsSchema>;

export const refResolveResultSchema = z.object({
  target: resolvedTargetSchema.optional(),
  element: elementSummarySchema,
});
export type RefResolveResult = z.infer<typeof refResolveResultSchema>;

export const getKinds = [
  "text",
  "html",
  "value",
  "attr",
  "title",
  "url",
  "count",
  "box",
  "styles",
] as const;
export const getKindSchema = z.enum(getKinds);
export type GetKind = z.infer<typeof getKindSchema>;

export const getParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    kind: getKindSchema,
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
    attribute: z.string().min(1).optional(),
    maxOutputBytes: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    const isTabGetter = params.kind === "title" || params.kind === "url";
    if (isTabGetter && (params.selector !== undefined || params.ref !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${params.kind} does not accept an element selector or ref.`,
        path: params.selector === undefined ? ["ref"] : ["selector"],
      });
    }

    if (!isTabGetter && (params.selector === undefined) === (params.ref === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Element getters require exactly one selector or ref.",
        path: ["selector"],
      });
    }

    if (params.kind === "attr" && params.attribute === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attribute getters require an attribute name.",
        path: ["attribute"],
      });
    }

    if (params.kind !== "attr" && params.attribute !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only attr getters accept an attribute name.",
        path: ["attribute"],
      });
    }

    if (params.ref === undefined && params.generationId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Generation IDs apply only to refs.",
        path: ["generationId"],
      });
    }
  });
export type GetParams = z.infer<typeof getParamsSchema>;

export const getScalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const getObjectValueSchema = z.record(z.string(), getScalarValueSchema);
export const getValueSchema = z.union([getScalarValueSchema, getObjectValueSchema]);
export type GetValue = z.infer<typeof getValueSchema>;
export const getBoxValueSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  })
  .strict();
export type GetBoxValue = z.infer<typeof getBoxValueSchema>;
export const getStylesValueSchema = z
  .object({
    display: z.string(),
    visibility: z.string(),
    opacity: z.string(),
    pointerEvents: z.string(),
    position: z.string(),
    overflow: z.string(),
    overflowX: z.string(),
    overflowY: z.string(),
    color: z.string(),
    backgroundColor: z.string(),
    fontSize: z.string(),
  })
  .strict();
export type GetStylesValue = z.infer<typeof getStylesValueSchema>;

const getBaseResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    element: elementSummarySchema.optional(),
  })
  .strict();

export const getResultSchema = z.discriminatedUnion("kind", [
  getBaseResultSchema
    .extend({
      kind: z.literal("text"),
      value: z.string(),
      truncated: z.boolean().optional(),
    })
    .strict(),
  getBaseResultSchema
    .extend({
      kind: z.literal("html"),
      value: z.string(),
      truncated: z.boolean().optional(),
    })
    .strict(),
  getBaseResultSchema.extend({ kind: z.literal("value"), value: z.string().nullable() }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("attr"), value: z.string().nullable() }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("title"), value: z.string() }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("url"), value: z.string() }).strict(),
  getBaseResultSchema
    .extend({ kind: z.literal("count"), value: z.number().int().nonnegative() })
    .strict(),
  getBaseResultSchema.extend({ kind: z.literal("box"), value: getBoxValueSchema }).strict(),
  getBaseResultSchema.extend({ kind: z.literal("styles"), value: getStylesValueSchema }).strict(),
]);
export type GetResult = z.infer<typeof getResultSchema>;

export const isKinds = ["visible", "enabled", "checked"] as const;
export const isKindSchema = z.enum(isKinds);
export type IsKind = z.infer<typeof isKindSchema>;

export const isParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    kind: isKindSchema,
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    if ((params.selector === undefined) === (params.ref === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "State checks require exactly one selector or ref.",
        path: ["selector"],
      });
    }

    if (params.ref === undefined && params.generationId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Generation IDs apply only to refs.",
        path: ["generationId"],
      });
    }
  });
export type IsParams = z.infer<typeof isParamsSchema>;

export const isResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    kind: isKindSchema,
    value: z.boolean(),
    element: elementSummarySchema.optional(),
  })
  .strict();
export type IsResult = z.infer<typeof isResultSchema>;

export const waitKinds = [
  "ms",
  "element",
  "text",
  "url",
  "function",
  "load-state",
  "download",
] as const;
export const waitKindSchema = z.enum(waitKinds);
export type WaitKind = z.infer<typeof waitKindSchema>;
export const waitStates = [
  "visible",
  "hidden",
  "attached",
  "domcontentloaded",
  "complete",
  "networkidle",
] as const;
export const waitStateSchema = z.enum(waitStates);
export type WaitState = z.infer<typeof waitStateSchema>;

export const waitParamsSchema = z
  .object({
    target: targetSelectorSchema.optional(),
    kind: waitKindSchema,
    durationMs: z.number().int().nonnegative().max(600_000).optional(),
    selector: z.string().min(1).optional(),
    ref: elementRefSchema.optional(),
    generationId: z.string().min(1).optional(),
    state: waitStateSchema.optional(),
    text: z.string().min(1).optional(),
    urlGlob: z.string().min(1).optional(),
    expression: z.string().min(1).max(20_000).optional(),
    downloadId: z.number().int().positive().optional(),
    filenameGlob: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    intervalMs: z.number().int().positive().max(60_000).optional(),
  })
  .strict()
  .superRefine((params, context) => {
    if (params.kind === "ms" && params.durationMs === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duration waits require durationMs.",
        path: ["durationMs"],
      });
    }

    if (params.kind !== "ms" && params.durationMs !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only duration waits accept durationMs.",
        path: ["durationMs"],
      });
    }

    if (
      params.kind === "element" &&
      (params.selector === undefined) === (params.ref === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Element waits require exactly one selector or ref.",
        path: ["selector"],
      });
    }

    if (
      params.kind === "element" &&
      params.state !== undefined &&
      params.state !== "visible" &&
      params.state !== "hidden" &&
      params.state !== "attached"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Element waits require visible, hidden, or attached state.",
        path: ["state"],
      });
    }

    if (params.kind === "text" && params.text === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Text waits require text.",
        path: ["text"],
      });
    }

    if (params.kind !== "text" && params.text !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only text waits accept text.",
        path: ["text"],
      });
    }

    if (params.kind === "url" && params.urlGlob === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL waits require urlGlob.",
        path: ["urlGlob"],
      });
    }

    if (params.kind !== "url" && params.urlGlob !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only URL waits accept urlGlob.",
        path: ["urlGlob"],
      });
    }

    if (params.kind === "function" && params.expression === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Function waits require expression.",
        path: ["expression"],
      });
    }

    if (params.kind !== "function" && params.expression !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only function waits accept expression.",
        path: ["expression"],
      });
    }

    if (
      params.kind !== "download" &&
      (params.downloadId !== undefined || params.filenameGlob !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only download waits accept download criteria.",
        path: params.downloadId === undefined ? ["filenameGlob"] : ["downloadId"],
      });
    }

    if (
      params.kind === "load-state" &&
      params.state !== "domcontentloaded" &&
      params.state !== "complete" &&
      params.state !== "networkidle"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Load-state waits require domcontentloaded, complete, or networkidle state.",
        path: ["state"],
      });
    }

    if (params.kind !== "element" && params.kind !== "load-state" && params.state !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only element and load-state waits accept state.",
        path: ["state"],
      });
    }

    if (params.kind !== "element" && (params.selector !== undefined || params.ref !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only element waits accept selector or ref.",
        path: params.selector === undefined ? ["ref"] : ["selector"],
      });
    }

    if (params.ref === undefined && params.generationId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Generation IDs apply only to refs.",
        path: ["generationId"],
      });
    }
  });
export type WaitParams = z.infer<typeof waitParamsSchema>;

const waitBaseResultSchema = z
  .object({
    target: resolvedTargetSchema.optional(),
    matched: z.literal(true),
    elapsedMs: z.number().int().nonnegative(),
  })
  .strict();

export const waitResultSchema = z.discriminatedUnion("kind", [
  waitBaseResultSchema.extend({ kind: z.literal("ms") }).strict(),
  waitBaseResultSchema
    .extend({
      kind: z.literal("element"),
      element: waitElementSummarySchema.optional(),
    })
    .strict(),
  waitBaseResultSchema.extend({ kind: z.literal("text"), value: z.string() }).strict(),
  waitBaseResultSchema.extend({ kind: z.literal("url"), value: z.string() }).strict(),
  waitBaseResultSchema.extend({ kind: z.literal("function"), value: getValueSchema }).strict(),
  waitBaseResultSchema.extend({ kind: z.literal("load-state") }).strict(),
  waitBaseResultSchema
    .extend({
      kind: z.literal("download"),
      download: z
        .object({
          id: z.number().int(),
          filename: z.string().optional(),
          state: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type WaitResult = z.infer<typeof waitResultSchema>;

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

const elementTargetRefinement = (
  params: {
    readonly selector?: string | undefined;
    readonly ref?: string | undefined;
    readonly generationId?: string | undefined;
  },
  context: z.RefinementCtx,
): void => {
  if ((params.selector === undefined) === (params.ref === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Element actions require exactly one selector or ref.",
      path: ["selector"],
    });
  }

  if (params.ref === undefined && params.generationId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
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
        code: z.ZodIssueCode.custom,
        message: "Scroll actions accept at most one selector or ref.",
        path: ["selector"],
      });
    }

    if (params.ref === undefined && params.generationId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
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

const elementActionResultSchemaFor = <A extends ActionKind>(action: A) =>
  actionBaseResultSchema
    .extend({
      action: z.literal(action),
      element: waitElementSummarySchema,
    })
    .strict();

const textActionResultSchemaFor = <A extends ActionKind>(action: A) =>
  elementActionResultSchemaFor(action)
    .extend({
      valueLength: z.number().int().nonnegative(),
    })
    .strict();

const selectActionResultSchema = elementActionResultSchemaFor("select")
  .extend({
    selectedValues: z.array(z.string()),
  })
  .strict();

const scrollActionResultSchemaFor = <A extends ActionKind>(action: A) =>
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

function addUploadTotalIssue(
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
  })
  .strict();
export type ConsoleResult = z.infer<typeof consoleResultSchema>;

export const errorsParamsSchema = consoleParamsSchema;
export const errorsResultSchema = z
  .object({
    action: z.enum(logActions),
    ok: z.literal(true),
    errors: z.array(consoleEntrySchema).optional(),
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

export type CommandOwner = "native-host" | "extension";
export type CommandTargetPolicy = "none" | "optional" | "required" | "mixed";
export type CommandContentPolicy = "never" | "always" | "mixed" | "action";
export type CommandTimeoutPolicy = "none" | "command" | "batch";

export type CliRouteMetadata = {
  readonly id: string;
  readonly path: readonly [string, ...string[]];
  readonly batch: boolean;
};

type CommandBatchMetadata = {
  readonly allowed: boolean;
  readonly protocolDefaultTarget?: boolean;
  readonly extensionDefaultTarget?: boolean;
  readonly timeoutRebase?: boolean;
};

type CommandSchemaMetadata = {
  readonly owner: CommandOwner;
  readonly target: CommandTargetPolicy;
  readonly content: CommandContentPolicy;
  readonly action: boolean;
  readonly timeout: CommandTimeoutPolicy;
  readonly batch: CommandBatchMetadata;
  readonly cliRoutes: readonly CliRouteMetadata[];
};

type CommandSchemaEntry = CommandSchemaMetadata & {
  readonly params: z.ZodType;
  readonly result: z.ZodType;
  readonly status: CapabilityStatus;
};

export const batchStepSchema = z
  .object({
    command: z.string().min(1),
    params: z.unknown().default({}),
  })
  .strict()
  .superRefine((step, context) => {
    if (!isCommandId(step.command)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown batch command: ${step.command}`,
        path: ["command"],
      });
      return;
    }

    if (!isBatchableCommandId(step.command)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Command cannot run inside batch: ${step.command}`,
        path: ["command"],
      });
      return;
    }

    const params = commandSchemas[step.command].params.safeParse(step.params);
    const paramsWithDefaultTarget = batchStepParamsWithDefaultTarget(step.command, step.params);
    const fallbackParams =
      params.success || paramsWithDefaultTarget === undefined
        ? params
        : commandSchemas[step.command].params.safeParse(paramsWithDefaultTarget);
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
export type BatchStep = z.infer<typeof batchStepSchema>;

export const batchParamsSchema = z
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
export type BatchParams = z.infer<typeof batchParamsSchema>;

const batchStepResultBaseSchema = z
  .object({
    index: z.number().int().nonnegative(),
    command: z.string().min(1),
  })
  .strict();

export const batchStepResultSchema = z
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
    if (!isCommandId(step.command)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown batch result command: ${step.command}`,
        path: ["command"],
      });
      return;
    }

    if (!isBatchableCommandId(step.command)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Command cannot appear in batch results: ${step.command}`,
        path: ["command"],
      });
      return;
    }

    if (step.ok) {
      const result = commandSchemas[step.command].result.safeParse(step.result);
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
export type BatchStepResult = z.infer<typeof batchStepResultSchema>;

export const batchResultSchema = z
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
export type BatchResult = z.infer<typeof batchResultSchema>;

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

export const commandSchemas = {
  hello: {
    params: helloParamsSchema,
    result: helloResultSchema,
    status: "mvp",
    owner: "native-host",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [],
  },
  capabilities: {
    params: capabilitiesParamsSchema,
    result: capabilitiesResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [{ id: "capabilities", path: ["capabilities"], batch: false }],
  },
  noop: {
    params: noOpParamsSchema,
    result: noOpResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [],
  },
  "tabs.list": {
    params: tabsListParamsSchema,
    result: tabsListResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "tab.list", path: ["tab"], batch: true }],
  },
  "tab.new": {
    params: tabNewParamsSchema,
    result: tabNewResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "tab.new", path: ["tab", "new"], batch: true }],
  },
  "tab.select": {
    params: tabTargetParamsSchema,
    result: tabNewResultSchema,
    status: "mvp",
    owner: "extension",
    target: "required",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, protocolDefaultTarget: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "tab.select", path: ["tab", "select"], batch: true }],
  },
  "tab.close": {
    params: tabTargetParamsSchema,
    result: tabCloseResultSchema,
    status: "mvp",
    owner: "extension",
    target: "required",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, protocolDefaultTarget: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "tab.close", path: ["tab", "close"], batch: true }],
  },
  "windows.list": {
    params: windowsListParamsSchema,
    result: windowsListResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true },
    cliRoutes: [{ id: "window.list", path: ["window"], batch: true }],
  },
  "window.new": {
    params: windowNewParamsSchema,
    result: windowNewResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true },
    cliRoutes: [{ id: "window.new", path: ["window", "new"], batch: true }],
  },
  "window.select": {
    params: windowTargetParamsSchema,
    result: windowSelectResultSchema,
    status: "mvp",
    owner: "extension",
    target: "required",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, protocolDefaultTarget: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "window.select", path: ["window", "select"], batch: true }],
  },
  "window.close": {
    params: windowTargetParamsSchema,
    result: windowCloseResultSchema,
    status: "mvp",
    owner: "extension",
    target: "required",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, protocolDefaultTarget: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "window.close", path: ["window", "close"], batch: true }],
  },
  open: {
    params: openParamsSchema,
    result: navigationResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "open", path: ["open"], batch: true }],
  },
  back: {
    params: navigationParamsSchema,
    result: navigationResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "back", path: ["back"], batch: true }],
  },
  forward: {
    params: navigationParamsSchema,
    result: navigationResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "forward", path: ["forward"], batch: true }],
  },
  reload: {
    params: navigationParamsSchema,
    result: navigationResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "reload", path: ["reload"], batch: true }],
  },
  snapshot: {
    params: snapshotParamsSchema,
    result: snapshotResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "snapshot", path: ["snapshot"], batch: true }],
  },
  "ref.resolve": {
    params: refResolveParamsSchema,
    result: refResolveResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "ref", path: ["ref"], batch: true }],
  },
  get: {
    params: getParamsSchema,
    result: getResultSchema,
    status: "mvp",
    owner: "extension",
    target: "mixed",
    content: "mixed",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "get", path: ["get"], batch: true }],
  },
  is: {
    params: isParamsSchema,
    result: isResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "is", path: ["is"], batch: true }],
  },
  wait: {
    params: waitParamsSchema,
    result: waitResultSchema,
    status: "mvp",
    owner: "extension",
    target: "mixed",
    content: "mixed",
    action: false,
    timeout: "command",
    batch: { allowed: true, extensionDefaultTarget: true, timeoutRebase: true },
    cliRoutes: [{ id: "wait", path: ["wait"], batch: true }],
  },
  eval: {
    params: evalParamsSchema,
    result: evalResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "command",
    batch: { allowed: true, extensionDefaultTarget: true, timeoutRebase: true },
    cliRoutes: [{ id: "eval", path: ["eval"], batch: true }],
  },
  screenshot: {
    params: screenshotParamsSchema,
    result: screenshotResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "command",
    batch: { allowed: true, extensionDefaultTarget: true, timeoutRebase: true },
    cliRoutes: [{ id: "screenshot", path: ["screenshot"], batch: true }],
  },
  drag: {
    params: dragParamsSchema,
    result: actionResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "drag", path: ["drag"], batch: true }],
  },
  upload: {
    params: uploadParamsSchema,
    result: actionResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "upload", path: ["upload"], batch: true }],
  },
  mouse: {
    params: mouseParamsSchema,
    result: actionResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "mouse", path: ["mouse"], batch: true }],
  },
  keydown: {
    params: keyEventParamsSchema,
    result: actionResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "keydown", path: ["keydown"], batch: true }],
  },
  keyup: {
    params: keyEventParamsSchema,
    result: actionResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "keyup", path: ["keyup"], batch: true }],
  },
  find: {
    params: findParamsSchema,
    result: findResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "find", path: ["find"], batch: true }],
  },
  frame: {
    params: frameParamsSchema,
    result: frameResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "frame", path: ["frame"], batch: true }],
  },
  download: {
    params: downloadParamsSchema,
    result: downloadResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true },
    cliRoutes: [{ id: "download", path: ["download"], batch: true }],
  },
  dialog: {
    params: dialogParamsSchema,
    result: dialogResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "dialog", path: ["dialog"], batch: true }],
  },
  clipboard: {
    params: clipboardParamsSchema,
    result: clipboardResultSchema,
    status: "mvp",
    owner: "extension",
    target: "mixed",
    content: "mixed",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "clipboard", path: ["clipboard"], batch: true }],
  },
  cookies: {
    params: cookieParamsSchema,
    result: cookieResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true },
    cliRoutes: [{ id: "cookies", path: ["cookies"], batch: true }],
  },
  storage: {
    params: storageParamsSchema,
    result: storageResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "storage", path: ["storage"], batch: true }],
  },
  network: {
    params: networkParamsSchema,
    result: networkResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true },
    cliRoutes: [{ id: "network", path: ["network"], batch: true }],
  },
  console: {
    params: consoleParamsSchema,
    result: consoleResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "console", path: ["console"], batch: true }],
  },
  errors: {
    params: errorsParamsSchema,
    result: errorsResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "errors", path: ["errors"], batch: true }],
  },
  highlight: {
    params: highlightParamsSchema,
    result: highlightResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "always",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "highlight", path: ["highlight"], batch: true }],
  },
  pdf: {
    params: pdfParamsSchema,
    result: pdfResultSchema,
    status: "unsupported",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true },
    cliRoutes: [{ id: "pdf", path: ["pdf"], batch: true }],
  },
  "set.viewport": {
    params: setViewportParamsSchema,
    result: setViewportResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "set.viewport", path: ["set", "viewport"], batch: true }],
  },
  diff: {
    params: diffParamsSchema,
    result: diffResultSchema,
    status: "mvp",
    owner: "extension",
    target: "mixed",
    content: "mixed",
    action: false,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "diff", path: ["diff"], batch: true }],
  },
  batch: {
    params: batchParamsSchema,
    result: batchResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "never",
    action: false,
    timeout: "batch",
    batch: { allowed: false },
    cliRoutes: [{ id: "batch", path: ["batch"], batch: false }],
  },
  click: {
    params: elementActionParamsSchema,
    result: elementActionResultSchemaFor("click"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "click", path: ["click"], batch: true }],
  },
  dblclick: {
    params: elementActionParamsSchema,
    result: elementActionResultSchemaFor("dblclick"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "dblclick", path: ["dblclick"], batch: true }],
  },
  focus: {
    params: elementActionParamsSchema,
    result: elementActionResultSchemaFor("focus"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "focus", path: ["focus"], batch: true }],
  },
  hover: {
    params: elementActionParamsSchema,
    result: elementActionResultSchemaFor("hover"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "hover", path: ["hover"], batch: true }],
  },
  fill: {
    params: textActionParamsSchema,
    result: textActionResultSchemaFor("fill"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "fill", path: ["fill"], batch: true }],
  },
  type: {
    params: textActionParamsSchema,
    result: textActionResultSchemaFor("type"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "type", path: ["type"], batch: true }],
  },
  press: {
    params: pressParamsSchema,
    result: elementActionResultSchemaFor("press"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "press", path: ["press"], batch: true }],
  },
  "keyboard.type": {
    params: keyboardTextActionParamsSchema,
    result: textActionResultSchemaFor("keyboard.type"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "keyboard.type", path: ["keyboard", "type"], batch: true }],
  },
  "keyboard.inserttext": {
    params: keyboardTextActionParamsSchema,
    result: textActionResultSchemaFor("keyboard.inserttext"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "keyboard.inserttext", path: ["keyboard", "inserttext"], batch: true }],
  },
  check: {
    params: elementActionParamsSchema,
    result: elementActionResultSchemaFor("check"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "check", path: ["check"], batch: true }],
  },
  uncheck: {
    params: elementActionParamsSchema,
    result: elementActionResultSchemaFor("uncheck"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "uncheck", path: ["uncheck"], batch: true }],
  },
  select: {
    params: selectParamsSchema,
    result: selectActionResultSchema,
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "select", path: ["select"], batch: true }],
  },
  scroll: {
    params: scrollParamsSchema,
    result: scrollActionResultSchemaFor("scroll"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "scroll", path: ["scroll"], batch: true }],
  },
  scrollintoview: {
    params: elementActionParamsSchema,
    result: elementActionResultSchemaFor("scrollintoview"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "scrollintoview", path: ["scrollintoview"], batch: true }],
  },
  swipe: {
    params: scrollParamsSchema,
    result: scrollActionResultSchemaFor("swipe"),
    status: "mvp",
    owner: "extension",
    target: "optional",
    content: "action",
    action: true,
    timeout: "none",
    batch: { allowed: true, extensionDefaultTarget: true },
    cliRoutes: [{ id: "swipe", path: ["swipe"], batch: true }],
  },
  "pair.approve": {
    params: pairApproveParamsSchema,
    result: pairApproveResultSchema,
    status: "mvp",
    owner: "native-host",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [],
  },
  "pair.reset": {
    params: pairResetParamsSchema,
    result: pairResetResultSchema,
    status: "mvp",
    owner: "native-host",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [],
  },
} as const satisfies Record<string, CommandSchemaEntry>;

export type CommandId = keyof typeof commandSchemas;

type CommandsWithContentPolicy<P extends CommandContentPolicy> = {
  readonly [C in CommandId]: (typeof commandSchemas)[C]["content"] extends P ? C : never;
}[CommandId];

export type ContentCommandId = CommandsWithContentPolicy<"always" | "mixed" | "action">;

export type RequestEnvelope<C extends CommandId = CommandId> = {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly id: string;
  readonly command: C;
  readonly params: z.infer<(typeof commandSchemas)[C]["params"]>;
};

export type ResponseEnvelope<C extends CommandId = CommandId> =
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly id: string;
      readonly ok: true;
      readonly result: z.infer<(typeof commandSchemas)[C]["result"]>;
    }
  | {
      readonly protocolVersion: typeof PROTOCOL_VERSION;
      readonly id: string;
      readonly ok: false;
      readonly error: ProtocolError;
    };

const requestEnvelopeSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    id: z.string().min(1),
    command: z.string().min(1),
    params: z.unknown(),
  })
  .strict();

const responseEnvelopeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      protocolVersion: z.number().int().positive(),
      id: z.string().min(1),
      ok: z.literal(true),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.number().int().positive(),
      id: z.string().min(1),
      ok: z.literal(false),
      error: z.unknown(),
    })
    .strict(),
]);

export type GatedCapabilitySummary = CapabilitySummary & {
  readonly cliCommands?: readonly string[];
};

export const gatedCapabilities: readonly GatedCapabilitySummary[] = [
  {
    command: "screenshot --full",
    status: "unsupported",
    reason:
      "full-page screenshots are unsupported because Firefox WebExtensions expose visible-tab capture only.",
  },
  {
    command: "close",
    status: "unsupported",
    reason: "top-level close is unsupported; use explicit tab close or window close.",
    cliCommands: ["close"],
  },
  {
    command: "quit",
    status: "unsupported",
    reason:
      "quit is unsupported because firefox-cli must not terminate the user's Firefox process.",
    cliCommands: ["quit"],
  },
  {
    command: "exit",
    status: "unsupported",
    reason:
      "exit is unsupported because firefox-cli must not terminate the user's Firefox process.",
    cliCommands: ["exit"],
  },
  {
    command: "connect",
    status: "unsupported",
    reason: "connect is unsupported because Firefox does not provide Chrome CDP attach semantics.",
    cliCommands: ["connect"],
  },
  {
    command: "inspect",
    status: "unsupported",
    reason: "inspect is unsupported because Firefox does not expose agent-browser CDP inspection.",
    cliCommands: ["inspect"],
  },
] as const;

export const kernelCapabilities: readonly CapabilitySummary[] = [
  ...Object.entries(commandSchemas).map(([command, schema]) => ({
    command,
    status: schema.status,
  })),
  ...gatedCapabilities.map(({ cliCommands: _cliCommands, ...capability }) => capability),
];

export function parseBoundaryRequest(
  boundary: Boundary,
  raw: unknown,
): ParseResult<RequestEnvelope> {
  const boundaryValidation = boundarySchema.safeParse(boundary);
  if (!boundaryValidation.success) {
    return failure("INVALID_ENVELOPE", "Unknown protocol boundary.", { boundary });
  }

  const decoded = decodeRaw(raw);
  if (!decoded.ok) {
    return decoded;
  }

  const envelope = requestEnvelopeSchema.safeParse(decoded.value);
  if (!envelope.success) {
    return failure("INVALID_ENVELOPE", "Request envelope is invalid.", {
      issues: envelope.error.issues,
    });
  }

  if (envelope.data.protocolVersion !== PROTOCOL_VERSION) {
    return failure("VERSION_MISMATCH", "Protocol version is not supported.", {
      received: envelope.data.protocolVersion,
      supported: PROTOCOL_VERSION,
    });
  }

  if (!isCommandId(envelope.data.command)) {
    return failure("UNKNOWN_COMMAND", `Unknown command: ${envelope.data.command}`, {
      command: envelope.data.command,
    });
  }

  const params = commandSchemas[envelope.data.command].params.safeParse(envelope.data.params);
  if (!params.success) {
    return failure("INVALID_ENVELOPE", "Command params are invalid.", {
      command: envelope.data.command,
      issues: params.error.issues,
    });
  }

  return {
    ok: true,
    value: {
      protocolVersion: PROTOCOL_VERSION,
      id: envelope.data.id,
      command: envelope.data.command,
      params: params.data,
    },
  };
}

export function parseBoundaryResponse(
  boundary: Boundary,
  command: CommandId,
  raw: unknown,
): ParseResult<ResponseEnvelope> {
  const boundaryValidation = boundarySchema.safeParse(boundary);
  if (!boundaryValidation.success) {
    return failure("INVALID_RESPONSE", "Unknown protocol boundary.", { boundary });
  }

  const decoded = decodeRaw(raw);
  if (!decoded.ok) {
    return decoded;
  }

  const envelope = responseEnvelopeSchema.safeParse(decoded.value);
  if (!envelope.success) {
    return failure("INVALID_RESPONSE", "Response envelope is invalid.", {
      issues: envelope.error.issues,
    });
  }

  if (envelope.data.protocolVersion !== PROTOCOL_VERSION) {
    return failure("VERSION_MISMATCH", "Protocol version is not supported.", {
      received: envelope.data.protocolVersion,
      supported: PROTOCOL_VERSION,
    });
  }

  if (envelope.data.ok) {
    const result = commandSchemas[command].result.safeParse(envelope.data.result);
    if (!result.success) {
      return failure("INVALID_RESPONSE", "Command result is invalid.", {
        command,
        issues: result.error.issues,
      });
    }

    return {
      ok: true,
      value: {
        protocolVersion: PROTOCOL_VERSION,
        id: envelope.data.id,
        ok: true,
        result: result.data,
      },
    };
  }

  const error = protocolErrorSchema.safeParse(envelope.data.error);
  if (!error.success) {
    return failure("INVALID_RESPONSE", "Error response is invalid.", {
      issues: error.error.issues,
    });
  }

  return {
    ok: true,
    value: {
      protocolVersion: PROTOCOL_VERSION,
      id: envelope.data.id,
      ok: false,
      error: error.data,
    },
  };
}

export function createRequest<C extends CommandId>(
  command: C,
  params: z.infer<(typeof commandSchemas)[C]["params"]>,
  id: string = crypto.randomUUID(),
): RequestEnvelope<C> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    command,
    params,
  };
}

export function createOkResponse<C extends CommandId>(
  request: RequestEnvelope<C>,
  result: z.infer<(typeof commandSchemas)[C]["result"]>,
): ResponseEnvelope<C> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: request.id,
    ok: true,
    result,
  };
}

export function createErrorResponse(id: string, error: ProtocolError): ResponseEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    ok: false,
    error,
  };
}

function decodeRaw(raw: unknown): ParseResult<unknown> {
  if (typeof raw !== "string") {
    return { ok: true, value: raw };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return failure("INVALID_JSON", "Payload is not valid JSON.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function failure(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ParseResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function isCommandId(command: string): command is CommandId {
  return Object.hasOwn(commandSchemas, command);
}

export function getCommandCliRoutes(command: CommandId): readonly CliRouteMetadata[] {
  return commandSchemas[command].cliRoutes;
}

export function getCliRoutes(): readonly CliRouteMetadata[] {
  return Object.values(commandSchemas).flatMap(
    (schema): readonly CliRouteMetadata[] => schema.cliRoutes,
  );
}

export function isBatchableCommandId(command: string): command is CommandId {
  return isCommandId(command) && commandSchemas[command].batch.allowed;
}

export function commandAcceptsProtocolBatchDefaultTarget(command: string): command is CommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const batch: CommandBatchMetadata = commandSchemas[command].batch;
  return batch.protocolDefaultTarget === true;
}

export function commandAcceptsExtensionBatchDefaultTarget(command: string): command is CommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const batch: CommandBatchMetadata = commandSchemas[command].batch;
  return batch.extensionDefaultTarget === true;
}

export function commandAcceptsBatchTimeout(command: string): command is CommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const batch: CommandBatchMetadata = commandSchemas[command].batch;
  return batch.timeoutRebase === true;
}

export function isActionCommand(command: string): command is ActionKind {
  return isCommandId(command) && commandSchemas[command].action;
}

export function isContentCommand(command: string): command is ContentCommandId {
  if (!isCommandId(command)) {
    return false;
  }
  const content = commandSchemas[command].content;
  return content === "always" || content === "mixed" || content === "action";
}

function batchStepParamsWithDefaultTarget(
  command: CommandId,
  params: unknown,
): unknown | undefined {
  if (!commandAcceptsProtocolBatchDefaultTarget(command) || !isRecord(params)) {
    return undefined;
  }

  if (params.target !== undefined) {
    return undefined;
  }

  return {
    ...params,
    target: {
      window: { kind: "active" },
      tab: { kind: "active" },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
