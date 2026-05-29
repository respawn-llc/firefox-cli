import { createOkResponse, type RequestEnvelope } from "@firefox-cli/protocol";
import { BrowserCommandError } from "../browser-command/errors.js";
import {
  assertMutableWindow,
  findWindowById,
  getOrderedWindows,
  resolveFreshTarget,
  resolveTarget,
  resolveWindow,
  toOrderedWindows,
  toResolvedTarget,
  toWindowSummary,
} from "../browser-command/targets.js";
import type { BrowserHandlerMap } from "./types.js";

export const tabsWindowsHandlers: BrowserHandlerMap = {
  "tabs.list": async (request, adapter) => {
    const command = request as RequestEnvelope<"tabs.list">;
    const windows = await getOrderedWindows(adapter);
    const resolved = resolveTarget(windows, command.params.target, { allowPrivate: true });
    return createOkResponse(command, {
      target: resolved.target,
      tabs: [...resolved.window.tabs],
    });
  },
  "windows.list": async (request, adapter) => {
    const command = request as RequestEnvelope<"windows.list">;
    const windows = await getOrderedWindows(adapter);
    return createOkResponse(command, {
      windows: windows.map(toWindowSummary),
    });
  },
  "tab.new": async (request, adapter) => {
    const command = request as RequestEnvelope<"tab.new">;
    const windows = await getOrderedWindows(adapter);
    const window = resolveWindow(windows, command.params.target?.window);
    assertMutableWindow(window);
    const tab = await adapter.createTab({
      ...(command.params.url === undefined ? {} : { url: command.params.url }),
      windowId: window.id,
    });
    return createOkResponse(command, {
      target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: tab.id } }),
    });
  },
  "tab.select": async (request, adapter) => {
    const command = request as RequestEnvelope<"tab.select">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    await adapter.selectTab(resolved.tab.id);
    return createOkResponse(command, {
      target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: resolved.tab.id } }),
    });
  },
  "tab.close": async (request, adapter) => {
    const command = request as RequestEnvelope<"tab.close">;
    const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
    await adapter.closeTab(resolved.tab.id);
    const nextWindow = findWindowById(await getOrderedWindows(adapter), resolved.window.id);
    return createOkResponse(command, {
      closedTabId: resolved.tab.id,
      ...(nextWindow?.tabs.find((tab) => tab.active)?.id === undefined
        ? {}
        : { nextActiveTabId: nextWindow.tabs.find((tab) => tab.active)?.id }),
    });
  },
  "window.new": async (request, adapter) => {
    const command = request as RequestEnvelope<"window.new">;
    const createdWindow = await adapter.createWindow({
      ...(command.params.url === undefined ? {} : { url: command.params.url }),
    });
    const window = toOrderedWindows([createdWindow])[0];
    if (window === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Firefox did not return the created window.");
    }
    return createOkResponse(command, {
      window: toWindowSummary(window),
      ...(window.tabs[0] === undefined ? {} : { target: toResolvedTarget(window, window.tabs[0]) }),
    });
  },
  "window.select": async (request, adapter) => {
    const command = request as RequestEnvelope<"window.select">;
    const window = resolveWindow(await getOrderedWindows(adapter), command.params.target.window);
    assertMutableWindow(window);
    await adapter.focusWindow(window.id);
    const focusedWindow = resolveWindow(await getOrderedWindows(adapter), {
      kind: "id",
      id: window.id,
    });
    const activeTab = focusedWindow.tabs.find((tab) => tab.active);
    return createOkResponse(command, {
      window: toWindowSummary(focusedWindow),
      ...(activeTab === undefined ? {} : { target: toResolvedTarget(focusedWindow, activeTab) }),
    });
  },
  "window.close": async (request, adapter) => {
    const command = request as RequestEnvelope<"window.close">;
    const window = resolveWindow(await getOrderedWindows(adapter), command.params.target.window);
    assertMutableWindow(window);
    await adapter.closeWindow(window.id);
    return createOkResponse(command, { closedWindowId: window.id });
  },
};
