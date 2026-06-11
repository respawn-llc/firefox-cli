import {
  commandAllowedBeforeApproval,
  createLocalComponentIdentity,
  kernelCapabilities,
  localProtocolVersionRange,
  type ProtocolSession,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { handleBrowserRequest, type BackgroundBrowserAdapter } from "./browser-commands.js";

export function handleRequest(options: {
  readonly request: RequestEnvelope;
  readonly productVersion: string;
  readonly approved: boolean;
  readonly browserAdapter: BackgroundBrowserAdapter;
  readonly protocolSession: ProtocolSession;
}): Promise<ResponseEnvelope> | ResponseEnvelope {
  const { request, productVersion, approved, browserAdapter, protocolSession } = options;
  if (request.command === "hello") {
    return protocolSession.createOkResponse(request, {
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

  if (!approved && !commandAllowedBeforeApproval(request.command)) {
    return protocolSession.createErrorResponse(request.id, {
      code: "NOT_APPROVED",
      message: "Run `firefox-cli connect` before running Firefox control commands.",
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
