import { createRequest, parseBoundaryResponse, type ResponseEnvelope } from "@firefox-cli/protocol";
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

  it("covers fixture controls while excluding disabled and hidden controls from interactive refs", () => {
    const { window } = new JSDOM(
      `<main>
        <form aria-label="Checkout form">
          <label for="name">Name</label>
          <input id="name" value="Nikita">
          <label><input type="checkbox" checked> Accept terms</label>
          <select aria-label="Plan"><option>Pro</option></select>
          <textarea aria-label="Notes">Ship it</textarea>
          <button>Submit</button>
          <button disabled>Disabled button</button>
          <a href="/help">Help</a>
          <input type="hidden" value="secret">
          <button hidden>Hidden button</button>
          <button style="display: none">Display none button</button>
        </form>
      </main>`,
      { url: "https://example.test/form" },
    );

    const result = createSnapshotResult(
      window.document,
      { interactiveOnly: true, compact: true, maxDepth: 6, maxOutputBytes: 10_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );

    expect(result.refs).toBe(6);
    expect(result.text).toContain('@e1 textbox "Name"');
    expect(result.text).toContain('@e2 checkbox "Accept terms" type=checkbox checked=true');
    expect(result.text).toContain('@e3 combobox "Plan"');
    expect(result.text).toContain('@e4 textbox "Notes"');
    expect(result.text).toContain('@e5 button "Submit"');
    expect(result.text).toContain('@e6 link "Help" href="/help"');
    expect(result.text).not.toContain("Disabled button");
    expect(result.text).not.toContain("Hidden button");
    expect(result.text).not.toContain("Display none button");
    expect(result.text).not.toContain("secret");
  });

  it("emits scrollable containers as interactive refs for scroll commands", () => {
    const { window } = new JSDOM(
      `<main>
        <section id="feed" aria-label="Activity feed" style="overflow-y: auto; height: 120px">
          <article>One</article>
          <article>Two</article>
        </section>
      </main>`,
      { url: "https://example.test/feed" },
    );
    const feed = window.document.querySelector("#feed");
    if (feed === null) {
      throw new Error("fixture missing feed");
    }
    Object.defineProperties(feed, {
      clientHeight: { value: 120 },
      scrollHeight: { value: 500 },
    });

    const result = createSnapshotResult(
      window.document,
      { interactiveOnly: true, compact: true, maxDepth: 4, maxOutputBytes: 10_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );

    expect(result.text).toContain('@e1 region "Activity feed" scrollable=true');
  });

  it("keeps intrinsic control roles for scrollable controls", () => {
    const { window } = new JSDOM(
      `<textarea id="notes" aria-label="Notes" style="overflow-y: auto">Long notes</textarea>`,
      { url: "https://example.test/feed" },
    );
    const notes = window.document.querySelector("#notes");
    if (notes === null) {
      throw new Error("fixture missing notes");
    }
    Object.defineProperties(notes, {
      clientHeight: { value: 120 },
      scrollHeight: { value: 500 },
    });

    const result = createSnapshotResult(
      window.document,
      { interactiveOnly: true, compact: true, maxDepth: 2, maxOutputBytes: 10_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );

    expect(result.text).toContain('@e1 textbox "Notes" scrollable=true');
    expect(result.text).not.toContain("region");
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
      "Element ref is stale or unknown.",
    );
  });

  it("resolves refs created by an earlier content request", async () => {
    const { window } = new JSDOM(
      `<label for="email">Email</label><input id="email" value="user@example.test">`,
      { url: "https://example.test/" },
    );
    const handler = createContentMessageHandler({
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
    });

    const snapshot = await handler(
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"),
    );
    const parsedSnapshot = parseBoundaryResponse(
      "extension-to-content-script",
      "snapshot",
      snapshot,
    );
    if (!parsedSnapshot.ok || !parsedSnapshot.value.ok) {
      throw new Error("snapshot failed");
    }
    const snapshotResponse = parsedSnapshot.value as Extract<
      ResponseEnvelope<"snapshot">,
      { readonly ok: true }
    >;

    const resolved = await handler(
      createRequest(
        "ref.resolve",
        { ref: "@e1", generationId: snapshotResponse.result.generationId },
        "ref-1",
      ),
    );

    const parsedResolve = parseBoundaryResponse(
      "extension-to-content-script",
      "ref.resolve",
      resolved,
    );
    expect(parsedResolve).toMatchObject({
      ok: true,
      value: {
        ok: true,
        result: {
          element: {
            ref: "@e1",
            role: "textbox",
            name: "Email",
            value: "user@example.test",
            visible: true,
          },
        },
      },
    });
  });

  it("gets text, html, value, attr, count, box, and styles by selector or ref", () => {
    const { window } = new JSDOM(
      `<main id="main" style="display: block; color: red">
        <a id="link" href="/docs">Docs</a>
        <input id="email" value="user@example.test">
        <p class="item">One</p>
        <p class="item">Two</p>
      </main>`,
      { url: "https://example.test/" },
    );
    const main = window.document.querySelector("#main");
    if (main === null) {
      throw new Error("fixture missing main");
    }
    main.getBoundingClientRect = () =>
      ({
        x: 1,
        y: 2,
        width: 300,
        height: 200,
        top: 2,
        right: 301,
        bottom: 202,
        left: 1,
        toJSON: () => ({}),
      }) as DOMRect;
    const registry = new ElementRefRegistry<Element>();
    const snapshot = handleContentScriptRequest(
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"),
      { document: window.document, registry, now: 1000 },
    ) as ResponseEnvelope<"snapshot">;
    if (!snapshot.ok) {
      throw new Error("snapshot failed");
    }
    const generationId = snapshot.result.generationId;

    expect(
      handleContentScriptRequest(createRequest("get", { kind: "text", selector: "#main" }, "g1"), {
        document: window.document,
        registry,
        now: 1001,
      }),
    ).toMatchObject({ ok: true, result: { kind: "text", value: "Docs One Two" } });
    expect(
      handleContentScriptRequest(createRequest("get", { kind: "html", selector: "#link" }, "g2"), {
        document: window.document,
        registry,
        now: 1001,
      }),
    ).toMatchObject({
      ok: true,
      result: { kind: "html", value: '<a id="link" href="/docs">Docs</a>' },
    });
    expect(
      handleContentScriptRequest(
        createRequest("get", { kind: "value", selector: "#email" }, "g3"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "value", value: "user@example.test" } });
    expect(
      handleContentScriptRequest(
        createRequest("get", { kind: "value", selector: "#main" }, "g3b"),
        {
          document: window.document,
          registry,
          now: 1001,
        },
      ),
    ).toMatchObject({ ok: true, result: { kind: "value", value: null } });
    expect(
      handleContentScriptRequest(
        createRequest("get", { kind: "attr", ref: "@e1", generationId, attribute: "href" }, "g4"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "attr", value: "/docs" } });
    expect(
      handleContentScriptRequest(createRequest("get", { kind: "count", selector: ".item" }, "g5"), {
        document: window.document,
        registry,
        now: 1001,
      }),
    ).toMatchObject({ ok: true, result: { kind: "count", value: 2 } });
    expect(
      handleContentScriptRequest(createRequest("get", { kind: "box", selector: "#main" }, "g6"), {
        document: window.document,
        registry,
        now: 1001,
      }),
    ).toMatchObject({
      ok: true,
      result: { kind: "box", value: { x: 1, y: 2, width: 300, height: 200 } },
    });
    expect(
      handleContentScriptRequest(
        createRequest("get", { kind: "styles", selector: "#main" }, "g7"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({
      ok: true,
      result: { kind: "styles", value: { display: "block", color: "rgb(255, 0, 0)" } },
    });
  });

  it("truncates large get text results deterministically", () => {
    const { window } = new JSDOM(`<main>${"x".repeat(100)}</main>`, {
      url: "https://example.test/",
    });

    const response = handleContentScriptRequest(
      createRequest("get", { kind: "text", selector: "main", maxOutputBytes: 20 }, "get-1"),
      {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      },
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "text",
        value: expect.stringContaining("[truncated]"),
        truncated: true,
      },
    });
  });

  it("keeps truncated get text output within very small byte limits", () => {
    const { window } = new JSDOM(`<main>${"x".repeat(100)}</main>`, {
      url: "https://example.test/",
    });

    const response = handleContentScriptRequest(
      createRequest("get", { kind: "text", selector: "main", maxOutputBytes: 1 }, "get-1"),
      {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      },
    ) as ResponseEnvelope<"get">;

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "text",
        truncated: true,
      },
    });
    if (response.ok && response.result.kind === "text") {
      expect(new TextEncoder().encode(response.result.value).length).toBeLessThanOrEqual(1);
    }
  });

  it("returns SELECTOR_NOT_FOUND for get selector misses", () => {
    const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });

    const response = handleContentScriptRequest(
      createRequest("get", { kind: "text", selector: "#missing" }, "get-1"),
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

  it("returns REF_NOT_FOUND when resolving an unknown ref", () => {
    const { window } = new JSDOM(`<button>Save</button>`, { url: "https://example.test/" });

    const response = handleContentScriptRequest(
      createRequest("ref.resolve", { ref: "@e1" }, "ref-1"),
      {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      },
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "REF_NOT_FOUND",
      },
    });
  });

  it("returns REF_NOT_FOUND when a ref element was detached from the document", () => {
    const { window } = new JSDOM(`<button id="save">Save</button>`, {
      url: "https://example.test/",
    });
    const registry = new ElementRefRegistry<Element>();
    createSnapshotResult(
      window.document,
      { interactiveOnly: true, compact: true, maxDepth: 2, maxOutputBytes: 10_000 },
      registry,
      1000,
    );
    window.document.querySelector("#save")?.remove();

    const response = handleContentScriptRequest(
      createRequest("ref.resolve", { ref: "@e1" }, "ref-1"),
      {
        document: window.document,
        registry,
        now: 1001,
      },
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "REF_NOT_FOUND",
      },
    });
  });

  it("returns REF_NOT_FOUND after dynamic DOM replacement keeps the same selector", () => {
    const { window } = new JSDOM(`<button id="save">Save</button>`, {
      url: "https://example.test/",
    });
    const registry = new ElementRefRegistry<Element>();
    createSnapshotResult(
      window.document,
      { interactiveOnly: true, compact: true, maxDepth: 2, maxOutputBytes: 10_000 },
      registry,
      1000,
    );
    window.document.querySelector("#save")?.replaceWith(window.document.createElement("button"));

    const response = handleContentScriptRequest(
      createRequest("ref.resolve", { ref: "@e1" }, "ref-1"),
      {
        document: window.document,
        registry,
        now: 1001,
      },
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "REF_NOT_FOUND",
      },
    });
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
