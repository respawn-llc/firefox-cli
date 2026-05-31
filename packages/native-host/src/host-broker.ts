import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import {
  MAX_SCREENSHOT_BYTES,
  createLocalComponentIdentity,
  createProtocolSession,
  createRequestProtocolMismatchError,
  getRequestProtocolCompatibility,
  isRequestCommand,
  localProtocolVersionRange,
  parseBoundaryRequest,
  parseBatchStepAs,
  parseBatchStepResultAs,
  type BatchResult,
  type CommandId,
  type ProtocolError,
  type ProtocolSession,
  type ProtocolVersionRange,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ScreenshotResult,
} from "@firefox-cli/protocol";
import {
  getNegotiatedExtensionSession,
  pairVerificationToProtocolError,
  screenshotResultWithoutImage,
  type ExtensionProtocolState,
} from "./host-broker-helpers.js";
import type { HostIdentity, PairTokenVerification } from "./pair-state.js";

export interface ExtensionConnection {
  readonly approved: boolean;
  readonly token: string | undefined;
  readonly pairingError?: PairTokenVerification | undefined;
  readonly protocolState?: ExtensionProtocolState;
  send(request: RequestEnvelope): Promise<unknown>;
}

export interface NativeHostBrokerOptions {
  readonly hostIdentity: HostIdentity;
  readonly productVersion?: string;
  readonly protocolRange?: ProtocolVersionRange;
  writeFile?(path: string, data: Uint8Array): Promise<void>;
  verifyPairToken?(token: string | undefined): Promise<PairTokenVerification> | PairTokenVerification;
}

