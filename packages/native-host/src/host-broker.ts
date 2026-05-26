import {
  PROTOCOL_VERSION,
  createErrorResponse,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import type { HostIdentity, PairTokenVerification } from "./pair-state.js";

export type ExtensionConnection = {
  readonly approved: boolean;
  readonly token: string | undefined;
  send(request: RequestEnvelope): Promise<unknown>;
};

export type NativeHostBrokerOptions = {
  readonly hostIdentity: HostIdentity;
  verifyPairToken?(
    token: string | undefined,
  ): Promise<PairTokenVerification> | PairTokenVerification;
};

export class NativeHostBroker {
  readonly #hostIdentity: HostIdentity;
  readonly #verifyPairToken?: NativeHostBrokerOptions["verifyPairToken"];
  #extensionConnection: ExtensionConnection | null = null;

  constructor(options: NativeHostBrokerOptions) {
    this.#hostIdentity = options.hostIdentity;
    this.#verifyPairToken = options.verifyPairToken;
  }

  get hostIdentity(): HostIdentity {
    return this.#hostIdentity;
  }

  connectExtension(connection: ExtensionConnection): void {
    this.#extensionConnection = connection;
  }

  disconnectExtension(connection: ExtensionConnection): void {
    if (this.#extensionConnection === connection) {
      this.#extensionConnection = null;
    }
  }

  async handleCliRequest(raw: unknown): Promise<ResponseEnvelope> {
    const parsed = parseBoundaryRequest("cli-to-host", raw);
    if (!parsed.ok) {
      return createErrorResponse("invalid-request", parsed.error);
    }

    const request = parsed.value;
    if (this.#extensionConnection === null) {
      return createErrorResponse(request.id, {
        code: "EXTENSION_NOT_CONNECTED",
        message: "Firefox extension is not connected to the native host.",
      });
    }

    if (!this.#extensionConnection.approved) {
      return createErrorResponse(request.id, {
        code: "NOT_APPROVED",
        message: "Approve firefox-cli in the extension popup before running CLI commands.",
      });
    }

    const pairVerification = await this.#verifyPairToken?.(this.#extensionConnection.token);
    if (pairVerification !== undefined && !pairVerification.ok) {
      return createErrorResponse(request.id, {
        code:
          pairVerification.code === "NOT_APPROVED" || pairVerification.code === "TOKEN_REQUIRED"
            ? "NOT_APPROVED"
            : "PAIRING_MISMATCH",
        message: pairVerification.message,
      });
    }

    const extensionResponse = await this.#extensionConnection.send(request);
    const response = parseBoundaryResponse("host-to-extension", request.command, extensionResponse);
    if (!response.ok) {
      return createErrorResponse(request.id, response.error);
    }

    return {
      protocolVersion: PROTOCOL_VERSION,
      id: request.id,
      ...(response.value.ok
        ? {
            ok: true,
            result: response.value.result,
          }
        : {
            ok: false,
            error: response.value.error,
          }),
    };
  }
}
