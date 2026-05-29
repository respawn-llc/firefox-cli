import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import {
  MAX_SCREENSHOT_BYTES,
  createLocalComponentIdentity,
  createRequestProtocolMismatchError,
  createProtocolSession,
  getRequestProtocolCompatibility,
  localProtocolVersionRange,
  parseBoundaryRequest,
  type BatchResult,
  type ProtocolError,
  type ProtocolSession,
  type ProtocolVersionRange,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ScreenshotParams,
  type ScreenshotResult,
} from "@firefox-cli/protocol";
import type { HostIdentity, PairTokenVerification } from "./pair-state.js";

export type ExtensionConnection = {
  readonly approved: boolean;
  readonly token: string | undefined;
  readonly pairingError?: PairTokenVerification | undefined;
  readonly protocolState?: ExtensionProtocolState;
  send(request: RequestEnvelope): Promise<unknown>;
};

export type ExtensionProtocolState =
  | { readonly state: "negotiating" }
  | { readonly state: "negotiated"; readonly session: ProtocolSession }
  | { readonly state: "incompatible"; readonly error: ProtocolError };

export type NativeHostBrokerOptions = {
  readonly hostIdentity: HostIdentity;
  readonly productVersion?: string;
  readonly protocolRange?: ProtocolVersionRange;
  writeFile?(path: string, data: Uint8Array): Promise<void>;
  verifyPairToken?(
    token: string | undefined,
  ): Promise<PairTokenVerification> | PairTokenVerification;
};

export class NativeHostBroker {
  readonly #hostIdentity: HostIdentity;
  readonly #productVersion: string;
  readonly #protocolRange: ProtocolVersionRange;
  readonly #verifyPairToken?: NativeHostBrokerOptions["verifyPairToken"];
  readonly #writeFile: NonNullable<NativeHostBrokerOptions["writeFile"]>;
  #extensionConnection: ExtensionConnection | null = null;

  constructor(options: NativeHostBrokerOptions) {
    this.#hostIdentity = options.hostIdentity;
    this.#productVersion = options.productVersion ?? "0.0.0";
    this.#protocolRange = options.protocolRange ?? localProtocolVersionRange;
    this.#verifyPairToken = options.verifyPairToken;
    this.#writeFile = options.writeFile ?? ((path, data) => writeFile(path, data));
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

  async handleCliRequest(
    raw: unknown,
    options: { readonly protocolSession?: ProtocolSession } = {},
  ): Promise<ResponseEnvelope> {
    const parsed = parseBoundaryRequest("cli-to-host", raw, {
      ...(options.protocolSession === undefined
        ? {}
        : { protocolVersion: options.protocolSession.protocolVersion }),
      hello: {
        local: this.#protocolRange,
        expectedPeerComponent: "cli",
      },
    });
    if (!parsed.ok) {
      return (
        options.protocolSession ?? createProtocolSession(this.#protocolRange.protocolMax)
      ).createErrorResponse("invalid-request", parsed.error);
    }

    const request = parsed.value;
    const cliSession = options.protocolSession ?? createProtocolSession(request.protocolVersion);
    if (request.command === "hello") {
      return cliSession.createOkResponse(request as RequestEnvelope<"hello">, {
        accepted: true,
        negotiatedProtocolVersion: cliSession.protocolVersion,
        peer: {
          ...createLocalComponentIdentity("native-host", this.#productVersion),
          protocolMin: this.#protocolRange.protocolMin,
          protocolMax: this.#protocolRange.protocolMax,
        },
      });
    }

    if (this.#extensionConnection === null) {
      return cliSession.createErrorResponse(request.id, {
        code: "EXTENSION_NOT_CONNECTED",
        message: "Firefox extension is not connected to the native host.",
      });
    }

    const extensionSession = getNegotiatedExtensionSession(this.#extensionConnection);
    if (!extensionSession.ok) {
      return cliSession.createErrorResponse(request.id, extensionSession.error);
    }

    if (!this.#extensionConnection.approved) {
      const pairingError = this.#extensionConnection.pairingError;
      if (pairingError !== undefined && !pairingError.ok) {
        return cliSession.createErrorResponse(request.id, {
          code:
            pairingError.code === "NOT_APPROVED" || pairingError.code === "TOKEN_REQUIRED"
              ? "NOT_APPROVED"
              : "PAIRING_MISMATCH",
          message: pairingError.message,
        });
      }
      return cliSession.createErrorResponse(request.id, {
        code: "NOT_APPROVED",
        message: "Approve firefox-cli in the extension popup before running CLI commands.",
      });
    }

    const pairVerification = await this.#verifyPairToken?.(this.#extensionConnection.token);
    if (pairVerification !== undefined && !pairVerification.ok) {
      return cliSession.createErrorResponse(request.id, {
        code:
          pairVerification.code === "NOT_APPROVED" || pairVerification.code === "TOKEN_REQUIRED"
            ? "NOT_APPROVED"
            : "PAIRING_MISMATCH",
        message: pairVerification.message,
      });
    }

    const extensionCompatibility = getRequestProtocolCompatibility(
      request,
      extensionSession.value.protocolVersion,
    );
    if (!extensionCompatibility.compatible) {
      return cliSession.createErrorResponse(
        request.id,
        createRequestProtocolMismatchError(request, extensionSession.value.protocolVersion),
      );
    }

    const extensionRequest = extensionSession.value.withRequestVersion(request);
    const extensionResponse = await this.#extensionConnection.send(extensionRequest);
    const response = extensionSession.value.parseResponse(
      "host-to-extension",
      request.command,
      extensionResponse,
    );
    if (!response.ok) {
      return cliSession.createErrorResponse(request.id, response.error);
    }

    if (request.command === "screenshot" && response.value.ok) {
      return this.#writeScreenshotResponse(
        request as RequestEnvelope<"screenshot">,
        response.value.result as ScreenshotResult,
        cliSession,
      );
    }

    if (request.command === "batch" && response.value.ok) {
      return this.#writeBatchScreenshotResponses(
        request as RequestEnvelope<"batch">,
        response.value.result as BatchResult,
        cliSession,
      );
    }

    return {
      protocolVersion: cliSession.protocolVersion,
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

  async #writeScreenshotResponse(
    request: RequestEnvelope<"screenshot">,
    result: ScreenshotResult,
    protocolSession: ProtocolSession,
  ): Promise<ResponseEnvelope<"screenshot">> {
    const writeResult = await this.#writeScreenshotResult(
      request.id,
      request.params,
      result,
      protocolSession,
    );
    if (!writeResult.ok) {
      return writeResult.response as ResponseEnvelope<"screenshot">;
    }

    return protocolSession.createOkResponse(request, writeResult.result);
  }

  async #writeBatchScreenshotResponses(
    request: RequestEnvelope<"batch">,
    result: BatchResult,
    protocolSession: ProtocolSession,
  ): Promise<ResponseEnvelope<"batch">> {
    const steps: BatchResult["steps"] = [];
    for (const step of result.steps) {
      if (!step.ok || step.command !== "screenshot") {
        steps.push(step);
        continue;
      }

      const requestStep = request.params.steps[step.index];
      if (requestStep?.command !== "screenshot") {
        return protocolSession.createErrorResponse(request.id, {
          code: "INVALID_RESPONSE",
          message: "Batch screenshot result did not match the request step.",
        }) as ResponseEnvelope<"batch">;
      }

      const writeResult = await this.#writeScreenshotResult(
        request.id,
        requestStep.params as ScreenshotParams,
        step.result as ScreenshotResult,
        protocolSession,
      );
      if (!writeResult.ok) {
        return writeResult.response as ResponseEnvelope<"batch">;
      }

      steps.push({
        ...step,
        result: writeResult.result,
      });
    }

    return protocolSession.createOkResponse(request, {
      ...result,
      steps,
    });
  }

