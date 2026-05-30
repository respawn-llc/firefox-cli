import {
  createErrorResponseForRequest,
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

type Phase8BrowserCommand =
  | "download"
  | "clipboard"
  | "cookies"
  | "network"
  | "pdf"
  | "set.viewport";

export const phase8BrowserHandlers: BrowserHandlerMap<Phase8BrowserCommand> = {
  download: async (request, adapter) => {
    const result = await adapter.download({
      url: request.params.url,
      ...(request.params.filename === undefined ? {} : { filename: request.params.filename }),
      ...(request.params.saveAs === undefined ? {} : { saveAs: request.params.saveAs }),
    });
    return createOkResponse(request, result);
  },
  clipboard: async (request, adapter) => {
    if (request.params.action === "read") {
      const result: ClipboardResult = {
        action: "read",
        ok: true,
        text: await adapter.readClipboard(),
      };
      return createOkResponse(request, result);
    }
    if (request.params.action === "write") {
      await adapter.writeClipboard(request.params.text ?? "");
      return createOkResponse(request, { action: "write", ok: true });
    }
    const resolved = resolveTarget(await getOrderedWindows(adapter), request.params.target);
    const contentCommand: RequestEnvelope<"clipboard"> =
      request.params.action === "paste"
        ? {
            ...request,
            params: { ...request.params, text: await adapter.readClipboard() },
          }
        : request;
    const clipboardResponse = await sendContentCommand(adapter, resolved.tab.id, contentCommand);
    if (!clipboardResponse.ok) {
      return createErrorResponseForRequest(request, clipboardResponse.error);
    }
    if (request.params.action === "copy" && clipboardResponse.result.text !== undefined) {
      await adapter.writeClipboard(clipboardResponse.result.text);
    }
    return createOkResponse(request, clipboardResponse.result);
  },
  cookies: async (request, adapter) => {
    if (request.params.action === "set") {
      if (request.params.name === undefined || request.params.value === undefined) {
        throw new BrowserCommandError("INVALID_TARGET", "Cookie set requires name and value.");
      }
      const cookie = await adapter.setCookie({
        url: request.params.url,
        name: request.params.name,
        value: request.params.value,
        ...(request.params.domain === undefined ? {} : { domain: request.params.domain }),
        ...(request.params.path === undefined ? {} : { path: request.params.path }),
      });
      return createOkResponse(request, { action: "set", ok: true, cookie });
    }
    if (request.params.action === "remove") {
      if (request.params.name === undefined) {
        throw new BrowserCommandError("INVALID_TARGET", "Cookie remove requires name.");
      }
      await adapter.removeCookie({ url: request.params.url, name: request.params.name });
      return createOkResponse(request, { action: "remove", ok: true });
    }
    const cookies = await adapter.listCookies({
      url: request.params.url,
      ...(request.params.name === undefined ? {} : { name: request.params.name }),
    });
    const result: CookieResult = {
      action: request.params.action,
      ok: true,
      ...(request.params.action === "get" ? { cookie: cookies?.[0] ?? null } : { cookies }),
    };
    return createOkResponse(request, result);
  },
  network: async (request, adapter) => {
    const resolved = resolveTarget(await getOrderedWindows(adapter), request.params.target);
    if (request.params.action === "clear") {
      await adapter.clearNetworkRequests({
        tabId: resolved.tab.id,
        ...(request.params.urlGlob === undefined ? {} : { urlGlob: request.params.urlGlob }),
      });
      return createOkResponse(request, { action: "clear", ok: true });
    }
    return createOkResponse(request, {
      action: "list",
      ok: true,
      requests: await adapter.listNetworkRequests({
        tabId: resolved.tab.id,
        ...(request.params.urlGlob === undefined ? {} : { urlGlob: request.params.urlGlob }),
      }),
    });
  },
  pdf: async (request) => {
    return createErrorResponseForRequest(request, {
      code: "UNSUPPORTED_CAPABILITY",
      message:
        "PDF export is unsupported because Firefox saves PDFs through a browser dialog instead of writing a requested CLI path.",
    });
  },
  "set.viewport": async (request, adapter) => {
    const resolved = resolveTarget(await getOrderedWindows(adapter), request.params.target);
    const window = await adapter.resizeWindow(resolved.window.id, {
      width: request.params.width,
      height: request.params.height,
    });
    const ordered = toOrderedWindows([window])[0];
    if (ordered === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Firefox did not return the resized window.");
    }
    const result: SetViewportResult = { window: toWindowSummary(ordered) };
    return createOkResponse(request, result);
  },
};
