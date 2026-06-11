import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("approval request page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a dedicated centered approval dialog with approve and deny actions", async () => {
    const { document } = await renderApprovalRequestPage();
    const css = await readFile(new URL("./approval-request.css", import.meta.url), "utf8");

    expect(document.title).toBe("firefox-cli approval request");
    expect(document.querySelector(".approval-page")).not.toBeNull();
    expect(document.querySelector(".approval-dialog")).not.toBeNull();
    expect(document.querySelector(".approval-dialog")?.textContent).toContain("A CLI client is requesting control of this Firefox instance.");
    expect(document.querySelector<HTMLButtonElement>("#approve")?.textContent).toBe("Approve");
    expect(document.querySelector<HTMLButtonElement>("#deny")?.textContent).toBe("Deny");
    expect(css).toContain("width: min(320px, 100%)");
    expect(css).toContain("border: 1px solid var(--danger)");
    expect(css).toContain("--danger: #ff6678");
  });

  it("requests Firefox host access before approving the pending CLI request", async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ active: true }).mockResolvedValueOnce({ active: false, close: true });
    const contains = vi.fn(async () => false);
    const request = vi.fn(async () => true);
    const events: string[] = [];

    const { document } = await renderApprovalRequestPage({
      sendMessage,
      contains,
      request,
      reload: () => {
        events.push("reload");
      },
      removeTab: async () => {
        events.push("close");
      },
    });
    document.querySelector<HTMLButtonElement>("#approve")?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenLastCalledWith({ type: "firefox-cli:approve-request", requestId: "approval-1" });
    });

    expect(contains).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    await vi.waitFor(() => {
      expect(events).toEqual(["reload", "close"]);
    });
  });

  it("denies the pending CLI request without asking for Firefox host access", async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ active: true }).mockResolvedValueOnce({ active: false, close: true });
    const request = vi.fn(async () => true);
    const removeTab = vi.fn(async () => undefined);

    const { document } = await renderApprovalRequestPage({ sendMessage, request, removeTab });
    document.querySelector<HTMLButtonElement>("#deny")?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenLastCalledWith({ type: "firefox-cli:deny-approval-request", requestId: "approval-1" });
    });
    expect(request).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(removeTab).toHaveBeenCalledWith(99);
    });
  });

  it("reloads after manual approval grants Firefox host access without closing the tab", async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ approved: true });
    const contains = vi.fn(async () => false);
    const request = vi.fn(async () => true);
    const reload = vi.fn();
    const removeTab = vi.fn(async () => undefined);

    const { document } = await renderApprovalRequestPage({
      search: "?manual=1",
      sendMessage,
      contains,
      request,
      reload,
      removeTab,
    });
    document.querySelector<HTMLButtonElement>("#approve")?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenLastCalledWith({ type: "firefox-cli:approve" });
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(removeTab).not.toHaveBeenCalled();
  });
});

async function renderApprovalRequestPage(
  options: {
    readonly search?: string;
    readonly sendMessage?: (message: unknown) => Promise<unknown>;
    readonly contains?: (permissions: { readonly origins: readonly string[] }) => Promise<boolean>;
    readonly request?: (permissions: { readonly origins: readonly string[] }) => Promise<boolean>;
    readonly reload?: () => void;
    readonly removeTab?: (tabId: number) => Promise<void>;
  } = {},
): Promise<{ readonly document: Document }> {
  vi.resetModules();
  const dom = new JSDOM(await readFile(new URL("./approval-request.html", import.meta.url), "utf8"), {
    url: `moz-extension://test/approval-request.html${options.search ?? "?request=approval-1"}`,
  });

  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("browser", {
    runtime: {
      sendMessage: options.sendMessage ?? vi.fn(async () => ({ active: true })),
      reload: options.reload ?? vi.fn(),
    },
    permissions: {
      contains: options.contains ?? vi.fn(async () => true),
      request: options.request ?? vi.fn(async () => true),
    },
    tabs: {
      captureVisibleTab: vi.fn(),
      getCurrent: vi.fn(async () => ({ id: 99, index: 0, active: true, windowId: 1 })),
      remove: options.removeTab ?? vi.fn(async () => undefined),
    },
  });

  await import("./approval-request.js");
  await vi.waitFor(() => {
    expect(dom.window.document.querySelector("#request-state")?.textContent).not.toBe("Checking approval...");
  });
  return { document: dom.window.document };
}
