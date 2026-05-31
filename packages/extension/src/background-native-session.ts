import {
  createProtocolSession,
  localProtocolVersionRange,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type CommandId,
  type ProtocolError,
  type ProtocolSession,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import {
  createProtocolStateErrorResponse,
  getMessageId,
  getMessageProtocolVersion,
  getNegotiatedNativeSession,
  isRequestCommand,
  type NativeProtocolState,
} from "./background-native-protocol-state.js";

export class NativeSessionService {
  #state: NativeProtocolState = { state: "disconnected" };

  get stateName(): NativeProtocolState["state"] {
    return this.#state.state;
  }

  beginNegotiation(): void {
    this.#state = { state: "negotiating" };
  }

  markDisconnected(): void {
    this.#state = { state: "disconnected" };
  }

  getNegotiatedSession(): ReturnType<typeof getNegotiatedNativeSession> {
    return getNegotiatedNativeSession(this.#state);
  }

  parseResponse(command: CommandId, message: { readonly id: string }) {
    return command === "hello"
      ? parseBoundaryResponse("host-to-extension", command, message, {
          hello: {
            local: localProtocolVersionRange,
            expectedPeerComponent: "native-host",
          },
        })
      : parseBoundaryResponse("host-to-extension", command, message, {
          protocolVersion:
            this.#state.state === "negotiated"
              ? this.#state.session.protocolVersion
              : localProtocolVersionRange.protocolMax,
        });
  }

  applyResponseParseFailure(command: CommandId, error: ProtocolError): void {
    if (command === "hello") {
      this.setIncompatible(error);
    }
  }

  applyHelloResponse(response: ResponseEnvelope<"hello">): void {
    if (response.ok) {
      this.#state = {
        state: "negotiated",
        session: createProtocolSession(response.protocolVersion),
      };
    } else {
      this.setIncompatible(response.error);
    }
  }

  parseRequest(message: unknown) {
    return parseBoundaryRequest("host-to-extension", message, {
      ...(this.#state.state === "negotiated" ? { protocolVersion: this.#state.session.protocolVersion } : {}),
      hello: {
        local: localProtocolVersionRange,
        expectedPeerComponent: "native-host",
      },
    });
  }

  markRequestIncompatibleIfNeeded(message: unknown, code: string, error: ProtocolError): void {
    if (isRequestCommand(message, "hello") || code === "VERSION_MISMATCH") {
      this.setIncompatible(error);
    }
  }

  prepareRequest(
    request: RequestEnvelope,
  ):
    | { readonly ok: true; readonly protocolSession: ProtocolSession }
    | { readonly ok: false; readonly response: ResponseEnvelope } {
    const protocolSession = createProtocolSession(request.protocolVersion);
    if (request.command === "hello") {
      this.#state = { state: "negotiated", session: protocolSession };
      return { ok: true, protocolSession };
    }
    if (this.#state.state === "incompatible") {
      return {
        ok: false,
        response: protocolSession.createErrorResponse(request.id, this.#state.error),
      };
    }
    if (this.#state.state !== "negotiated") {
      return {
        ok: false,
        response: protocolSession.createErrorResponse(request.id, {
          code: "NATIVE_HOST_UNAVAILABLE",
          message: "Native host protocol negotiation has not completed.",
        }),
      };
    }
    return { ok: true, protocolSession };
  }

  setIncompatible(error: ProtocolError): void {
    this.#state = { state: "incompatible", error };
  }

  createStateErrorResponse(message: unknown, error: ProtocolError) {
    return createProtocolStateErrorResponse(this.#state, getMessageId(message), error);
  }

  getMessageProtocolVersion(message: unknown): number {
    return getMessageProtocolVersion(message);
  }
}
