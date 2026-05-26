import { createErrorResponse, parseBoundaryRequest } from "@firefox-cli/protocol";
import { ElementRefRegistry, handleContentScriptRequest } from "./content-snapshot.js";

if (typeof browser !== "undefined") {
  const registry = new ElementRefRegistry<Element>();
  browser.runtime.onMessage.addListener(
    createContentMessageHandler({
      document,
      registry,
    }),
  );
}

export function createContentMessageHandler(options: {
  readonly document: Document;
  readonly registry: ElementRefRegistry<Element>;
}): (message: unknown) => Promise<unknown> {
  return async (message) => {
    const request = parseBoundaryRequest("extension-to-content-script", message);
    if (!request.ok) {
      return createErrorResponse("invalid-content-request", request.error);
    }

    return handleContentScriptRequest(request.value, options);
  };
}
