import {
  createProtocolSession,
  getNegotiatedProtocolSession,
  localProtocolVersionRange,
  type ProtocolConnectionState,
  type ProtocolError,
  type ProtocolSession,
  type ScreenshotResult,
} from "@firefox-cli/protocol";
import type { ExtensionConnection } from "./host-broker.js";
import type { PairTokenVerification } from "./pair-state.js";

export function pairVerificationToProtocolError(verification: PairTokenVerification): ProtocolError {
  if (verification.ok) {
    return {
      code: "NOT_APPROVED",
      message: "Approve firefox-cli in the extension popup before running CLI commands.",
    };
  }

  return {
    code: verification.code === "NOT_APPROVED" || verification.code === "TOKEN_REQUIRED" ? "NOT_APPROVED" : "PAIRING_MISMATCH",
    message: verification.message,
  };
}

export function screenshotResultWithoutImage(result: ScreenshotResult): Omit<ScreenshotResult, "imageBase64"> {
  return {
    ...(result.target === undefined ? {} : { target: result.target }),
    path: result.path,
    format: result.format,
    bytes: result.bytes,
    ...(result.width === undefined ? {} : { width: result.width }),
    ...(result.height === undefined ? {} : { height: result.height }),
    activation: result.activation,
  };
}

export function getNegotiatedExtensionSession(
  connection: ExtensionConnection,
): { readonly ok: true; readonly value: ProtocolSession } | { readonly ok: false; readonly error: ProtocolError } {
  if (connection.protocolState === undefined) {
    return { ok: true, value: createProtocolSession(localProtocolVersionRange.protocolMax) };
  }

  return getNegotiatedProtocolSession(connection.protocolState, {
    code: "EXTENSION_NOT_CONNECTED",
    message: "Firefox extension protocol negotiation has not completed.",
  });
}

export type ExtensionProtocolState = Exclude<ProtocolConnectionState, { readonly state: "disconnected" }>;
