import { PROTOCOL_VERSION } from "./constants.js";
import type { ProtocolError } from "./core.js";
import { getRequestProtocolRequirement, isCommandId } from "./registry/index.js";

export interface RequestProtocolCompatibility {
  readonly compatible: boolean;
  readonly requiredProtocolVersion: number;
  readonly reason?: string;
}

interface RequestProtocolSubject {
  readonly command: string;
  readonly params: unknown;
  readonly protocolVersion?: number;
}

export function getRequestProtocolCompatibility(
  request: RequestProtocolSubject,
  protocolVersion: number = requestProtocolVersion(request),
): RequestProtocolCompatibility {
  const requirement = getRequestProtocolRequirementForSubject(request);
  const requiredProtocolVersion = requirement?.minProtocolVersion ?? 1;
  return {
    compatible: protocolVersion >= requiredProtocolVersion,
    requiredProtocolVersion,
    ...(requirement === undefined ? {} : { reason: requirement.reason }),
  };
}

export function createRequestProtocolMismatchError(request: RequestProtocolSubject, protocolVersion: number): ProtocolError {
  const compatibility = getRequestProtocolCompatibility(request, protocolVersion);
  return {
    code: "VERSION_MISMATCH",
    message: "Request requires a newer protocol version than the negotiated session.",
    details: {
      command: request.command,
      requiredProtocolVersion: compatibility.requiredProtocolVersion,
      negotiatedProtocolVersion: protocolVersion,
      ...(compatibility.reason === undefined ? {} : { reason: compatibility.reason }),
    },
  };
}

function requestProtocolVersion(request: { readonly protocolVersion?: number }): number {
  return request.protocolVersion ?? PROTOCOL_VERSION;
}

function getRequestProtocolRequirementForSubject(
  request: RequestProtocolSubject,
): { readonly minProtocolVersion: number; readonly reason: string } | undefined {
  if (request.command === "batch" && hasSteps(request.params)) {
    const childRequirement = request.params.steps.reduce<{ readonly minProtocolVersion: number; readonly reason: string } | undefined>((highest, step) => {
      const requirement = getRequestProtocolRequirementForSubject({
        command: step.command,
        params: step.params,
      });
      if (requirement === undefined) {
        return highest;
      }
      if (highest === undefined) {
        return requirement;
      }
      return requirement.minProtocolVersion > highest.minProtocolVersion ? requirement : highest;
    }, undefined);
    return childRequirement === undefined
      ? undefined
      : {
          minProtocolVersion: childRequirement.minProtocolVersion,
          reason: childRequirement.reason,
        };
  }

  if (!isCommandId(request.command)) {
    return undefined;
  }

  return getRequestProtocolRequirement({
    command: request.command,
    params: request.params,
  });
}

function hasSteps(params: unknown): params is {
  readonly steps: readonly { readonly command: string; readonly params: unknown }[];
} {
  return typeof params === "object" && params !== null && "steps" in params && Array.isArray(params.steps);
}
