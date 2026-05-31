import { createOkResponse } from "@firefox-cli/protocol";
import { executeBatch } from "../browser-command/batch.js";
import type { BrowserCommandHandler } from "./types.js";

export const createBatchHandler =
  (): BrowserCommandHandler<"batch"> => async (request, adapter, context) => {
    const result = await executeBatch(request, adapter, context.executeStep, context.targetContext);
    return createOkResponse(request, result);
  };
