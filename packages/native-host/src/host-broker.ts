import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import {
  MAX_SCREENSHOT_BYTES,
  PROTOCOL_VERSION,
  createErrorResponse,
  createOkResponse,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type RequestEnvelope,
  type ResponseEnvelope,
  type ScreenshotResult,
} from "@firefox-cli/protocol";
import type { HostIdentity, PairTokenVerification } from "./pair-state.js";

export type ExtensionConnection = {
  readonly approved: boolean;
  readonly token: string | undefined;
  send(request: RequestEnvelope): Promise<unknown>;
};

export type NativeHostBrokerOptions = {
  readonly hostIdentity: HostIdentity;
  writeFile?(path: string, data: Uint8Array): Promise<void>;
  verifyPairToken?(
    token: string | undefined,
  ): Promise<PairTokenVerification> | PairTokenVerification;
};

export class NativeHostBroker {
  readonly #hostIdentity: HostIdentity;
  readonly #verifyPairToken?: NativeHostBrokerOptions["verifyPairToken"];
  readonly #writeFile: NonNullable<NativeHostBrokerOptions["writeFile"]>;
  #extensionConnection: ExtensionConnection | null = null;

  constructor(options: NativeHostBrokerOptions) {
    this.#hostIdentity = options.hostIdentity;
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

    if (request.command === "screenshot" && response.value.ok) {
      return this.#writeScreenshotResponse(
        request as RequestEnvelope<"screenshot">,
        response.value.result as ScreenshotResult,
      );
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

  async #writeScreenshotResponse(
    request: RequestEnvelope<"screenshot">,
    result: ScreenshotResult,
  ): Promise<ResponseEnvelope<"screenshot">> {
    if (result.imageBase64 === undefined) {
      return createErrorResponse(request.id, {
        code: "INVALID_RESPONSE",
        message: "Screenshot response did not include image bytes.",
      }) as ResponseEnvelope<"screenshot">;
    }

    const bytes = Buffer.from(result.imageBase64, "base64");
    if (bytes.byteLength !== result.bytes) {
      return createErrorResponse(request.id, {
        code: "INVALID_RESPONSE",
        message: "Screenshot byte count did not match image data.",
        details: {
          expectedBytes: result.bytes,
          actualBytes: bytes.byteLength,
        },
      }) as ResponseEnvelope<"screenshot">;
    }

    const maxImageBytes = request.params.maxImageBytes ?? MAX_SCREENSHOT_BYTES;
    if (bytes.byteLength > maxImageBytes) {
      return createErrorResponse(request.id, {
        code: "OUTPUT_TOO_LARGE",
        message: `Screenshot is ${bytes.byteLength} bytes, exceeding the ${maxImageBytes} byte limit.`,
      }) as ResponseEnvelope<"screenshot">;
    }

    const publicResult = {
      ...result,
      path: request.params.path,
    };

    try {
      await this.#writeFile(request.params.path, bytes);
    } catch (error) {
      return createErrorResponse(request.id, {
        code: "FILE_WRITE_FAILED",
        message: `Failed to write screenshot: ${error instanceof Error ? error.message : String(error)}`,
      }) as ResponseEnvelope<"screenshot">;
    }

    const { imageBase64: _imageBase64, ...publicResponse } = publicResult;
    return createOkResponse(request, publicResponse);
  }
}
