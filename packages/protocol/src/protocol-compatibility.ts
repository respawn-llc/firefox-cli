import { PROTOCOL_VERSION } from "./constants.js";
import type { ProtocolError } from "./core.js";

export type RequestProtocolCompatibility = {
  readonly compatible: boolean;
  readonly requiredProtocolVersion: number;
  readonly reason?: string;
};

type RequestProtocolSubject = {
  readonly command: string;
  readonly params: unknown;
  readonly protocolVersion?: number;
};

const SCOPED_NETWORK_PROTOCOL_VERSION = 2;

export function getRequestProtocolCompatibility(
  request: RequestProtocolSubject,
  protocolVersion: number = requestProtocolVersion(request),
): RequestProtocolCompatibility {
  const requiredProtocolVersion = getRequiredRequestProtocolVersion(request);
  return {
    compatible: protocolVersion >= requiredProtocolVersion,
    requiredProtocolVersion,
    ...(requiredProtocolVersion > 1 ? { reason: requiredProtocolReason(request) } : {}),
  };
}

export function createRequestProtocolMismatchError(
  request: RequestProtocolSubject,
  protocolVersion: number,
): ProtocolError {
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

function getRequiredRequestProtocolVersion(request: RequestProtocolSubject) {
  return requestUsesScopedNetworkSemantics(request) ? SCOPED_NETWORK_PROTOCOL_VERSION : 1;
}

function requestUsesScopedNetworkSemantics(request: RequestProtocolSubject): boolean {
  if (request.command === "network") {
    return true;
  }

  if (request.command === "wait" && isNetworkIdleWaitParams(request.params)) {
    return true;
  }

  if (request.command !== "batch" || !hasSteps(request.params)) {
    return false;
  }

  return request.params.steps.some((step) =>
    requestUsesScopedNetworkSemantics({
      command: step.command,
      params: step.params,
    }),
  );
}

function requiredProtocolReason(request: RequestProtocolSubject): string {
  if (request.command === "batch") {
    return "Batch contains scoped network command semantics.";
  }
  if (request.command === "wait") {
    return "Network-idle waits are scoped to the resolved tab.";
  }
  return "Network commands are scoped to the resolved tab.";
}

function requestProtocolVersion(request: { readonly protocolVersion?: number }): number {
  return request.protocolVersion ?? PROTOCOL_VERSION;
}

function isNetworkIdleWaitParams(params: unknown): boolean {
  return (
    typeof params === "object" &&
    params !== null &&
    "kind" in params &&
    params.kind === "load-state" &&
    "state" in params &&
    params.state === "networkidle"
  );
}

function hasSteps(params: unknown): params is {
  readonly steps: readonly { readonly command: string; readonly params: unknown }[];
} {
  return (
    typeof params === "object" &&
    params !== null &&
    "steps" in params &&
    Array.isArray(params.steps)
  );
}
