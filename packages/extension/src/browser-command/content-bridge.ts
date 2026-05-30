import {
  PROTOCOL_VERSION,
  createErrorResponse,
  parseBoundaryResponse,
  withRequestProtocolVersion,
  type ContentCommandId,
  type ProtocolError,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { BrowserCommandError } from "./errors.js";
import type { BackgroundBrowserAdapter } from "./types.js";

export async function sendContentCommand<C extends ContentCommandId>(
  adapter: BackgroundBrowserAdapter,
  tabId: number,
  command: RequestEnvelope<C>,
): Promise<ResponseEnvelope<C>> {
  let rawContentResponse: unknown;
  const contentCommand = withRequestProtocolVersion(command, PROTOCOL_VERSION);
  try {
    rawContentResponse = await adapter.sendContentRequest(tabId, contentCommand);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserCommandError(
      "SCRIPT_INJECTION_FAILED",
      `Cannot inject firefox-cli into this tab. Open a normal web page, reload the extension, or choose a different tab. Firefox reported: ${message}`,
    );
  }

  const contentResponse = parseBoundaryResponse(
    "extension-to-content-script",
    command.command,
    rawContentResponse,
    { protocolVersion: PROTOCOL_VERSION },
  );
  if (!contentResponse.ok) {
    if (contentResponse.error.code === "VERSION_MISMATCH") {
      return createContentVersionMismatchResponse(command, contentResponse.error);
    }
    return createErrorResponse(
      command.id,
      contentResponse.error,
      command.protocolVersion,
    ) as ResponseEnvelope<C>;
  }

  if (!contentResponse.value.ok && contentResponse.value.error.code === "VERSION_MISMATCH") {
    return createContentVersionMismatchResponse(command, contentResponse.value.error);
  }

  return contentResponse.value as ResponseEnvelope<C>;
}

function createContentVersionMismatchResponse<C extends ContentCommandId>(
  command: RequestEnvelope<C>,
  error: ProtocolError,
): ResponseEnvelope<C> {
  return createErrorResponse(
    command.id,
    {
      ...error,
      message:
        "Content script protocol mismatch. Reload the tab and ensure the Firefox extension is upgraded.",
    },
    command.protocolVersion,
  ) as ResponseEnvelope<C>;
}
