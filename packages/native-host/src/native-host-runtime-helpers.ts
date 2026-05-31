import {
  createProtocolSession,
  getNegotiatedProtocolSession,
  localProtocolVersionRange,
  type ProtocolConnectionState,
  type ProtocolSession,
} from "@firefox-cli/protocol";
import type { NativeMessagingPairingController } from "./native-host-runtime.js";
import type { PairStateStatus, PairTokenVerification } from "./pair-state.js";

export type ExtensionProtocolState = Exclude<ProtocolConnectionState, { readonly state: "disconnected" }>;

export function getNativeProtocolSession(state: ExtensionProtocolState): ProtocolSession {
  const result = getNegotiatedProtocolSession(state, {
    code: "EXTENSION_NOT_CONNECTED",
    message: "Firefox extension protocol negotiation has not completed.",
  });
  return result.ok ? result.value : createProtocolSession(localProtocolVersionRange.protocolMax);
}

export function helloPairingResult(
  pairing: NativeMessagingPairingController | undefined,
  pairState: PairStateStatus | undefined,
  pairVerification: PairTokenVerification | undefined,
): {
  readonly pairing?: {
    readonly hostId: string;
    readonly extensionId: string;
    readonly approved: boolean;
    readonly status: "approved" | "not-approved" | "invalid-pair-state";
    readonly message?: string;
    readonly generation?: number;
  };
} {
  if (pairing === undefined) {
    return {};
  }

  return {
    pairing: {
      hostId: pairing.hostIdentity.hostId,
      extensionId: pairing.hostIdentity.extensionId,
      approved: pairVerification?.ok ?? false,
      status: helloPairingStatus(pairState, pairVerification),
      ...(pairVerification === undefined || pairVerification.ok ? {} : { message: pairVerification.message }),
      ...(pairState?.status === "valid" ? { generation: pairState.state.generation } : {}),
    },
  };
}

function helloPairingStatus(
  state: PairStateStatus | undefined,
  verification: PairTokenVerification | undefined,
): "approved" | "not-approved" | "invalid-pair-state" {
  if (verification?.ok) {
    return "approved";
  }

  return state?.status === "invalid" ? "invalid-pair-state" : "not-approved";
}
