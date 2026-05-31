import { createOkResponse } from "@firefox-cli/protocol";
import { BrowserCommandError } from "../browser-command/errors.js";
import {
  assertMutableWindow,
  toOrderedWindows,
  toResolvedTarget,
  toWindowSummary,
} from "../browser-command/targets.js";
import type { BrowserHandlerMap } from "./types.js";

type TabsWindowsCommand =
  | "tabs.list"
  | "windows.list"
  | "tab.new"
  | "tab.select"
  | "tab.close"
  | "window.new"
  | "window.select"
  | "window.close";

export const tabsWindowsHandlers: BrowserHandlerMap<TabsWindowsCommand> = {
  "tabs.list": async (request, _adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target, {
      allowPrivate: true,
    });
    return createOkResponse(request, {
      target: resolved.target,
      tabs: [...resolved.window.tabs],
    });
  },
  "windows.list": async (request, _adapter, context) => {
    const windows = await context.targetContext.getWindows();
    return createOkResponse(request, {
      windows: windows.map(toWindowSummary),
    });
  },
  "tab.new": async (request, adapter, context) => {
    const window = await context.targetContext.resolveWindow(request.params.target?.window);
    assertMutableWindow(window);
    const tab = await adapter.createTab({
      ...(request.params.url === undefined ? {} : { url: request.params.url }),
      windowId: window.id,
    });
    context.targetContext.invalidate();
    return createOkResponse(request, {
      target: await context.targetContext.resolveFreshTarget({ tab: { kind: "id", id: tab.id } }),
    });
  },
  "tab.select": async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    await adapter.selectTab(resolved.tab.id);
    context.targetContext.invalidate();
    return createOkResponse(request, {
      target: await context.targetContext.resolveFreshTarget({
        tab: { kind: "id", id: resolved.tab.id },
      }),
    });
  },
  "tab.close": async (request, adapter, context) => {
    const resolved = await context.targetContext.resolveTarget(request.params.target);
    await adapter.closeTab(resolved.tab.id);
    context.targetContext.invalidate();
    const nextWindow = await context.targetContext.findWindowById(resolved.window.id);
    return createOkResponse(request, {
      closedTabId: resolved.tab.id,
      ...(nextWindow?.tabs.find((tab) => tab.active)?.id === undefined
        ? {}
        : { nextActiveTabId: nextWindow.tabs.find((tab) => tab.active)?.id }),
    });
  },
  "window.new": async (request, adapter, context) => {
    const createdWindow = await adapter.createWindow({
      ...(request.params.url === undefined ? {} : { url: request.params.url }),
    });
    context.targetContext.invalidate();
    const window = toOrderedWindows([createdWindow])[0];
    if (window === undefined) {
      throw new BrowserCommandError("INVALID_TARGET", "Firefox did not return the created window.");
    }
    return createOkResponse(request, {
      window: toWindowSummary(window),
      ...(window.tabs[0] === undefined ? {} : { target: toResolvedTarget(window, window.tabs[0]) }),
    });
  },
  "window.select": async (request, adapter, context) => {
    const window = await context.targetContext.resolveWindow(request.params.target.window);
    assertMutableWindow(window);
    await adapter.focusWindow(window.id);
    context.targetContext.invalidate();
    const focusedWindow = await context.targetContext.resolveWindow({
      kind: "id",
      id: window.id,
    });
    const activeTab = focusedWindow.tabs.find((tab) => tab.active);
    return createOkResponse(request, {
      window: toWindowSummary(focusedWindow),
      ...(activeTab === undefined ? {} : { target: toResolvedTarget(focusedWindow, activeTab) }),
    });
  },
  "window.close": async (request, adapter, context) => {
    const window = await context.targetContext.resolveWindow(request.params.target.window);
    assertMutableWindow(window);
    await adapter.closeWindow(window.id);
    context.targetContext.invalidate();
    return createOkResponse(request, { closedWindowId: window.id });
  },
};
