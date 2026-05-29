import {
  createErrorResponse,
  createOkResponse,
  type ClipboardResult,
  type CookieResult,
  type RequestEnvelope,
  type SetViewportResult,
} from "@firefox-cli/protocol";
import { sendContentCommand } from "../browser-command/content-bridge.js";
import { BrowserCommandError } from "../browser-command/errors.js";
import {
  getOrderedWindows,
  resolveTarget,
  toOrderedWindows,
  toWindowSummary,
} from "../browser-command/targets.js";
import type { BrowserHandlerMap } from "./types.js";

export const phase8BrowserHandlers: BrowserHandlerMap = {
  download: async (request, adapter) => {
    const command = request as RequestEnvelope<"download">;
    const result = await adapter.download({
      url: command.params.url,
      ...(command.params.filename === undefined ? {} : { filename: command.params.filename }),
      ...(command.params.saveAs === undefined ? {} : { saveAs: command.params.saveAs }),
    });
    return createOkResponse(command, result);
  },
  clipboard: async (request, adapter) => {
    const command = request as RequestEnvelope<"clipboard">;
    if (command.params.action === "read") {
      const result: ClipboardResult = {
        action: "read",
        ok: true,
        text: await adapter.readClipboard(),
      };
      return createOkResponse(command, result);
    }
    if (command.params.action === "write") {
      await adapter.writeClipboard(command.params.text ?? "");
      return createOkResponse(command, { action: "write", ok: true });
    }
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const contentCommand: RequestEnvelope<"clipboard"> =
      command.params.action === "paste"
        ? {
            ...command,
            params: { ...command.params, text: await adapter.readClipboard() },
          }
        : command;
    const clipboardResponse = await sendContentCommand(adapter, resolved.tab.id, contentCommand);
    if (!clipboardResponse.ok) {
      return createErrorResponse(command.id, clipboardResponse.error, command.protocolVersion);
    }
    if (command.params.action === "copy" && clipboardResponse.result.text !== undefined) {
      await adapter.writeClipboard(clipboardResponse.result.text);
    }
    return createOkResponse(command, clipboardResponse.result);
  },
  cookies: async (request, adapter) => {
    const command = request as RequestEnvelope<"cookies">;
    if (command.params.action === "set") {
      if (command.params.name === undefined || command.params.value === undefined) {
        throw new BrowserCommandError("INVALID_TARGET", "Cookie set requires name and value.");
      }
      const cookie = await adapter.setCookie({
        url: command.params.url,
        name: command.params.name,
        value: command.params.value,
        ...(command.params.domain === undefined ? {} : { domain: command.params.domain }),
        ...(command.params.path === undefined ? {} : { path: command.params.path }),
      });
      return createOkResponse(command, { action: "set", ok: true, cookie });
    }
    if (command.params.action === "remove") {
      if (command.params.name === undefined) {
        throw new BrowserCommandError("INVALID_TARGET", "Cookie remove requires name.");
      }
      await adapter.removeCookie({ url: command.params.url, name: command.params.name });
      return createOkResponse(command, { action: "remove", ok: true });
    }
    const cookies = await adapter.listCookies({
      url: command.params.url,
      ...(command.params.name === undefined ? {} : { name: command.params.name }),
    });
    const result: CookieResult = {
      action: command.params.action,
      ok: true,
      ...(command.params.action === "get" ? { cookie: cookies?.[0] ?? null } : { cookies }),
    };
    return createOkResponse(command, result);
  },
  network: async (request, adapter) => {
    const command = request as RequestEnvelope<"network">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    if (command.params.action === "clear") {
      await adapter.clearNetworkRequests({
        tabId: resolved.tab.id,
        ...(command.params.urlGlob === undefined ? {} : { urlGlob: command.params.urlGlob }),
      });
      return createOkResponse(command, { action: "clear", ok: true });
    }
    return createOkResponse(command, {
      action: "list",
      ok: true,
      requests: await adapter.listNetworkRequests({
        tabId: resolved.tab.id,
        ...(command.params.urlGlob === undefined ? {} : { urlGlob: command.params.urlGlob }),
      }),
    });
  },
  pdf: async (request) => {
    const command = request as RequestEnvelope<"pdf">;
    return createErrorResponse(command.id, {
      code: "UNSUPPORTED_CAPABILITY",
      message:
        "PDF export is unsupported because Firefox saves PDFs through a browser dialog instead of writing a requested CLI path.",
    });
  },
  "set.viewport": async (request, adapter) => {
    const command = request as RequestEnvelope<"set.viewport">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    const window = await adapter.resizeWindow(resolved.window.id, {
      width: command.params.width,
      height: command.params.height,
    });
    const ordered = toOrderedWindows([window])[0];
    if (ordered === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Firefox did not return the resized window.");
    }
    const result: SetViewportResult = { window: toWindowSummary(ordered) };
    return createOkResponse(command, result);
  },
};
