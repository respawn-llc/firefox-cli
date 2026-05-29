import {
  PROTOCOL_VERSION,
  createErrorResponse,
  parseBoundaryResponse,
  withRequestProtocolVersion,
  type ContentCommandId,
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
    return createErrorResponse(
      command.id,
      contentResponse.error,
      command.protocolVersion,
    ) as ResponseEnvelope<C>;
  }

  return contentResponse.value as ResponseEnvelope<C>;
}
