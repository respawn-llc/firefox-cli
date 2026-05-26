import { createErrorResponse, parseBoundaryRequest } from "@firefox-cli/protocol";
import { ElementRefRegistry, handleContentScriptRequest } from "./content-snapshot.js";

const registry = new ElementRefRegistry<Element>();

browser.runtime.onMessage.addListener(async (message: unknown) => {
  const request = parseBoundaryRequest("extension-to-content-script", message);
  if (!request.ok) {
    return createErrorResponse("invalid-content-request", request.error);
  }

  return handleContentScriptRequest(request.value, {
    document,
    registry,
  });
});
