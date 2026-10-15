import { createOkResponse, type RequestEnvelope } from "@firefox-cli/protocol";
import { assertMutableWindow } from "../browser-command/targets.js";
import type { BackgroundBrowserAdapter } from "../browser-command/types.js";
import { activateBrowserTarget } from "./activation.js";
import type { BrowserHandlerContext, BrowserHandlerMap } from "./types.js";

type NavigationCommand = "open" | "back" | "forward" | "reload";

export const navigationHandlers: BrowserHandlerMap<NavigationCommand> = {
  open: async (request, adapter, context) => {
    if (request.params.newTab) {
      const window = await context.targetContext.resolveTargetWindow(request.params.target);
      assertMutableWindow(window);
      const tab = await adapter.createTab({
        active: request.params.focus === true,
        url: request.params.url,
        windowId: window.id,
      });
      context.targetContext.invalidate();
      const created = await context.targetContext.resolveTarget({ tab: { kind: "id", id: tab.id } });
      const target = request.params.focus === true ? (await activateBrowserTarget(adapter, context, created, true)).target : created.target;
      return createOkResponse(request, {
        target,
        url: tab.url ?? request.params.url,
        loadState: "unknown",
      });
    }

    const resolved = await context.targetContext.resolveTarget(request.params.target);
    const tab = await adapter.navigateTab(resolved.tab.id, request.params.url);
    context.targetContext.invalidate();
    const updated = await context.targetContext.resolveTarget({ tab: { kind: "id", id: resolved.tab.id } });
    const target = request.params.focus === true ? (await activateBrowserTarget(adapter, context, updated, true)).target : updated.target;
    return createOkResponse(request, {
      target,
      url: tab.url ?? request.params.url,
      loadState: "unknown",
    });
  },
  back: async (request, adapter, context) => handleHistoryCommand(request, adapter, context),
  forward: async (request, adapter, context) => handleHistoryCommand(request, adapter, context),
  reload: async (request, adapter, context) => handleHistoryCommand(request, adapter, context),
};

async function handleHistoryCommand(
  command: RequestEnvelope<"back" | "forward" | "reload">,
  adapter: BackgroundBrowserAdapter,
  context: BrowserHandlerContext,
) {
  const resolved = await context.targetContext.resolveTarget(command.params.target);
  const tab =
    command.command === "back"
      ? await adapter.goBack(resolved.tab.id)
      : command.command === "forward"
        ? await adapter.goForward(resolved.tab.id)
        : await adapter.reload(resolved.tab.id);
  context.targetContext.invalidate();
  return createOkResponse(command, {
    target: await context.targetContext.resolveFreshTarget({ tab: { kind: "id", id: tab.id } }),
    ...(tab.url === undefined ? {} : { url: tab.url }),
    loadState: "unknown",
  });
}
