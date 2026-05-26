import { z } from "zod";

export const PRODUCT_NAME = "firefox-cli";
export const NATIVE_HOST_NAME = "firefox_cli";
export const FIREFOX_CLI_EXTENSION_ID = "firefox-cli@example.invalid";
export const PROTOCOL_VERSION = 1;

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
      generation: z.number().int().positive().optional(),
    })
    .strict()
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

export const getKindSchema = z.enum([
  "text",
  "html",
  "value",
  "attr",
  "title",
  "url",
  "count",
  "box",
  "styles",
]);
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

export const isKindSchema = z.enum(["visible", "enabled", "checked"]);
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
  },
  capabilities: {
    params: capabilitiesParamsSchema,
    result: capabilitiesResultSchema,
    status: "mvp",
  },
  noop: {
    params: noOpParamsSchema,
    result: noOpResultSchema,
    status: "mvp",
  },
  "tabs.list": {
    params: tabsListParamsSchema,
    result: tabsListResultSchema,
    status: "mvp",
  },
  "tab.new": {
    params: tabNewParamsSchema,
    result: tabNewResultSchema,
    status: "mvp",
  },
  "tab.select": {
    params: tabTargetParamsSchema,
    result: tabNewResultSchema,
    status: "mvp",
  },
  "tab.close": {
    params: tabTargetParamsSchema,
    result: tabCloseResultSchema,
    status: "mvp",
  },
  "windows.list": {
    params: windowsListParamsSchema,
    result: windowsListResultSchema,
    status: "mvp",
  },
  "window.new": {
    params: windowNewParamsSchema,
    result: windowNewResultSchema,
    status: "mvp",
  },
  "window.select": {
    params: windowTargetParamsSchema,
    result: windowSelectResultSchema,
    status: "mvp",
  },
  "window.close": {
    params: windowTargetParamsSchema,
    result: windowCloseResultSchema,
    status: "mvp",
  },
  open: {
    params: openParamsSchema,
    result: navigationResultSchema,
    status: "mvp",
  },
  back: {
    params: navigationParamsSchema,
    result: navigationResultSchema,
    status: "mvp",
  },
  forward: {
    params: navigationParamsSchema,
    result: navigationResultSchema,
    status: "mvp",
  },
  reload: {
    params: navigationParamsSchema,
    result: navigationResultSchema,
    status: "mvp",
  },
  snapshot: {
    params: snapshotParamsSchema,
    result: snapshotResultSchema,
    status: "mvp",
  },
  "ref.resolve": {
    params: refResolveParamsSchema,
    result: refResolveResultSchema,
    status: "mvp",
  },
  get: {
    params: getParamsSchema,
    result: getResultSchema,
    status: "mvp",
  },
  is: {
    params: isParamsSchema,
    result: isResultSchema,
    status: "mvp",
  },
  "pair.approve": {
    params: pairApproveParamsSchema,
    result: pairApproveResultSchema,
    status: "mvp",
  },
  "pair.reset": {
    params: pairResetParamsSchema,
    result: pairResetResultSchema,
    status: "mvp",
  },
} as const satisfies Record<
  string,
  {
    readonly params: z.ZodType;
    readonly result: z.ZodType;
    readonly status: CapabilityStatus;
  }
>;

export type CommandId = keyof typeof commandSchemas;

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

export const kernelCapabilities: readonly CapabilitySummary[] = Object.entries(commandSchemas).map(
  ([command, schema]) => ({
    command,
    status: schema.status,
  }),
);

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
  return command in commandSchemas;
}
