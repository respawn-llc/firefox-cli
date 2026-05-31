import {
  MAX_SCREENSHOT_BYTES,
  createErrorResponseForRequest,
  createOkResponse,
  type ScreenshotResult,
} from "@firefox-cli/protocol";
import { withTimeout } from "../browser-command/async.js";
import { DEFAULT_SCREENSHOT_TIMEOUT_MS } from "../browser-command/constants.js";
import { BrowserCommandError } from "../browser-command/errors.js";
import { parseImageDataUrl } from "../browser-command/screenshot.js";
import type { BrowserHandlerMap } from "./types.js";

export const screenshotHandlers: BrowserHandlerMap<"screenshot"> = {
  screenshot: async (request, adapter, context) => {
    if (request.params.fullPage === true) {
      return createErrorResponseForRequest(request, {
        code: "UNSUPPORTED_CAPABILITY",
        message:
          "Full-page screenshots are unsupported because Firefox WebExtensions expose visible-tab capture only.",
      });
    }
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const tabActivated = !resolved.tab.active;
    const windowFocused = !resolved.window.focused;
    try {
      if (tabActivated) {
        await adapter.selectTab(resolved.tab.id);
      }
      if (windowFocused) {
        await adapter.focusWindow(resolved.window.id);
      }
      if (tabActivated || windowFocused) {
        context.targetContext.invalidate();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowserCommandError(
        "CAPTURE_FAILED",
        `Failed to activate screenshot target: ${message}`,
      );
    }

    const target =
      tabActivated || windowFocused
        ? await context.targetContext.resolveFreshTarget({
            tab: { kind: "id", id: resolved.tab.id },
          })
        : resolved.target;
    let dataUrl: string;
    try {
      dataUrl = await withTimeout(
        adapter.captureVisibleTab(target.windowId, {
          format: request.params.format,
          ...(request.params.quality === undefined ? {} : { quality: request.params.quality }),
        }),
        request.params.timeoutMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowserCommandError(
        error instanceof BrowserCommandError ? error.code : "CAPTURE_FAILED",
        `Failed to capture visible tab screenshot: ${message}`,
      );
    }

    const image = parseImageDataUrl(
      dataUrl,
      request.params.format,
      request.params.maxImageBytes ?? MAX_SCREENSHOT_BYTES,
    );
    const result: ScreenshotResult = {
      path: request.params.path,
      format: request.params.format,
      bytes: image.bytes,
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
      activation: { tabActivated, windowFocused },
      imageBase64: image.base64,
      target,
    };
    return createOkResponse(request, result);
  },
};
