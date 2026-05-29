import {
  MAX_SCREENSHOT_BYTES,
  createErrorResponse,
  createOkResponse,
  type RequestEnvelope,
  type ScreenshotResult,
} from "@firefox-cli/protocol";
import { withTimeout } from "../browser-command/async.js";
import { DEFAULT_SCREENSHOT_TIMEOUT_MS } from "../browser-command/constants.js";
import { BrowserCommandError } from "../browser-command/errors.js";
import { parseImageDataUrl } from "../browser-command/screenshot.js";
import {
  getOrderedWindows,
  resolveFreshTarget,
  resolveTarget,
} from "../browser-command/targets.js";
import type { BrowserHandlerMap } from "./types.js";

export const screenshotHandlers: BrowserHandlerMap = {
  screenshot: async (request, adapter) => {
    const command = request as RequestEnvelope<"screenshot">;
    if (command.params.fullPage === true) {
      return createErrorResponse(command.id, {
        code: "UNSUPPORTED_CAPABILITY",
        message:
          "Full-page screenshots are unsupported because Firefox WebExtensions expose visible-tab capture only.",
      });
    }
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const tabActivated = !resolved.tab.active;
    const windowFocused = !resolved.window.focused;
    try {
      if (tabActivated) {
        await adapter.selectTab(resolved.tab.id);
      }
      if (windowFocused) {
        await adapter.focusWindow(resolved.window.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowserCommandError(
        "CAPTURE_FAILED",
        `Failed to activate screenshot target: ${message}`,
      );
    }

    const target = await resolveFreshTarget(adapter, { tab: { kind: "id", id: resolved.tab.id } });
    let dataUrl: string;
    try {
      dataUrl = await withTimeout(
        adapter.captureVisibleTab(target.windowId, {
          format: command.params.format,
          ...(command.params.quality === undefined ? {} : { quality: command.params.quality }),
        }),
        command.params.timeoutMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS,
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
      command.params.format,
      command.params.maxImageBytes ?? MAX_SCREENSHOT_BYTES,
    );
    const result: ScreenshotResult = {
      path: command.params.path,
      format: command.params.format,
      bytes: image.bytes,
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
      activation: { tabActivated, windowFocused },
      imageBase64: image.base64,
      target,
    };
    return createOkResponse(command, result);
  },
};
