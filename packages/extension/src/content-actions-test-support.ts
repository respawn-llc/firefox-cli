import type { ActionErrorCode } from "./content-action-types.js";
import { type ContentLogCaptureService, createContentLogCaptureService } from "./content-snapshot/log-capture.js";
import { handleContentScriptRequest as handleRawContentScriptRequest } from "./content-snapshot.js";

export type TestContentOptions = Omit<Parameters<typeof handleRawContentScriptRequest>[1], "logCapture"> & {
  readonly logCapture?: ContentLogCaptureService;
};

export function handleContentScriptRequest(
  request: Parameters<typeof handleRawContentScriptRequest>[0],
  options: TestContentOptions,
): ReturnType<typeof handleRawContentScriptRequest> {
  return handleRawContentScriptRequest(request, {
    logCapture: createContentLogCaptureService(),
    ...options,
  });
}

export class TestActionError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}
