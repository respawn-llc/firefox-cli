import type { ResolvedTarget, TabSummary, TargetSelector, WindowSummary } from "@firefox-cli/protocol";
import { BrowserCommandError } from "./errors.js";
import type { BackgroundBrowserAdapter, BrowserWindowSnapshot, OrderedWindow, ResolvedBrowserTarget } from "./types.js";

export async function getOrderedWindows(adapter: BackgroundBrowserAdapter): Promise<readonly OrderedWindow[]> {
  return toOrderedWindows(await adapter.listWindows());
}

export function toOrderedWindows(windows: readonly BrowserWindowSnapshot[]): readonly OrderedWindow[] {
  return [...windows]
    .sort((a, b) => Number(b.focused) - Number(a.focused) || a.id - b.id)
    .map((window, index) => ({
      ...window,
      index,
      tabs: [...window.tabs].sort((a, b) => a.index - b.index),
    }));
}

export function resolveTarget(
  windows: readonly OrderedWindow[],
  selector: TargetSelector | undefined,
  options: { readonly allowPrivate?: boolean } = {},
): ResolvedBrowserTarget {
  const tabById = findTargetedTabById(windows, selector);
  const window = tabById?.window ?? resolveWindow(windows, selector?.window);
  const tab = tabById?.tab ?? resolveTab(window, selector?.tab);

  assertTargetPermission(window, tab, options);

  return {
    window,
    tab,
    target: toResolvedTarget(window, tab),
  };
}

export function resolveTargetWindow(windows: readonly OrderedWindow[], selector: TargetSelector | undefined): OrderedWindow {
  const tabById = findTargetedTabById(windows, selector);
  if (tabById !== undefined) {
    return tabById.window;
  }

  const window = resolveWindow(windows, selector?.window);
  if (selector?.tab !== undefined) {
    resolveTab(window, selector.tab);
  }
  return window;
}

function findTargetedTabById(
  windows: readonly OrderedWindow[],
  selector: TargetSelector | undefined,
): { readonly window: OrderedWindow; readonly tab: TabSummary } | undefined {
  return selector?.tab?.kind === "id" && selector.window === undefined ? findTabById(windows, selector.tab.id) : undefined;
}

function assertTargetPermission(window: OrderedWindow, tab: TabSummary, options: { readonly allowPrivate?: boolean }): void {
  if (options.allowPrivate === true || (window.private !== true && tab.private !== true)) {
    return;
  }
  throw new BrowserCommandError("UNSUPPORTED_CAPABILITY", "Private window commands require private browsing permission.");
}

export function resolveWindow(windows: readonly OrderedWindow[], selector: TargetSelector["window"] | undefined): OrderedWindow {
  if (windows.length === 0) {
    throw new BrowserCommandError("NO_ACTIVE_TAB", "Firefox has no normal browser windows.");
  }

  if (selector === undefined && windows.length > 1) {
    throw new BrowserCommandError(
      "INVALID_TARGET",
      `Ambiguous window: Firefox has ${String(windows.length)} windows. Pass \`--window id:<id>\` or explicitly choose \`--window active\`.`,
      {
        reason: "ambiguous-window",
        windowIds: windows.map((window) => window.id),
      },
    );
  }

  if (selector === undefined || selector.kind === "active") {
    const focused = windows.find((window) => window.focused);
    if (focused !== undefined) {
      return focused;
    }

    const first = windows[0];
    if (first === undefined) {
      throw new BrowserCommandError("NO_ACTIVE_TAB", "Firefox has no normal browser windows.");
    }

    return first;
  }

  const window = selector.kind === "id" ? findWindowById(windows, selector.id) : windows.find((candidate) => candidate.index === selector.index);
  if (window === undefined) {
    throw new BrowserCommandError("INVALID_TARGET", "Requested Firefox window was not found.");
  }

  return window;
}

export function assertMutableWindow(window: OrderedWindow): void {
  if (window.private === true) {
    throw new BrowserCommandError("UNSUPPORTED_CAPABILITY", "Private window commands require private browsing permission.");
  }
}

export function resolveTab(window: OrderedWindow, selector: TargetSelector["tab"] | undefined): TabSummary {
  if (window.tabs.length === 0) {
    throw new BrowserCommandError("NO_ACTIVE_TAB", "Firefox window has no tabs.");
  }

  if (selector === undefined && window.tabs.length > 1) {
    throw new BrowserCommandError(
      "INVALID_TARGET",
      `Ambiguous tab: Firefox window ${String(window.id)} has ${String(window.tabs.length)} tabs. Pass \`--tab id:<id>\` or explicitly choose \`--tab active\`.`,
      {
        reason: "ambiguous-tab",
        windowId: window.id,
        tabIds: window.tabs.map((tab) => tab.id),
      },
    );
  }

  if (selector === undefined || selector.kind === "active") {
    const active = window.tabs.find((tab) => tab.active);
    if (active === undefined) {
      throw new BrowserCommandError("NO_ACTIVE_TAB", "Firefox window has no active tab.");
    }
    return active;
  }

  const tab =
    selector.kind === "id"
      ? window.tabs.find((candidate) => candidate.id === selector.id)
      : window.tabs.find((candidate) => candidate.index === selector.index);
  if (tab === undefined) {
    throw new BrowserCommandError("INVALID_TARGET", "Requested Firefox tab was not found.");
  }

  return tab;
}

export async function resolveFreshTarget(adapter: BackgroundBrowserAdapter, selector: TargetSelector): Promise<ResolvedTarget> {
  return resolveTarget(await getOrderedWindows(adapter), selector).target;
}

export function findTabById(windows: readonly OrderedWindow[], tabId: number): { readonly window: OrderedWindow; readonly tab: TabSummary } | undefined {
  for (const window of windows) {
    const tab = window.tabs.find((candidate) => candidate.id === tabId);
    if (tab !== undefined) {
      return { window, tab };
    }
  }

  return undefined;
}

export function findWindowById(windows: readonly OrderedWindow[], windowId: number): OrderedWindow | undefined {
  return windows.find((candidate) => candidate.id === windowId);
}

export function toResolvedTarget(window: OrderedWindow, tab: TabSummary): ResolvedTarget {
  return {
    windowId: window.id,
    windowIndex: window.index,
    tabId: tab.id,
    tabIndex: tab.index,
    ...(tab.title === undefined ? {} : { title: tab.title }),
    ...(tab.url === undefined ? {} : { url: tab.url }),
    ...(tab.private === undefined ? {} : { private: tab.private }),
    ...(tab.cookieStoreId === undefined ? {} : { cookieStoreId: tab.cookieStoreId }),
  };
}

export function toWindowSummary(window: OrderedWindow): WindowSummary {
  return {
    id: window.id,
    index: window.index,
    focused: window.focused,
    activeTabId: window.tabs.find((tab) => tab.active)?.id,
    tabCount: window.tabs.length,
    ...(window.private === undefined ? {} : { private: window.private }),
    ...(window.left === undefined ? {} : { left: window.left }),
    ...(window.top === undefined ? {} : { top: window.top }),
    ...(window.width === undefined ? {} : { width: window.width }),
    ...(window.height === undefined ? {} : { height: window.height }),
  };
}
