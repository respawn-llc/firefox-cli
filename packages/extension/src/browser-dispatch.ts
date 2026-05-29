import {
  createErrorResponse,
  isActionCommand,
  type ActionKind,
  type CommandId,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { handleActionCommand, contentRoutedHandlers } from "./browser-handlers/content-routed.js";
import { createBatchHandler } from "./browser-handlers/batch.js";
import { evalWaitHandlers } from "./browser-handlers/eval-wait.js";
import { navigationHandlers } from "./browser-handlers/navigation.js";
import { phase8BrowserHandlers } from "./browser-handlers/phase8-browser.js";
import { screenshotHandlers } from "./browser-handlers/screenshots.js";
import { tabsWindowsHandlers } from "./browser-handlers/tabs-windows.js";
import type { BrowserCommandHandler, BrowserHandlerMap } from "./browser-handlers/types.js";
import { BrowserCommandError } from "./browser-command/errors.js";
import type { BackgroundBrowserAdapter } from "./browser-command/types.js";

const staticHandlers: BrowserHandlerMap = {
  ...tabsWindowsHandlers,
  ...navigationHandlers,
  ...contentRoutedHandlers,
  ...evalWaitHandlers,
  ...screenshotHandlers,
  ...phase8BrowserHandlers,
};

const batchHandler = createBatchHandler();

export async function dispatchBrowserRequest(
  request: RequestEnvelope,
  adapter: BackgroundBrowserAdapter,
): Promise<ResponseEnvelope> {
  const executeStep = async (
    stepRequest: RequestEnvelope,
    stepAdapter: BackgroundBrowserAdapter,
  ) => {
    try {
      return await dispatchBrowserRequest(stepRequest, stepAdapter);
    } catch (error) {
      return createErrorResponse(
        stepRequest.id,
        {
          code: error instanceof BrowserCommandError ? error.code : "PERMISSION_DENIED",
          message: error instanceof Error ? error.message : String(error),
        },
        stepRequest.protocolVersion,
      );
    }
  };
  if (request.command === "batch") {
    return (await batchHandler(asCommandRequest(request, "batch"), adapter, {
      executeStep,
    })) as ResponseEnvelope;
  }

  if (isActionCommand(request.command)) {
    return (await handleActionCommand(
      asActionRequest(request, request.command),
      adapter,
    )) as ResponseEnvelope;
  }

  const handler = staticHandlers[request.command as CommandId] as
    | BrowserCommandHandler<CommandId>
    | undefined;

  if (handler === undefined) {
    return createErrorResponse(
      request.id,
      {
        code: "UNSUPPORTED_CAPABILITY",
        message: `Unsupported browser command: ${request.command}`,
      },
      request.protocolVersion,
    );
  }

  return (await handler(request, adapter, {
    executeStep,
  })) as ResponseEnvelope;
}

function asCommandRequest<C extends CommandId>(
  request: RequestEnvelope,
  command: C,
): RequestEnvelope<C> {
  if (request.command !== command) {
    throw new BrowserCommandError(
      "UNSUPPORTED_CAPABILITY",
      `Unsupported browser command: ${request.command}`,
    );
  }
  return request as RequestEnvelope<C>;
}

function asActionRequest<C extends ActionKind>(
  request: RequestEnvelope,
  command: C,
): RequestEnvelope<C> {
  return asCommandRequest(request, command);
}
