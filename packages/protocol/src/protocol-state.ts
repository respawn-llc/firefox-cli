import { localProtocolVersionRange, type ProtocolError } from "./core.js";
import type { ResponseEnvelope } from "./envelopes.js";
import { createProtocolSession, type ProtocolSession } from "./envelopes-session.js";

export type ProtocolConnectionState =
  | { readonly state: "disconnected" }
  | { readonly state: "negotiating" }
  | { readonly state: "negotiated"; readonly session: ProtocolSession }
  | { readonly state: "incompatible"; readonly error: ProtocolError };

export function getNegotiatedProtocolSession(
  state: ProtocolConnectionState,
  unavailableError: ProtocolError,
): { readonly ok: true; readonly value: ProtocolSession } | { readonly ok: false; readonly error: ProtocolError } {
  if (state.state === "negotiated") {
    return { ok: true, value: state.session };
  }

  if (state.state === "incompatible") {
    return { ok: false, error: state.error };
  }

  return { ok: false, error: unavailableError };
}

export function createProtocolStateErrorResponse(state: ProtocolConnectionState, id: string, error: ProtocolError): ResponseEnvelope {
  return getProtocolSessionForState(state).createErrorResponse(id, error);
}

export function getProtocolSessionForState(state: ProtocolConnectionState): ProtocolSession {
  return state.state === "negotiated" ? state.session : createProtocolSession(localProtocolVersionRange.protocolMax);
}

export function isProtocolResponseLike(message: unknown): message is { readonly id: string } {
  return typeof message === "object" && message !== null && "id" in message && "ok" in message && typeof message.id === "string";
}

export function getProtocolMessageId(message: unknown): string {
  return typeof message === "object" && message !== null && "id" in message && typeof message.id === "string" ? message.id : "invalid-request";
}

export function getProtocolMessageVersion(message: unknown): number {
  return typeof message === "object" && message !== null && "protocolVersion" in message && typeof message.protocolVersion === "number"
    ? message.protocolVersion
    : localProtocolVersionRange.protocolMax;
}

export function isUnknownRequestCommand(message: unknown, command: string): boolean {
  return typeof message === "object" && message !== null && "command" in message && message.command === command;
}
