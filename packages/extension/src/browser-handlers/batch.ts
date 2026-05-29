import { createOkResponse, type RequestEnvelope } from "@firefox-cli/protocol";
import { executeBatch } from "../browser-command/batch.js";
import type { BrowserCommandHandler } from "./types.js";

export const createBatchHandler =
  (): BrowserCommandHandler<"batch"> => async (request, adapter, context) => {
    const command = request as RequestEnvelope<"batch">;
    const result = await executeBatch(command, adapter, context.executeStep);
    return createOkResponse(command, result);
  };