  async #writeScreenshotResult(
    id: string,
    params: ScreenshotParams,
    result: ScreenshotResult,
    protocolSession: ProtocolSession,
  ): Promise<
    | { readonly ok: true; readonly result: Omit<ScreenshotResult, "imageBase64"> }
    | { readonly ok: false; readonly response: ResponseEnvelope }
  > {
    if (result.imageBase64 === undefined) {
      return {
        ok: false,
        response: protocolSession.createErrorResponse(id, {
          code: "INVALID_RESPONSE",
          message: "Screenshot response did not include image bytes.",
        }),
      };
    }

    const bytes = Buffer.from(result.imageBase64, "base64");
    if (bytes.byteLength !== result.bytes) {
      return {
        ok: false,
        response: protocolSession.createErrorResponse(id, {
          code: "INVALID_RESPONSE",
          message: "Screenshot byte count did not match image data.",
          details: {
            expectedBytes: result.bytes,
            actualBytes: bytes.byteLength,
          },
        }),
      };
    }

    const maxImageBytes = params.maxImageBytes ?? MAX_SCREENSHOT_BYTES;
    if (bytes.byteLength > maxImageBytes) {
      return {
        ok: false,
        response: protocolSession.createErrorResponse(id, {
          code: "OUTPUT_TOO_LARGE",
          message: `Screenshot is ${bytes.byteLength} bytes, exceeding the ${maxImageBytes} byte limit.`,
        }),
      };
    }

    const publicResult = {
      ...result,
      path: params.path,
    };

    try {
      await this.#writeFile(params.path, bytes);
    } catch (error) {
      return {
        ok: false,
        response: protocolSession.createErrorResponse(id, {
          code: "FILE_WRITE_FAILED",
          message: `Failed to write screenshot: ${error instanceof Error ? error.message : String(error)}`,
        }),
      };
    }

    const { imageBase64: _imageBase64, ...publicResponse } = publicResult;
    return { ok: true, result: publicResponse };
  }
}

function getNegotiatedExtensionSession(
  connection: ExtensionConnection,
):
  | { readonly ok: true; readonly value: ProtocolSession }
  | { readonly ok: false; readonly error: ProtocolError } {
  if (connection.protocolState === undefined) {
    return { ok: true, value: createProtocolSession(localProtocolVersionRange.protocolMax) };
  }

  if (connection.protocolState.state === "negotiated") {
    return { ok: true, value: connection.protocolState.session };
  }

  if (connection.protocolState.state === "incompatible") {
    return { ok: false, error: connection.protocolState.error };
  }

  return {
    ok: false,
    error: {
      code: "EXTENSION_NOT_CONNECTED",
      message: "Firefox extension protocol negotiation has not completed.",
    },
  };
}
