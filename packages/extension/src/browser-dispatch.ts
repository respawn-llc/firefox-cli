import {
  createErrorResponse,
  createErrorResponseForRequest,
  dispatchCommandHandler,
  isActionCommand,
  isRequestCommand,
  mergeDisjointHandlerMaps,
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
import { BrowserCommandError } from "./browser-command/errors.js";
import { createBrowserTargetContext } from "./browser-command/target-context.js";
import type { BackgroundBrowserAdapter } from "./browser-command/types.js";

const staticHandlers = mergeDisjointHandlerMaps(
  tabsWindowsHandlers,
  navigationHandlers,
  contentRoutedHandlers,
  evalWaitHandlers,
  screenshotHandlers,
  phase8BrowserHandlers,
);

type StaticBrowserCommand = keyof typeof staticHandlers & CommandId;

const batchHandler = createBatchHandler();

export async function dispatchBrowserRequest(
  request: RequestEnvelope,
  adapter: BackgroundBrowserAdapter,
): Promise<ResponseEnvelope> {
  const targetContext = createBrowserTargetContext(adapter);
  const executeStep = async (stepRequest: RequestEnvelope, stepAdapter: BackgroundBrowserAdapter) => {
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
  if (isRequestCommand(request, "batch")) {
    return await batchHandler(request, adapter, {
      executeStep,
      targetContext,
    });
  }

  if (isActionRequest(request)) {
    return await handleActionCommand(request, adapter, {
      executeStep,
      targetContext,
    });
  }

  if (isStaticBrowserRequest(request)) {
    return await dispatchCommandHandler(staticHandlers, request, adapter, {
      executeStep,
      targetContext,
    });
  }

  return createErrorResponseForRequest(request, {
    code: "UNSUPPORTED_CAPABILITY",
    message: `Unsupported browser command: ${request.command}`,
  });
}

function isActionRequest(request: RequestEnvelope): request is RequestEnvelope<ActionKind> {
  return isActionCommand(request.command);
}

function isStaticBrowserRequest(request: RequestEnvelope): request is RequestEnvelope<StaticBrowserCommand> {
  return Object.hasOwn(staticHandlers, request.command);
}
