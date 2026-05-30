import {
  createProtocolSession,
  localProtocolVersionRange,
  type ProtocolError,
  type ProtocolSession,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";

export type NativeProtocolState =
  | { readonly state: "disconnected" }
  | { readonly state: "negotiating" }
  | { readonly state: "negotiated"; readonly session: ProtocolSession }
  | { readonly state: "incompatible"; readonly error: ProtocolError };

export function getNegotiatedNativeSession(
  state: NativeProtocolState,
):
  | { readonly ok: true; readonly value: ProtocolSession }
  | { readonly ok: false; readonly error: ProtocolError } {
  if (state.state === "negotiated") {
    return { ok: true, value: state.session };
  }

  if (state.state === "incompatible") {
    return { ok: false, error: state.error };
  }

  return {
    ok: false,
    error: {
      code: "NATIVE_HOST_UNAVAILABLE",
      message: "Native host protocol negotiation has not completed.",
    },
  };
}

export function createProtocolStateErrorResponse(
  state: NativeProtocolState,
  id: string,
  error: ProtocolError,
): ResponseEnvelope {
  return getNativeProtocolSession(state).createErrorResponse(id, error);
}

export function isResponseLike(message: unknown): message is { readonly id: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    "ok" in message &&
    typeof message.id === "string"
  );
}

export function getMessageId(message: unknown): string {
  return typeof message === "object" &&
    message !== null &&
    "id" in message &&
    typeof message.id === "string"
    ? message.id
    : "invalid-request";
}

export function getMessageProtocolVersion(message: unknown): number {
  return typeof message === "object" &&
    message !== null &&
    "protocolVersion" in message &&
    typeof message.protocolVersion === "number"
    ? message.protocolVersion
    : localProtocolVersionRange.protocolMax;
}

export function isRequestCommand(message: unknown, command: string): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "command" in message &&
    message.command === command
  );
}

function getNativeProtocolSession(state: NativeProtocolState): ProtocolSession {
  return state.state === "negotiated"
    ? state.session
    : createProtocolSession(localProtocolVersionRange.protocolMax);
}
