import { createErrorResponse, commandRequiresExtensionHostAccess, type RequestEnvelope, type ResponseEnvelope } from "@firefox-cli/protocol";
import { BrowserCommandError } from "./browser-command/errors.js";
import type { BackgroundBrowserAdapter } from "./browser-command/types.js";
import { dispatchBrowserRequest } from "./browser-dispatch.js";

export type { BackgroundBrowserAdapter, BrowserWindowSnapshot } from "./browser-command/types.js";

export async function handleBrowserRequest(request: RequestEnvelope, adapter: BackgroundBrowserAdapter): Promise<ResponseEnvelope> {
  try {
    if (commandRequiresExtensionHostAccess(request.command) && !(await adapter.hasRequiredHostAccess())) {
      throw new BrowserCommandError("PERMISSION_DENIED", "Approve host access for all websites in the firefox-cli extension popup.");
    }
    return await dispatchBrowserRequest(request, adapter);
  } catch (error) {
    return createErrorResponse(
      request.id,
      {
        code: error instanceof BrowserCommandError ? error.code : "PERMISSION_DENIED",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof BrowserCommandError && error.details !== undefined ? { details: error.details } : {}),
      },
      request.protocolVersion,
    );
  }
}
