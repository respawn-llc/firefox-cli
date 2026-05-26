import { createRequest, parseBoundaryResponse } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  ElementRefRegistry,
  createSnapshotResult,
  handleContentScriptRequest,
} from "./content-snapshot.js";
import { createContentMessageHandler } from "./content.js";

describe("content snapshot", () => {
  it("emits compact interactive refs with accessible names", () => {
    const { window } = new JSDOM(
      `<main id="main">
        <h1>Checkout</h1>
        <label for="email">Email address</label>
        <input id="email" type="email" placeholder="you@example.com" required>
        <button aria-label="Submit order">Pay</button>
        <a href="/terms">Terms</a>
        <p>Non-interactive copy</p>
      </main>`,
      { url: "https://example.test/checkout" },
    );
    const registry = new ElementRefRegistry<Element>();

    const result = createSnapshotResult(
      window.document,
      {
        interactiveOnly: true,
        compact: true,
        maxDepth: 4,
        selector: "#main",
        maxOutputBytes: 10_000,
      },
      registry,
      1000,
    );

    expect(result).toMatchObject({
      refs: 3,
      truncated: false,
    });
    expect(result.generationId).toMatch(/^g[0-9a-z]+-[0-9a-z]+$/u);
    expect(result.text).toContain('title "(untitled)"');
    expect(result.text).toContain("url https://example.test/checkout");
    expect(result.text).toContain('@e1 textbox "Email address" type=email required=true');
    expect(result.text).toContain('@e2 button "Submit order"');
    expect(result.text).toContain('@e3 link "Terms" href="/terms"');
    expect(result.text).not.toContain("Non-interactive copy");
    expect(registry.resolve("@e1", { now: 1000 })).toBe(window.document.querySelector("#email"));
  });

  it("emits labelled verbose fields when compact mode is disabled", () => {
    const { window } = new JSDOM(`<button aria-label="Save changes">Save</button>`, {
      url: "https://example.test/settings",
    });

    const result = createSnapshotResult(
      window.document,
      { interactiveOnly: true, compact: false, maxDepth: 2, maxOutputBytes: 10_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );

    expect(result.text).toContain('ref=@e1 role=button tag=button name="Save changes"');
    expect(result.text).not.toContain('@e1 button "Save changes"');
  });

  it("returns selector errors through the content request boundary", () => {
    const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });
    const response = handleContentScriptRequest(
      createRequest("snapshot", { selector: "#missing" }, "snapshot-1"),
      {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      },
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "SELECTOR_NOT_FOUND",
      },
    });
  });

  it("expires stale refs with re-snapshot guidance", () => {
    const { window } = new JSDOM(`<button>Save</button>`, { url: "https://example.test/" });
    const registry = new ElementRefRegistry<Element>({ ttlMs: 10 });

    createSnapshotResult(
      window.document,
      { interactiveOnly: true, compact: true, maxDepth: 2, maxOutputBytes: 10_000 },
      registry,
      1000,
    );

    expect(() => registry.resolve("@e1", { now: 1011 })).toThrow(
      "Run `firefox-cli snapshot -i` again.",
    );
  });

  it("reports iframe diagnostics without actionable iframe refs", () => {
    const { window } = new JSDOM(`<iframe id="child" src="https://frame.test/"></iframe>`, {
      url: "https://example.test/",
    });

    const result = createSnapshotResult(
      window.document,
      { interactiveOnly: false, compact: true, maxDepth: 2, maxOutputBytes: 10_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );

    expect(result.frames).toEqual([
      {
        selector: "iframe#child",
        url: "https://frame.test/",
        unsupported: true,
        reason: "Iframe refs are prototype-gated.",
      },
    ]);
    expect(result.text).toContain("iframe");
  });

  it("returns an async protocol envelope for browser.tabs.sendMessage", async () => {
    const { window } = new JSDOM(`<button>Save</button>`, { url: "https://example.test/" });
    const request = createRequest("snapshot", { interactiveOnly: true }, "snapshot-1");
    const response = await createContentMessageHandler({
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
    })(request);

    const parsed = parseBoundaryResponse("extension-to-content-script", "snapshot", response);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({
        ok: true,
        id: "snapshot-1",
        result: {
          refs: 1,
        },
      });
    }
  });
});
