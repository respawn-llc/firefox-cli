import { withBrowserCommandDeadline } from "./deadline.js";
import { findWindowById, resolveTarget, resolveWindow, toOrderedWindows } from "./targets.js";
import type { BackgroundBrowserAdapter, OrderedWindow, ResolvedBrowserTarget } from "./types.js";
import type { ResolvedTarget, TargetSelector } from "@firefox-cli/protocol";

type DeadlineOptions = {
  readonly deadlineMs?: number;
  readonly timeoutMessage?: () => string;
};

type ResolveOptions = DeadlineOptions & {
  readonly allowPrivate?: boolean;
};

export type BrowserTargetContext = {
  getWindows(options?: DeadlineOptions): Promise<readonly OrderedWindow[]>;
  resolveTarget(
    selector: TargetSelector | undefined,
    options?: ResolveOptions,
  ): Promise<ResolvedBrowserTarget>;
  resolveWindow(
    selector: TargetSelector["window"] | undefined,
    options?: DeadlineOptions,
  ): Promise<OrderedWindow>;
  resolveFreshTarget(selector: TargetSelector, options?: ResolveOptions): Promise<ResolvedTarget>;
  findWindowById(windowId: number, options?: DeadlineOptions): Promise<OrderedWindow | undefined>;
  invalidate(): void;
};

export function createBrowserTargetContext(adapter: BackgroundBrowserAdapter): BrowserTargetContext {
  let windows: Promise<readonly OrderedWindow[]> | undefined;

  const readWindows = () => {
    windows ??= adapter.listWindows().then(toOrderedWindows);
    return windows;
  };

  const getWindows = async (options: DeadlineOptions = {}): Promise<readonly OrderedWindow[]> => {
    const snapshot = readWindows();
    if (options.deadlineMs === undefined || options.timeoutMessage === undefined) {
      return await snapshot;
    }
    return await withBrowserCommandDeadline(snapshot, options.deadlineMs, options.timeoutMessage);
  };

  return {
    getWindows,
    resolveTarget: async (selector, options = {}) =>
      resolveTarget(await getWindows(options), selector, resolveTargetOptions(options)),
    resolveWindow: async (selector, options = {}) => resolveWindow(await getWindows(options), selector),
    resolveFreshTarget: async (selector, options = {}) => {
      windows = undefined;
      return resolveTarget(await getWindows(options), selector, resolveTargetOptions(options)).target;
    },
    findWindowById: async (windowId, options = {}) => findWindowById(await getWindows(options), windowId),
    invalidate: () => {
      windows = undefined;
    },
  };
}

function resolveTargetOptions(options: ResolveOptions): { readonly allowPrivate?: boolean } {
  return options.allowPrivate === undefined ? {} : { allowPrivate: options.allowPrivate };
}
