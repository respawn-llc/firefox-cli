import { z } from "zod";

import { PRODUCT_NAME, PROTOCOL_MAX_VERSION, PROTOCOL_MIN_VERSION } from "./constants.js";

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

export type ProtocolVersionRange = {
  readonly protocolMin: number;
  readonly protocolMax: number;
};

export const localProtocolVersionRange: ProtocolVersionRange = {
  protocolMin: PROTOCOL_MIN_VERSION,
  protocolMax: PROTOCOL_MAX_VERSION,
};

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

export const componentIdentitySchema = z
  .object({
    component: componentSchema,
    productName: z.literal(PRODUCT_NAME),
    productVersion: z.string().min(1),
    protocolMin: z.number().int().positive(),
    protocolMax: z.number().int().positive(),
    features: z.array(z.string().min(1)).default([]),
  })
  .superRefine((identity, context) => {
    if (identity.protocolMin > identity.protocolMax) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "protocolMin cannot be greater than protocolMax.",
        path: ["protocolMin"],
      });
    }
  });
export type ComponentIdentity = z.infer<typeof componentIdentitySchema>;

export const helloParamsSchema = componentIdentitySchema.extend({
  pairToken: z.string().min(1).optional(),
});
export const helloResultSchema = z
  .object({
    accepted: z.literal(true),
    negotiatedProtocolVersion: z.number().int().positive(),
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
  })
  .superRefine((result, context) => {
    if (!isProtocolVersionInRange(result.negotiatedProtocolVersion, result.peer)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Negotiated protocol version must be within the peer protocol range.",
        path: ["negotiatedProtocolVersion"],
      });
    }
  });

export const noOpParamsSchema = z.object({}).strict();
export const noOpResultSchema = z.object({
  ok: z.literal(true),
});

export const capabilitiesParamsSchema = z.object({}).strict();
export const capabilitiesResultSchema = z.object({
  capabilities: z.array(capabilitySchema),
});

export function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createLocalComponentIdentity(
  component: Component,
  productVersion: string,
  features: readonly string[] = [],
): ComponentIdentity {
  return {
    component,
    productName: PRODUCT_NAME,
    productVersion,
    protocolMin: PROTOCOL_MIN_VERSION,
    protocolMax: PROTOCOL_MAX_VERSION,
    features: [...features],
  };
}

export function isProtocolVersionInRange(
  protocolVersion: number,
  range: ProtocolVersionRange,
): boolean {
  return protocolVersion >= range.protocolMin && protocolVersion <= range.protocolMax;
}

export function negotiateProtocolVersion(
  local: ProtocolVersionRange,
  peer: ProtocolVersionRange,
): ParseResult<number> {
  const protocolMin = Math.max(local.protocolMin, peer.protocolMin);
  const protocolMax = Math.min(local.protocolMax, peer.protocolMax);

  if (protocolMin > protocolMax) {
    return {
      ok: false,
      error: createProtocolVersionMismatchError(local, peer),
    };
  }

  return { ok: true, value: protocolMax };
}

export function createProtocolVersionMismatchError(
  local: ProtocolVersionRange,
  peer: ProtocolVersionRange,
): ProtocolError {
  return {
    code: "VERSION_MISMATCH",
    message: "Protocol version ranges do not overlap.",
    details: {
      local: protocolRangeDetails(local),
      peer: protocolRangeDetails(peer),
    },
  };
}

export function protocolRangeDetails(range: ProtocolVersionRange): {
  readonly protocolMin: number;
  readonly protocolMax: number;
} {
  return {
    protocolMin: range.protocolMin,
    protocolMax: range.protocolMax,
  };
}
