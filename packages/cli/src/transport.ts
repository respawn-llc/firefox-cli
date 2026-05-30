import { LocalIpcError } from "@firefox-cli/native-host";
import {
  createRequest,
  createErrorResponseForRequest,
  type CommandId,
  type ProtocolError,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { validateProtocolRequest } from "./protocol-validation.js";
import type { CliDependencies } from "./types.js";

export async function sendOrUnavailable<C extends CommandId>(
  dependencies: CliDependencies,
  request: RequestEnvelope<C>,
): Promise<ResponseEnvelope<C>> {
  const validatedRequest = validateProtocolRequest(request);
  try {
    if (dependencies.sendRequest === undefined) {
      throw new LocalIpcError("CONNECTION_FAILED", "No native host IPC client is configured.");
    }
    return (await dependencies.sendRequest(validatedRequest)) as ResponseEnvelope<C>;
  } catch (error) {
    if (error instanceof LocalIpcError) {
      return createErrorResponseForRequest(validatedRequest, {
        code: "NATIVE_HOST_UNAVAILABLE",
        message: "firefox-cli native host is not running.",
      });
    }
    throw error;
  }
}

export function createNoopRequest(): RequestEnvelope<"noop"> {
  return createRequest("noop", {});
}

export function formatProtocolError(error: ProtocolError): string {
  if (error.code === "NOT_APPROVED") {
    return `Not approved: ${error.message}\n`;
  }

  if (error.code === "NATIVE_HOST_UNAVAILABLE") {
    return `Native host unavailable: ${error.message}\n`;
  }

  if (error.code === "VERSION_MISMATCH") {
    return `Version mismatch: ${error.message}. Upgrade/rebuild firefox-cli, the native host, and the extension.\n`;
  }

  if (error.code === "REF_NOT_FOUND") {
    return `${error.code}: ${error.message} Run \`firefox-cli snapshot -i\` again.\n`;
  }

  if (error.code === "SCRIPT_INJECTION_FAILED") {
    return `${error.code}: ${error.message} Try a normal web page tab and reload it after updating the extension.\n`;
  }

  return `${error.code}: ${error.message}\n`;
}
