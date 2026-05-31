import {
  createProtocolStateErrorResponse as createSharedProtocolStateErrorResponse,
  getNegotiatedProtocolSession,
  getProtocolMessageId,
  getProtocolMessageVersion,
  isProtocolResponseLike,
  isUnknownRequestCommand,
  type ProtocolConnectionState,
  type ProtocolError,
  type ProtocolSession,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";

export type NativeProtocolState = ProtocolConnectionState;

export function getNegotiatedNativeSession(
  state: NativeProtocolState,
): { readonly ok: true; readonly value: ProtocolSession } | { readonly ok: false; readonly error: ProtocolError } {
  return getNegotiatedProtocolSession(state, {
    code: "NATIVE_HOST_UNAVAILABLE",
    message: "Native host protocol negotiation has not completed.",
  });
}

export function createProtocolStateErrorResponse(state: NativeProtocolState, id: string, error: ProtocolError): ResponseEnvelope {
  return createSharedProtocolStateErrorResponse(state, id, error);
}

export function isResponseLike(message: unknown): message is { readonly id: string } {
  return isProtocolResponseLike(message);
}

export function getMessageId(message: unknown): string {
  return getProtocolMessageId(message);
}

export function getMessageProtocolVersion(message: unknown): number {
  return getProtocolMessageVersion(message);
}

export function isRequestCommand(message: unknown, command: string): boolean {
  return isUnknownRequestCommand(message, command);
}
