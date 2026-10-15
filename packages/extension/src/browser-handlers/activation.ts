import type { ResolvedTarget } from "@firefox-cli/protocol";
import type { BackgroundBrowserAdapter, ResolvedBrowserTarget } from "../browser-command/types.js";
import type { BrowserHandlerContext } from "./types.js";

export interface BrowserTargetActivation {
  readonly tabActivated: boolean;
  readonly windowFocused: boolean;
  readonly target: ResolvedTarget;
}

export async function activateBrowserTarget(
  adapter: BackgroundBrowserAdapter,
  context: BrowserHandlerContext,
  resolved: ResolvedBrowserTarget,
  requestWindowFocus: boolean,
): Promise<BrowserTargetActivation> {
  const tabActivated = !resolved.tab.active;
  const windowFocused = requestWindowFocus && !resolved.window.focused;

  if (tabActivated) {
    await adapter.selectTab(resolved.tab.id);
  }
  if (windowFocused) {
    await adapter.focusWindow(resolved.window.id);
  }

  const target = tabActivated || windowFocused ? await context.targetContext.resolveFreshTarget({ tab: { kind: "id", id: resolved.tab.id } }) : resolved.target;

  return { tabActivated, windowFocused, target };
}
