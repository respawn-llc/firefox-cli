import { createRequest } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import { ElementRefRegistry, createSnapshotResult } from "./content-snapshot.js";
import { escapeCssString } from "./content-snapshot/format.js";
import { createContentLogCaptureService } from "./content-snapshot/log-capture.js";
import { handleContentScriptRequest } from "./content-snapshot-test-support.js";

export function runCase01() {
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
}

export function runCase02() {
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
}

export function runCase03() {
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
}

export function runCase04() {
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
}

export function runCase05() {
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
}

export function runCase06() {
  const { window } = new JSDOM(`<textarea id="notes" aria-label="Notes" style="overflow-y: auto">Long notes</textarea>`, { url: "https://example.test/feed" });
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
}

export function runCase07() {
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
}

export function runCase08() {
  const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });
  const response = handleContentScriptRequest(createRequest("snapshot", { selector: "#missing" }, "snapshot-1"), {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
    now: 1000,
  });

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "SELECTOR_NOT_FOUND",
    },
  });
}

export function runCase09() {
  const { window } = new JSDOM(`<button>Save</button>`, { url: "https://example.test/" });
  const registry = new ElementRefRegistry<Element>({ ttlMs: 10 });

  createSnapshotResult(window.document, { interactiveOnly: true, compact: true, maxDepth: 2, maxOutputBytes: 10_000 }, registry, 1000);

  expect(() => registry.resolve("@e1", { now: 1011 })).toThrow("Element ref is stale or unknown.");
}
