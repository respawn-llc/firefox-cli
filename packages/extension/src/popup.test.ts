import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

interface PopupStatus {
  readonly connected: boolean;
  readonly approved: boolean;
  readonly lastError?: string;
}

describe("popup approval UI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows approval action while unapproved without diagnostics or setup guidance", async () => {
    const document = await renderPopup({ connected: true, approved: false });

    expect(document.querySelector("#approve")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("#reset")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("#approval")?.textContent).toBe("Approval required");
    expect(document.querySelector("#status")?.textContent).toBe("Native host connected");

    expect(document.querySelector("h1")).toBeNull();
    expect(document.querySelector("ol")).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector("#copy-diagnostics")).toBeNull();
    expect(document.querySelector("#diagnostics")).toBeNull();
    expect(document.title).toBe("Extension approval");
    expect(document.body.textContent).not.toContain("firefox-cli");
    expect(document.body.textContent).not.toContain("Install the CLI");
    expect(document.body.textContent).not.toContain("setup native-host");
    expect(document.body.textContent).not.toContain("doctor");
  });

  it("hides approval action after approval", async () => {
    const document = await renderPopup({ connected: true, approved: true });

    expect(document.querySelector("#approve")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector("#reset")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("#approval")?.textContent).toBe("Browser control approved");
    expect(document.querySelector("#approval")?.getAttribute("data-state")).toBe("approved");
  });
});

async function renderPopup(status: PopupStatus): Promise<Document> {
  vi.resetModules();
  const dom = new JSDOM(await readFile(new URL("./popup.html", import.meta.url), "utf8"), { url: "https://example.invalid/" });

  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("browser", {
    runtime: {
      sendMessage: vi.fn(async () => status),
    },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    tabs: {
      captureVisibleTab: vi.fn(),
    },
  });

  await import("./popup.js");
  await vi.waitFor(() => {
    expect(dom.window.document.querySelector("#approval")?.textContent).not.toBe("Checking approval...");
  });
  return dom.window.document;
}
