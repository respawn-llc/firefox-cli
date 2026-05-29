import {
  MAX_LOG_ENTRIES,
  MAX_LOG_RESULT_BYTES,
  createRequest,
  parseBoundaryResponse,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  ElementRefRegistry,
  createSnapshotResult,
  handleContentScriptRequest,
} from "./content-snapshot.js";
import { describeFrame } from "./content-snapshot/accessibility.js";
import { escapeCssString } from "./content-snapshot/format.js";
import { createContentMessageHandler } from "./content.js";
import { BoundedLogBuffer, createConsoleResult } from "./content-snapshot/log-capture.js";

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

  it("resolves explicit labels for CSS-special and control IDs without selector fallback", () => {
    const { window } = new JSDOM(`<main id="main"></main>`, {
      url: "https://example.test/form",
    });
    const main = window.document.querySelector("#main");
    if (main === null) {
      throw new Error("fixture missing main");
    }

    for (const { id, label } of [
      { id: "space id", label: "Space ID" },
      { id: "bracket[id]", label: "Bracket ID" },
      { id: 'quote"id', label: "Quote ID" },
      { id: "colon:id", label: "Colon ID" },
      { id: "back\\slash", label: "Backslash ID" },
      { id: "line\nfeed", label: "Line Feed ID" },
      { id: "carriage\rreturn", label: "Carriage Return ID" },
      { id: "form\ffeed", label: "Form Feed ID" },
      { id: "unit\u001fA", label: "Unit Separator ID" },
      { id: "del\u007fend", label: "Delete ID" },
      { id: "nul\0id", label: "Nul ID" },
    ]) {
      const labelElement = window.document.createElement("label");
      labelElement.setAttribute("for", id);
      labelElement.textContent = label;
      const input = window.document.createElement("input");
      input.setAttribute("id", id);
      main.append(labelElement, input);
    }

    const missingForLabel = window.document.createElement("label");
    missingForLabel.textContent = "Should not label an empty ID";
    const emptyIdInput = window.document.createElement("input");
    emptyIdInput.setAttribute("id", "");
    main.append(missingForLabel, emptyIdInput);

    const result = createSnapshotResult(
      window.document,
      { interactiveOnly: true, compact: true, maxDepth: 3, maxOutputBytes: 20_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );

    for (const label of [
      "Space ID",
      "Bracket ID",
      "Quote ID",
      "Colon ID",
      "Backslash ID",
      "Line Feed ID",
      "Carriage Return ID",
      "Form Feed ID",
      "Unit Separator ID",
      "Delete ID",
      "Nul ID",
    ]) {
      expect(result.text).toContain(`textbox "${label}"`);
    }
    expect(result.text).not.toContain("Should not label an empty ID");
  });

  it("escapes CSS string selector values for iframe diagnostics", () => {
    const { window } = new JSDOM(`<main></main>`);
    const document = window.document;

    for (const value of [
      "space id",
      "bracket[id]",
      'quote"id',
      "colon:id",
      "back\\slash",
      "line\nfeed",
      "carriage\rreturn",
      "form\ffeed",
      "unit\u001fA",
      "unit\u001f space",
      "del\u007fend",
    ]) {
      const element = document.createElement("div");
      element.setAttribute("data-key", value);
      document.body.append(element);
      expect(document.querySelector(`[data-key="${escapeCssString(value)}"]`)).toBe(element);
    }

    const nulElement = document.createElement("div");
    nulElement.setAttribute("data-key", "nul\0id");
    document.body.append(nulElement);
    const nulSelector = `[data-key="${escapeCssString("nul\0id")}"]`;
    expect(() => document.querySelector(nulSelector)).not.toThrow();
    expect(document.querySelector(nulSelector)).toBeNull();

    expect(escapeCssString('quote"back\\')).toBe('quote\\"back\\\\');
    expect(escapeCssString("x\nA")).toBe("x\\a A");
    expect(escapeCssString("\u001fA")).toBe("\\1f A");
    expect(escapeCssString("\t space")).toBe("\\9  space");
    expect(escapeCssString("\u007f")).toBe("\\7f ");
    expect(escapeCssString("\0")).toBe("\uFFFD");
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

  it("checks visible, enabled, and checked state by selector or ref", () => {
    const { window } = new JSDOM(
      `<main>
        <button id="save">Save</button>
        <button id="disabled" disabled>Disabled</button>
        <div style="display: none"><button id="hidden">Hidden</button></div>
        <fieldset disabled>
          <legend><button id="legend-button">Legend action</button></legend>
          <input id="fieldset-input">
        </fieldset>
        <select><optgroup disabled><option id="disabled-option">Option</option></optgroup></select>
        <label><input id="agree" type="checkbox" checked> Agree</label>
        <div id="aria-check" role="checkbox" aria-checked="true">Aria checked</div>
      </main>`,
      { url: "https://example.test/" },
    );
    const registry = new ElementRefRegistry<Element>();
    const snapshot = handleContentScriptRequest(
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"),
      { document: window.document, registry, now: 1000 },
    ) as ResponseEnvelope<"snapshot">;
    if (!snapshot.ok) {
      throw new Error("snapshot failed");
    }

    expect(
      handleContentScriptRequest(
        createRequest("is", { kind: "visible", selector: "#save" }, "i1"),
        {
          document: window.document,
          registry,
          now: 1001,
        },
      ),
    ).toMatchObject({ ok: true, result: { kind: "visible", value: true } });
    expect(
      handleContentScriptRequest(
        createRequest("is", { kind: "visible", selector: "#hidden" }, "i2"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "visible", value: false } });
    expect(
      handleContentScriptRequest(
        createRequest("is", { kind: "enabled", selector: "#disabled" }, "i3"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "enabled", value: false } });
    expect(
      handleContentScriptRequest(
        createRequest("is", { kind: "enabled", selector: "#fieldset-input" }, "i4"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "enabled", value: false } });
    expect(
      handleContentScriptRequest(
        createRequest("is", { kind: "enabled", selector: "#legend-button" }, "i4b"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "enabled", value: true } });
    expect(
      handleContentScriptRequest(
        createRequest("is", { kind: "enabled", selector: "#disabled-option" }, "i4c"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "enabled", value: false } });
    expect(
      handleContentScriptRequest(
        createRequest(
          "is",
          {
            kind: "checked",
            selector: "#agree",
          },
          "i5",
        ),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "checked", value: true } });
    expect(snapshot.result.generationId).toMatch(/^g/u);
    expect(
      handleContentScriptRequest(
        createRequest("is", { kind: "checked", selector: "#aria-check" }, "i6"),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "checked", value: true } });
  });

  it("checks element state by ref", () => {
    const { window } = new JSDOM(`<input id="agree" type="checkbox" checked>`, {
      url: "https://example.test/",
    });
    const registry = new ElementRefRegistry<Element>();
    const snapshot = handleContentScriptRequest(
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"),
      { document: window.document, registry, now: 1000 },
    ) as ResponseEnvelope<"snapshot">;
    if (!snapshot.ok) {
      throw new Error("snapshot failed");
    }

    expect(
      handleContentScriptRequest(
        createRequest(
          "is",
          { kind: "checked", ref: "@e1", generationId: snapshot.result.generationId },
          "is-1",
        ),
        { document: window.document, registry, now: 1001 },
      ),
    ).toMatchObject({ ok: true, result: { kind: "checked", value: true } });
  });

  it("rejects checked state for non-checkable elements", () => {
    const { window } = new JSDOM(`<button>Save</button><div id="bad" aria-checked="true"></div>`, {
      url: "https://example.test/",
    });

    for (const selector of ["button", "#bad"]) {
      const response = handleContentScriptRequest(
        createRequest("is", { kind: "checked", selector }, "is-1"),
        {
          document: window.document,
          registry: new ElementRefRegistry<Element>(),
          now: 1000,
        },
      );

      expect(response).toMatchObject({
        ok: false,
        error: {
          code: "UNSUPPORTED_CAPABILITY",
        },
      });
    }
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

  it("waits for element state, visible text, load state, and function predicates", async () => {
    const { window } = new JSDOM(
      `<main>
        <button id="ready">Ready</button>
        <div style="display: none">Hidden Ready</div>
      </main>`,
      { url: "https://example.test/" },
    );
    Object.defineProperty(window.document, "readyState", { value: "complete", configurable: true });
    const registry = new ElementRefRegistry<Element>();

    await expect(
      handleContentScriptRequest(
        createRequest("wait", { kind: "element", selector: "#ready", state: "visible" }, "w1"),
        { document: window.document, registry, now: 1000 },
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "element",
        matched: true,
        elapsedMs: expect.any(Number),
        element: {
          tagName: "button",
          role: "button",
          visible: true,
        },
      },
    });
    await expect(
      handleContentScriptRequest(
        createRequest("wait", { kind: "element", selector: "#missing", state: "hidden" }, "w2"),
        { document: window.document, registry, now: 1000 },
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "element",
        matched: true,
      },
    });
    await expect(
      handleContentScriptRequest(createRequest("wait", { kind: "text", text: "Ready" }, "w3"), {
        document: window.document,
        registry,
        now: 1000,
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "text",
        matched: true,
        value: "Ready",
      },
    });
    await expect(
      handleContentScriptRequest(
        createRequest("wait", { kind: "load-state", state: "domcontentloaded" }, "w4"),
        { document: window.document, registry, now: 1000 },
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "load-state",
        matched: true,
      },
    });
    await expect(
      handleContentScriptRequest(
        createRequest("wait", { kind: "function", expression: "({ ready: true })" }, "w5"),
        { document: window.document, registry, now: 1000 },
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "function",
        matched: true,
        value: {
          ready: true,
        },
      },
    });
  });

  it("returns TIMEOUT for unsatisfied content waits", async () => {
    const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });

    await expect(
      handleContentScriptRequest(
        createRequest(
          "wait",
          { kind: "element", selector: "#ready", state: "visible", timeoutMs: 1, intervalMs: 1 },
          "wait-1",
        ),
        { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "TIMEOUT",
      },
    });
  });

  it("keeps stale refs as REF_NOT_FOUND even for hidden waits", async () => {
    const { window } = new JSDOM(`<button id="save">Save</button>`, {
      url: "https://example.test/",
    });
    const registry = new ElementRefRegistry<Element>();
    const snapshot = handleContentScriptRequest(
      createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"),
      { document: window.document, registry, now: 1000 },
    ) as ResponseEnvelope<"snapshot">;
    if (!snapshot.ok) {
      throw new Error("snapshot failed");
    }
    window.document.querySelector("#save")?.remove();

    await expect(
      handleContentScriptRequest(
        createRequest(
          "wait",
          {
            kind: "element",
            ref: "@e1",
            generationId: snapshot.result.generationId,
            state: "hidden",
          },
          "wait-1",
        ),
        { document: window.document, registry, now: 1001 },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "REF_NOT_FOUND",
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

  it("emits valid iframe diagnostic selectors for unsafe id and name values", () => {
    const { window } = new JSDOM(`<main></main>`);
    const document = window.document;

    const simple = document.createElement("iframe");
    simple.setAttribute("id", "child");
    document.body.append(simple);
    expect(describeFrame(simple)).toBe("iframe#child");
    expect(document.querySelector(describeFrame(simple))).toBe(simple);

    const unsafeId = 'frame:id[1]"\\\n';
    const idFrame = document.createElement("iframe");
    idFrame.setAttribute("id", unsafeId);
    document.body.append(idFrame);
    const idSelector = describeFrame(idFrame);
    expect(idSelector).toBe(`iframe[id="${escapeCssString(unsafeId)}"]`);
    expect(document.querySelector(idSelector)).toBe(idFrame);

    const unsafeName = 'quote"name\\\nA';
    const namedFrame = document.createElement("iframe");
    namedFrame.setAttribute("name", unsafeName);
    document.body.append(namedFrame);
    const nameSelector = describeFrame(namedFrame);
    expect(nameSelector).toBe(`iframe[name="${escapeCssString(unsafeName)}"]`);
    expect(document.querySelector(nameSelector)).toBe(namedFrame);

    const nulIdFrame = document.createElement("iframe");
    nulIdFrame.setAttribute("id", "nul\0id");
    document.body.append(nulIdFrame);
    const nulIdSelector = describeFrame(nulIdFrame);
    expect(() => document.querySelector(nulIdSelector)).not.toThrow();
    expect(document.querySelector(nulIdSelector)).toBeNull();
  });

  it("finds elements by Phase 8 locators and lists frames through the command boundary", () => {
    const { window } = new JSDOM(
      `<main>
        <button>First</button>
        <button aria-label="Second action">Second</button>
        <label for="email">Email address</label>
        <input id="email">
        <section data-testid="account-card">Account</section>
        <iframe title="Child frame" src="https://frame.test/app"></iframe>
      </main>`,
      { url: "https://example.test/" },
    );
    const base = {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    };

    expect(
      handleContentScriptRequest(
        createRequest("find", { kind: "role", value: "button", nth: 1 }, "find-role-1"),
        base,
      ),
    ).toMatchObject({
      ok: true,
      result: {
        elements: [{ role: "button", name: "Second action" }],
      },
    });
    expect(
      handleContentScriptRequest(
        createRequest("find", { kind: "label", value: "email" }, "find-label-1"),
        base,
      ),
    ).toMatchObject({
      ok: true,
      result: {
        elements: [{ tagName: "input", name: "Email address" }],
      },
    });
    expect(
      handleContentScriptRequest(
        createRequest("find", { kind: "testid", value: "account-card", first: true }, "find-tid-1"),
        base,
      ),
    ).toMatchObject({
      ok: true,
      result: {
        elements: [{ tagName: "section", text: "Account" }],
      },
    });
    expect(handleContentScriptRequest(createRequest("frame", {}, "frame-1"), base)).toMatchObject({
      ok: true,
      result: {
        frames: [
          {
            index: 0,
            selector: "iframe:nth-of-type(1)",
            title: "Child frame",
            url: "https://frame.test/app",
          },
        ],
      },
    });
  });

  it("handles clipboard, storage, dialog status, logs, errors, and highlight commands", () => {
    const { window } = new JSDOM(
      `<main>
        <input id="clip" value="copied">
        <button id="highlight">Highlight me</button>
      </main>`,
      { url: "https://example.test/", pretendToBeVisual: true },
    );
    const base = {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    };

    expect(
      handleContentScriptRequest(
        createRequest("clipboard", { action: "copy", selector: "#clip" }, "copy-1"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "copy", ok: true, text: "copied" } });
    expect(
      handleContentScriptRequest(
        createRequest(
          "clipboard",
          { action: "paste", selector: "#clip", text: "pasted" },
          "paste-1",
        ),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "paste", ok: true } });
    expect(window.document.querySelector<HTMLInputElement>("#clip")?.value).toBe("pasted");

    expect(
      handleContentScriptRequest(
        createRequest("storage", { area: "local", action: "set", key: "phase", value: "8" }, "s1"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { area: "local", action: "set", ok: true } });
    expect(
      handleContentScriptRequest(
        createRequest("storage", { area: "local", action: "get", key: "phase" }, "s2"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { area: "local", action: "get", value: "8" } });
    expect(
      handleContentScriptRequest(
        createRequest("storage", { area: "local", action: "get" }, "s3"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { entries: { phase: "8" } } });

    expect(
      handleContentScriptRequest(createRequest("dialog", { action: "status" }, "dialog-1"), base),
    ).toMatchObject({ ok: true, result: { action: "status", handled: false } });

    handleContentScriptRequest(
      createRequest("console", { action: "clear" }, "console-clear"),
      base,
    );
    captureConsoleLogWithoutStdout("phase8-log", 42);
    expect(
      handleContentScriptRequest(
        createRequest("console", { action: "list" }, "console-list"),
        base,
      ),
    ).toMatchObject({
      ok: true,
      result: {
        entries: [expect.objectContaining({ level: "log", text: "phase8-log 42" })],
      },
    });

    handleContentScriptRequest(createRequest("errors", { action: "clear" }, "errors-clear"), base);
    window.dispatchEvent(new window.ErrorEvent("error", { message: "phase8-error" }));
    expect(
      handleContentScriptRequest(createRequest("errors", { action: "list" }, "errors-list"), base),
    ).toMatchObject({
      ok: true,
      result: {
        errors: [expect.objectContaining({ level: "error", text: "phase8-error" })],
      },
    });

    expect(
      handleContentScriptRequest(
        createRequest("highlight", { selector: "#highlight", durationMs: 1000 }, "highlight-1"),
        base,
      ),
    ).toMatchObject({
      ok: true,
      result: {
        ok: true,
        element: { role: "button", name: "Highlight me" },
      },
    });
    const highlighted = window.document.querySelector<HTMLElement>("#highlight");
    expect(highlighted?.dataset.firefoxCliHighlight).toBe("true");
    expect(highlighted?.style.outline).toContain("#ff9500");
  });

  it("captures facade-installed console logs in the same buffer cleared by content commands", () => {
    const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });
    const base = {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    };

    handleContentScriptRequest(
      createRequest("console", { action: "clear" }, "console-clear"),
      base,
    );
    captureConsoleLogWithoutStdout("facade-load-log");

    expect(
      handleContentScriptRequest(
        createRequest("console", { action: "list" }, "console-list"),
        base,
      ),
    ).toMatchObject({
      ok: true,
      result: {
        entries: [expect.objectContaining({ level: "log", text: "facade-load-log" })],
      },
    });

    handleContentScriptRequest(
      createRequest("console", { action: "clear" }, "console-clear-2"),
      base,
    );
    expect(
      handleContentScriptRequest(
        createRequest("console", { action: "list" }, "console-list-2"),
        base,
      ),
    ).toMatchObject({
      ok: true,
      result: {
        entries: [],
      },
    });
  });

  it("bounds console capture by retained entry count and preserves newest order", () => {
    const buffer = new BoundedLogBuffer("entries");
    for (let index = 0; index < MAX_LOG_ENTRIES + 3; index += 1) {
      buffer.push({ level: "log", text: `bounded-log-${index}`, timestamp: index });
    }
    const snapshot = buffer.snapshot();

    expect(snapshot.entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(snapshot.entries[0]?.text).toBe("bounded-log-3");
    expect(snapshot.entries.at(-1)?.text).toBe(`bounded-log-${MAX_LOG_ENTRIES + 2}`);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.droppedEntries).toBe(3);
  });

  it("bounds console capture by serialized result bytes and truncates oversized retained text", () => {
    const buffer = new BoundedLogBuffer("entries");

    buffer.push({ level: "log", text: "x".repeat(MAX_LOG_RESULT_BYTES * 2), timestamp: 1 });
    const snapshot = buffer.snapshot();

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.text).toContain("[truncated]");
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.droppedEntries).toBe(0);
    expect(buffer.encodedResultBytes()).toBeLessThanOrEqual(MAX_LOG_RESULT_BYTES);
  });

  it("resets console buffer entries and truncation metadata on clear", () => {
    const buffer = new BoundedLogBuffer("entries");

    for (let index = 0; index < MAX_LOG_ENTRIES + 1; index += 1) {
      buffer.push({ level: "log", text: `clear-reset-${index}`, timestamp: index });
    }
    buffer.clear();

    expect(buffer.snapshot()).toEqual({
      entries: [],
      truncated: false,
      droppedEntries: 0,
    });
  });

  it("bounds error capture by retained entry count", () => {
    const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });
    const base = {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    };

    handleContentScriptRequest(createRequest("errors", { action: "clear" }, "errors-clear"), base);
    for (let index = 0; index < MAX_LOG_ENTRIES + 2; index += 1) {
      window.dispatchEvent(new window.ErrorEvent("error", { message: `bounded-error-${index}` }));
    }

    const response = handleContentScriptRequest(
      createRequest("errors", { action: "list" }, "errors-list"),
      base,
    ) as ResponseEnvelope<"errors">;

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.errors).toHaveLength(MAX_LOG_ENTRIES);
      expect(response.result.errors?.[0]?.text).toBe("bounded-error-2");
      expect(response.result.errors?.at(-1)?.text).toBe(`bounded-error-${MAX_LOG_ENTRIES + 1}`);
      expect(response.result.truncated).toBe(true);
      expect(response.result.droppedEntries).toBe(2);
    }
  });

  it("normalizes legacy symbol log state while preserving push, spread, and length clear compatibility", () => {
    const stateKey = Symbol.for("firefox-cli.contentSnapshot.logCaptureState");
    const global = globalThis as typeof globalThis & {
      [stateKey]?: unknown;
    };
    const savedState = global[stateKey];

    try {
      global[stateKey] = {
        installed: true,
        consoleEntries: [{ level: "log", text: "legacy-console", timestamp: 1 }],
        errorEntries: [{ level: "error", text: "legacy-error", timestamp: 2 }],
        capturedWindows: new WeakSet<Window>(),
      };

      expect(createConsoleResult("list")).toMatchObject({
        entries: [{ level: "log", text: "legacy-console", timestamp: 1 }],
      });

      const normalized = (
        global[stateKey] as {
          readonly consoleEntries: {
            push(entry: { level: string; text: string; timestamp: number }): number;
            length: number;
            [Symbol.iterator](): Iterator<{ level: string; text: string; timestamp: number }>;
          };
        }
      ).consoleEntries;
      normalized.push({ level: "log", text: "legacy-push", timestamp: 3 });
      expect([...normalized].map((entry) => entry.text)).toEqual(["legacy-console", "legacy-push"]);
      normalized.length = 0;
      expect(createConsoleResult("list")).toMatchObject({
        entries: [],
        truncated: false,
        droppedEntries: 0,
      });
    } finally {
      if (savedState === undefined) {
        delete global[stateKey];
      } else {
        global[stateKey] = savedState;
      }
    }
  });

  it("drops entries that cannot fit even after text truncation", () => {
    const droppedOnlyBudget = encodedByteLength(
      JSON.stringify({
        action: "list",
        ok: true,
        entries: [],
        truncated: true,
        droppedEntries: 1,
      }),
    );
    const suffixEntryBudget = encodedByteLength(
      JSON.stringify({
        action: "list",
        ok: true,
        entries: [{ level: "log", text: "... [truncated]", timestamp: 1 }],
        truncated: true,
        droppedEntries: 0,
      }),
    );
    expect(suffixEntryBudget).toBeGreaterThan(droppedOnlyBudget);

    const buffer = new BoundedLogBuffer("entries", {
      maxEntries: 1,
      maxResultBytes: droppedOnlyBudget,
    });
    buffer.push({ level: "log", text: "x".repeat(1000), timestamp: 1 });

    expect(buffer.snapshot()).toEqual({
      entries: [],
      truncated: true,
      droppedEntries: 1,
    });
    expect(buffer.encodedResultBytes()).toBeLessThanOrEqual(droppedOnlyBudget);
  });

  it("installs log capture only from a cold facade import and keeps buffers across reloads", async () => {
    const stateKey = Symbol.for("firefox-cli.contentSnapshot.logCaptureState");
    const global = globalThis as typeof globalThis & {
      [stateKey]?: unknown;
    };
    const savedState = global[stateKey];
    const savedLog = console.log;
    const passthroughCalls: unknown[][] = [];

    try {
      delete global[stateKey];
      console.log = (...args: unknown[]) => {
        passthroughCalls.push(args);
      };

      const firstFacade = (await import(
        /* @vite-ignore */ `./content-snapshot.js?cold=${Date.now()}-first`
      )) as typeof import("./content-snapshot.js");
      const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });
      const base = {
        document: window.document,
        registry: new firstFacade.ElementRefRegistry<Element>(),
        now: 1000,
      };

      firstFacade.handleContentScriptRequest(
        createRequest("console", { action: "clear" }, "console-clear"),
        base,
      );
      console.log("cold-facade-log");

      expect(
        firstFacade.handleContentScriptRequest(
          createRequest("console", { action: "list" }, "console-list"),
          base,
        ),
      ).toMatchObject({
        ok: true,
        result: {
          entries: [expect.objectContaining({ level: "log", text: "cold-facade-log" })],
        },
      });

      const secondFacade = (await import(
        /* @vite-ignore */ `./content-snapshot.js?cold=${Date.now()}-second`
      )) as typeof import("./content-snapshot.js");
      console.log("after-facade-reload");

      const listed = secondFacade.handleContentScriptRequest(
        createRequest("console", { action: "list" }, "console-list-after-reload"),
        base,
      ) as ResponseEnvelope<"console">;
      const reloadedEntryCount =
        listed.ok && listed.result.entries !== undefined
          ? listed.result.entries.filter((entry) => entry.text === "after-facade-reload").length
          : 0;
      expect(listed).toMatchObject({
        ok: true,
        result: {
          entries: [
            expect.objectContaining({ text: "cold-facade-log" }),
            expect.objectContaining({ text: "after-facade-reload" }),
          ],
        },
      });
      expect(reloadedEntryCount).toBe(1);
      expect(passthroughCalls).toEqual([["cold-facade-log"], ["after-facade-reload"]]);
    } finally {
      console.log = savedLog;
      if (savedState === undefined) {
        delete global[stateKey];
      } else {
        global[stateKey] = savedState;
      }
    }
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

function captureConsoleLogWithoutStdout(...args: readonly unknown[]): void {
  const originalWrite = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    console.log(...args);
  } finally {
    process.stdout.write = originalWrite;
  }
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
