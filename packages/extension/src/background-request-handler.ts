import {
  createLocalComponentIdentity,
  kernelCapabilities,
  localProtocolVersionRange,
  type ProtocolSession,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { handleBrowserRequest, type BackgroundBrowserAdapter } from "./browser-commands.js";

export function handleRequest(
  request: RequestEnvelope,
  productVersion: string,
  approved: boolean,
  browserAdapter: BackgroundBrowserAdapter,
  protocolSession: ProtocolSession,
): Promise<ResponseEnvelope> | ResponseEnvelope {
  if (request.command === "hello") {
    return protocolSession.createOkResponse(request as RequestEnvelope<"hello">, {
      accepted: true,
      negotiatedProtocolVersion: protocolSession.protocolVersion,
      peer: {
        ...createLocalComponentIdentity("extension", productVersion),
        protocolMin: localProtocolVersionRange.protocolMin,
        protocolMax: localProtocolVersionRange.protocolMax,
      },
    });
  }

  if (request.command === "pair.approve" || request.command === "pair.reset") {
    return protocolSession.createErrorResponse(request.id, {
      code: "UNSUPPORTED_CAPABILITY",
      message: "Pairing commands are handled by the native host.",
    });
  }

  if (!approved) {
    return protocolSession.createErrorResponse(request.id, {
      code: "NOT_APPROVED",
      message: "Approve firefox-cli in the extension popup before running CLI commands.",
    });
  }

  if (request.command === "capabilities") {
    return protocolSession.createOkResponse(request, { capabilities: [...kernelCapabilities] });
  }

  if (request.command === "noop") {
    return protocolSession.createOkResponse(request, { ok: true });
  }

  return handleBrowserRequest(request, browserAdapter);
}
