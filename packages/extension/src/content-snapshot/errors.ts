import {
  createErrorResponse,
  createErrorResponseForRequest,
  type CommandId,
  type ErrorCode,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { ElementRefRegistryError } from "../element-ref-registry.js";

export class ContentSnapshotError extends Error {
  readonly code: Extract<
    ErrorCode,
    | "SCRIPT_INJECTION_FAILED"
    | "SELECTOR_NOT_FOUND"
    | "REF_NOT_FOUND"
    | "OUTPUT_TOO_LARGE"
    | "UNSUPPORTED_CAPABILITY"
    | "TIMEOUT"
    | "ELEMENT_NOT_VISIBLE"
    | "ELEMENT_DISABLED"
    | "NOT_EDITABLE"
    | "ACTION_REJECTED"
    | "NO_FOCUSED_ELEMENT"
    | "INVALID_KEY"
    | "OPTION_NOT_FOUND"
  >;

  constructor(code: ContentSnapshotError["code"], message: string) {
    super(message);
    this.name = "ContentSnapshotError";
    this.code = code;
  }
}

export function createContentErrorResponse(id: string, error: unknown): ResponseEnvelope {
  return createErrorResponse(id, {
    ...contentError(error),
  });
}

export function createContentErrorResponseForRequest<C extends CommandId>(
  request: RequestEnvelope<C>,
  error: unknown,
): ResponseEnvelope<C> {
  return createErrorResponseForRequest(request, contentError(error));
}

function contentError(error: unknown) {
  return {
    code:
      error instanceof ContentSnapshotError || error instanceof ElementRefRegistryError
        ? error.code
        : "SCRIPT_INJECTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}