function rebaseResponseProtocolVersion<C extends CommandId>(
  protocolSession: ProtocolSession,
  request: RequestEnvelope<C>,
  response: ResponseEnvelope<C>,
): ResponseEnvelope<C> {
  return protocolSession.withResponseVersion(request, response);
}

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
    this.#verifyPairToken = options.verifyPairToken?.bind(options);
    this.#writeFile = options.writeFile?.bind(options) ?? (async (path, data) => writeFile(path, data));
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

  async handleCliRequest(raw: unknown, options: { readonly protocolSession?: ProtocolSession } = {}): Promise<ResponseEnvelope> {
    const parsed = parseBoundaryRequest("cli-to-host", raw, {
      ...(options.protocolSession === undefined ? {} : { protocolVersion: options.protocolSession.protocolVersion }),
      hello: {
        local: this.#protocolRange,
        expectedPeerComponent: "cli",
      },
    });
    if (!parsed.ok) {
      return (options.protocolSession ?? createProtocolSession(this.#protocolRange.protocolMax)).createErrorResponse("invalid-request", parsed.error);
    }

    const request = parsed.value;
    const cliSession = options.protocolSession ?? createProtocolSession(request.protocolVersion);
    if (isRequestCommand(request, "hello")) {
      return this.#createHelloResponse(request, cliSession);
    }

    const extension = await this.#getReadyExtension(request, cliSession);
    if (!extension.ok) {
      return extension.response;
    }

    if (isRequestCommand(request, "screenshot")) {
      const response = await this.#forwardToExtension(request, extension.session, cliSession);
      return response.ok ? this.#writeScreenshotResponse(request, response.result, cliSession) : response;
    }

    if (isRequestCommand(request, "batch")) {
      const response = await this.#forwardToExtension(request, extension.session, cliSession);
      return response.ok ? this.#writeBatchScreenshotResponses(request, response.result, cliSession) : response;
    }

    return this.#forwardToExtension(request, extension.session, cliSession);
  }

  #createHelloResponse(request: RequestEnvelope<"hello">, protocolSession: ProtocolSession): ResponseEnvelope<"hello"> {
    return protocolSession.createOkResponse(request, {
      accepted: true,
      negotiatedProtocolVersion: protocolSession.protocolVersion,
      peer: {
        ...createLocalComponentIdentity("native-host", this.#productVersion),
        protocolMin: this.#protocolRange.protocolMin,
        protocolMax: this.#protocolRange.protocolMax,
      },
    });
  }

  async #getReadyExtension<C extends CommandId>(
    request: RequestEnvelope<C>,
    cliSession: ProtocolSession,
  ): Promise<{ readonly ok: true; readonly session: ProtocolSession } | { readonly ok: false; readonly response: ResponseEnvelope<C> }> {
    const connection = this.#extensionConnection;
    if (connection === null) {
      return {
        ok: false,
        response: cliSession.createErrorResponseForRequest(request, {
          code: "EXTENSION_NOT_CONNECTED",
          message: "Firefox extension is not connected to the native host.",
        }),
      };
    }

    const extensionSession = getNegotiatedExtensionSession(connection);
    if (!extensionSession.ok) {
      return { ok: false, response: cliSession.createErrorResponseForRequest(request, extensionSession.error) };
    }

    const approval = await this.#verifyExtensionApproval(connection);
    if (!approval.ok) {
      return { ok: false, response: cliSession.createErrorResponseForRequest(request, approval.error) };
    }

    if (!getRequestProtocolCompatibility(request, extensionSession.value.protocolVersion).compatible) {
      return {
        ok: false,
        response: cliSession.createErrorResponseForRequest(request, createRequestProtocolMismatchError(request, extensionSession.value.protocolVersion)),
      };
    }

    return { ok: true, session: extensionSession.value };
  }

  async #verifyExtensionApproval(connection: ExtensionConnection): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ProtocolError }> {
    if (!connection.approved) {
      const pairingError = connection.pairingError;
      if (pairingError !== undefined && !pairingError.ok) {
        return { ok: false, error: pairVerificationToProtocolError(pairingError) };
      }

      return {
        ok: false,
        error: {
          code: "NOT_APPROVED",
          message: "Approve firefox-cli in the extension popup before running CLI commands.",
        },
      };
    }

    const pairVerification = await this.#verifyPairToken?.(connection.token);
    if (pairVerification !== undefined && !pairVerification.ok) {
      return { ok: false, error: pairVerificationToProtocolError(pairVerification) };
    }

    return { ok: true };
  }

  async #forwardToExtension<C extends CommandId>(
    request: RequestEnvelope<C>,
    extensionSession: ProtocolSession,
    cliSession: ProtocolSession,
  ): Promise<ResponseEnvelope<C>> {
    const extensionConnection = this.#extensionConnection;
    if (extensionConnection === null) {
      return cliSession.createErrorResponseForRequest(request, {
        code: "EXTENSION_NOT_CONNECTED",
        message: "Firefox extension is not connected to the native host.",
      });
    }

    const extensionRequest = extensionSession.withRequestVersion(request);
    const extensionResponse = await extensionConnection.send(extensionRequest);
    const response = extensionSession.parseResponseForRequest("host-to-extension", request, extensionResponse);
    if (!response.ok) {
      return cliSession.createErrorResponseForRequest(request, response.error);
    }
    return rebaseResponseProtocolVersion(cliSession, request, response.value);
  }

  async #writeScreenshotResponse(
    request: RequestEnvelope<"screenshot">,
    result: ScreenshotResult,
    protocolSession: ProtocolSession,
  ): Promise<ResponseEnvelope<"screenshot">> {
    const writeResult = await this.#writeScreenshotResult(request, request.params, result, protocolSession);
    if (!writeResult.ok) {
      return writeResult.response;
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

      const requestStep = parseBatchStepAs("screenshot", request.params.steps[step.index]);
      const responseStep = parseBatchStepResultAs("screenshot", step);
      if (!requestStep.ok || !responseStep.ok || !responseStep.value.ok) {
        return protocolSession.createErrorResponseForRequest(request, {
          code: "INVALID_RESPONSE",
          message: "Batch screenshot result did not match the request step.",
        });
      }

      const writeResult = await this.#writeScreenshotResult(request, requestStep.value.params, responseStep.value.result, protocolSession);
      if (!writeResult.ok) {
        return writeResult.response;
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

  async #writeScreenshotResult<C extends CommandId>(
    request: RequestEnvelope<C>,
    params: RequestEnvelope<"screenshot">["params"],
    result: ScreenshotResult,
    protocolSession: ProtocolSession,
  ): Promise<{ readonly ok: true; readonly result: Omit<ScreenshotResult, "imageBase64"> } | { readonly ok: false; readonly response: ResponseEnvelope<C> }> {
    if (result.imageBase64 === undefined) {
      return {
        ok: false,
        response: protocolSession.createErrorResponseForRequest(request, {
          code: "INVALID_RESPONSE",
          message: "Screenshot response did not include image bytes.",
        }),
      };
    }

    const bytes = Buffer.from(result.imageBase64, "base64");
    if (bytes.byteLength !== result.bytes) {
      return {
        ok: false,
        response: protocolSession.createErrorResponseForRequest(request, {
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
        response: protocolSession.createErrorResponseForRequest(request, {
          code: "OUTPUT_TOO_LARGE",
          message: `Screenshot is ${String(bytes.byteLength)} bytes, exceeding the ${String(maxImageBytes)} byte limit.`,
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
        response: protocolSession.createErrorResponseForRequest(request, {
          code: "FILE_WRITE_FAILED",
          message: `Failed to write screenshot: ${error instanceof Error ? error.message : String(error)}`,
        }),
      };
    }

    return { ok: true, result: screenshotResultWithoutImage(publicResult) };
  }
}
