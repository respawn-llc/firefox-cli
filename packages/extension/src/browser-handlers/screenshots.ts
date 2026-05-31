import {
  MAX_SCREENSHOT_BYTES,
  createErrorResponseForRequest,
  createOkResponse,
  type RequestEnvelope,
  type ResolvedTarget,
  type ScreenshotResult,
} from "@firefox-cli/protocol";
import { withTimeout } from "../browser-command/async.js";
import { DEFAULT_SCREENSHOT_TIMEOUT_MS } from "../browser-command/constants.js";
import { BrowserCommandError } from "../browser-command/errors.js";
import { parseImageDataUrl } from "../browser-command/screenshot.js";
import type { BackgroundBrowserAdapter, ResolvedBrowserTarget } from "../browser-command/types.js";
import type { BrowserHandlerContext, BrowserHandlerMap } from "./types.js";

export const screenshotHandlers: BrowserHandlerMap<"screenshot"> = {
  screenshot: async (request, adapter, context) => {
    if (request.params.fullPage === true) {
      return createErrorResponseForRequest(request, {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Full-page screenshots are unsupported because Firefox WebExtensions expose visible-tab capture only.",
      });
    }
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const activation = await activateScreenshotTarget(adapter, context, resolved);
    const target = await resolveScreenshotTarget(context, resolved, activation);
    const dataUrl = await captureVisibleTab(adapter, request, target);

    const image = parseImageDataUrl(dataUrl, request.params.format, request.params.maxImageBytes ?? MAX_SCREENSHOT_BYTES);
    const result: ScreenshotResult = {
      path: request.params.path,
      format: request.params.format,
      bytes: image.bytes,
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
      activation,
      imageBase64: image.base64,
      target,
    };
    return createOkResponse(request, result);
  },
};

async function activateScreenshotTarget(
  adapter: BackgroundBrowserAdapter,
  context: BrowserHandlerContext,
  resolved: ResolvedBrowserTarget,
): Promise<{ readonly tabActivated: boolean; readonly windowFocused: boolean }> {
  const activation = {
    tabActivated: !resolved.tab.active,
    windowFocused: !resolved.window.focused,
  };
  try {
    if (activation.tabActivated) {
      await adapter.selectTab(resolved.tab.id);
    }
    if (activation.windowFocused) {
      await adapter.focusWindow(resolved.window.id);
    }
    if (activation.tabActivated || activation.windowFocused) {
      context.targetContext.invalidate();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserCommandError("CAPTURE_FAILED", `Failed to activate screenshot target: ${message}`);
  }
  return activation;
}

async function resolveScreenshotTarget(
  context: BrowserHandlerContext,
  resolved: ResolvedBrowserTarget,
  activation: { readonly tabActivated: boolean; readonly windowFocused: boolean },
): Promise<ResolvedTarget> {
  return activation.tabActivated || activation.windowFocused
    ? context.targetContext.resolveFreshTarget({
        tab: { kind: "id", id: resolved.tab.id },
      })
    : resolved.target;
}

async function captureVisibleTab(adapter: BackgroundBrowserAdapter, request: RequestEnvelope<"screenshot">, target: ResolvedTarget): Promise<string> {
  try {
    return await withTimeout(
      adapter.captureVisibleTab(target.windowId, {
        format: request.params.format,
        ...(request.params.quality === undefined ? {} : { quality: request.params.quality }),
      }),
      request.params.timeoutMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserCommandError(error instanceof BrowserCommandError ? error.code : "CAPTURE_FAILED", `Failed to capture visible tab screenshot: ${message}`);
  }
}
