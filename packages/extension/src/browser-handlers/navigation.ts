import { createOkResponse, type RequestEnvelope } from "@firefox-cli/protocol";
import {
  assertMutableWindow,
  getOrderedWindows,
  resolveFreshTarget,
  resolveTarget,
  resolveWindow,
} from "../browser-command/targets.js";
import type { BrowserHandlerMap } from "./types.js";

type NavigationCommand = "open" | "back" | "forward" | "reload";

export const navigationHandlers: BrowserHandlerMap<NavigationCommand> = {
  open: async (request, adapter) => {
    if (request.params.newTab) {
      const windows = await getOrderedWindows(adapter);
      const window = resolveWindow(windows, request.params.target?.window);
      assertMutableWindow(window);
      const tab = await adapter.createTab({ url: request.params.url, windowId: window.id });
      return createOkResponse(request, {
        target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: tab.id } }),
        url: tab.url ?? request.params.url,
        loadState: "unknown",
      });
    }

    const resolved = resolveTarget(await getOrderedWindows(adapter), request.params.target);
    const tab = await adapter.navigateTab(resolved.tab.id, request.params.url);
    return createOkResponse(request, {
      target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: tab.id } }),
      url: tab.url ?? request.params.url,
      loadState: "unknown",
    });
  },
  back: async (request, adapter) => handleHistoryCommand(request, adapter),
  forward: async (request, adapter) => handleHistoryCommand(request, adapter),
  reload: async (request, adapter) => handleHistoryCommand(request, adapter),
};

async function handleHistoryCommand(
  command: RequestEnvelope<"back" | "forward" | "reload">,
  adapter: Parameters<NonNullable<typeof navigationHandlers.open>>[1],
) {
  const resolved = resolveTarget(await getOrderedWindows(adapter), command.params.target);
  const tab =
    command.command === "back"
      ? await adapter.goBack(resolved.tab.id)
      : command.command === "forward"
        ? await adapter.goForward(resolved.tab.id)
        : await adapter.reload(resolved.tab.id);
  return createOkResponse(command, {
    target: await resolveFreshTarget(adapter, { tab: { kind: "id", id: tab.id } }),
    ...(tab.url === undefined ? {} : { url: tab.url }),
    loadState: "unknown",
  });
}
