import {
  PROTOCOL_VERSION,
  createErrorResponseForRequest,
  parseBoundaryResponse,
  withRequestProtocolVersion,
  type ContentCommandId,
  type ProtocolError,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { BrowserCommandError } from "./errors.js";
import type { BackgroundBrowserAdapter } from "./types.js";
import { ContentScriptDeliveryError } from "../content-script-delivery.js";

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
    const deliveryError = error instanceof ContentScriptDeliveryError ? error : undefined;
    const message = deliveryError?.originalMessage ?? (error instanceof Error ? error.message : String(error));
    throw new BrowserCommandError(
      "SCRIPT_INJECTION_FAILED",
      `${deliveryFailureGuidance(deliveryError)} Firefox reported: ${message}`,
      deliveryError === undefined
        ? undefined
        : {
            cause: deliveryError.deliveryCause,
            stage: deliveryError.stage,
            retried: deliveryError.retried,
          },
    );
  }

  const contentResponse = parseBoundaryResponse("extension-to-content-script", command.command, rawContentResponse, { protocolVersion: PROTOCOL_VERSION });
  if (!contentResponse.ok) {
    if (contentResponse.error.code === "VERSION_MISMATCH") {
      return createContentVersionMismatchResponse(command, contentResponse.error);
    }
    return createErrorResponseForRequest(command, contentResponse.error);
  }

  if (!contentResponse.value.ok && contentResponse.value.error.code === "VERSION_MISMATCH") {
    return createContentVersionMismatchResponse(command, contentResponse.value.error);
  }

  if (isContentResponseForCommand(command, contentResponse.value)) {
    return contentResponse.value;
  }

  return createErrorResponseForRequest(command, {
    code: "INVALID_RESPONSE",
    message: "Content script returned a response for a different command.",
  });
}

function isContentResponseForCommand<C extends ContentCommandId>(command: RequestEnvelope<C>, response: ResponseEnvelope): response is ResponseEnvelope<C> {
  return response.id === command.id;
}

function deliveryFailureGuidance(error: ContentScriptDeliveryError | undefined): string {
  if (error === undefined) {
    return "Cannot inject firefox-cli into this tab. Open a normal web page, reload the extension, or choose a different tab.";
  }

  switch (error.deliveryCause) {
    case "not-loaded":
      return "Cannot inject firefox-cli into this tab after retrying content-script startup. Reload the tab or the Firefox extension.";
    case "restricted-page":
      return "Cannot run firefox-cli on this restricted Firefox page. Choose a normal web page.";
    case "permission-denied":
      return "Cannot run firefox-cli in this tab because Firefox denied extension host access. Re-approve host permissions and try again.";
    case "tab-discarded":
      return "Cannot run firefox-cli in this tab because Firefox reported the tab is unloaded, discarded, or crashed. Reload the tab and try again.";
    case "tab-unavailable":
      return "Cannot run firefox-cli in this tab because Firefox reported the tab is unavailable. Choose a current tab and try again.";
    case "unknown":
      return "Cannot inject firefox-cli into this tab. Open a normal web page, reload the extension, or choose a different tab.";
  }
}

function createContentVersionMismatchResponse<C extends ContentCommandId>(command: RequestEnvelope<C>, error: ProtocolError): ResponseEnvelope<C> {
  return createErrorResponseForRequest(command, {
    ...error,
    message: "Content script protocol mismatch. Reload the tab and ensure the Firefox extension is upgraded.",
  });
}
