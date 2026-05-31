import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ElementRefRegistry, createSnapshotResult } from "../content-snapshot.js";
import { escapeCssString } from "./format.js";
import { defaultSnapshotSemantics } from "./snapshot-semantics.js";

function documentFor(html: string): Document {
  return new JSDOM(html, { url: "https://example.test/" }).window.document;
}

describe("snapshot semantics", () => {
  it("documents supported role and accessible-name precedence", () => {
    const document = documentFor(
      `<main>
        <span id="first">First</span>
        <span id="second">Second</span>
        <button id="aria-label" aria-label="ARIA label" aria-labelledby="first">Text</button>
        <button id="labelled-by" aria-labelledby="first second">Ignored text</button>
        <label for="explicit">Explicit label</label><input id="explicit" placeholder="Fallback">
        <label><input id="wrapped" value="Fallback value"> Wrapped label</label>
        <img id="image" alt="Alt text" title="Title fallback">
        <input id="range" type="range">
        <a id="plain-anchor">Plain anchor</a>
        <a id="link" href="/docs">Docs</a>
      </main>`,
    );

    expect(defaultSnapshotSemantics.getAccessibleName(required(document, "#aria-label"))).toBe(
      "ARIA label",
    );
    expect(defaultSnapshotSemantics.getAccessibleName(required(document, "#labelled-by"))).toBe(
      "First Second",
    );
    expect(defaultSnapshotSemantics.getAccessibleName(required(document, "#explicit"))).toBe(
      "Explicit label",
    );
    expect(defaultSnapshotSemantics.getAccessibleName(required(document, "#wrapped"))).toBe(
      "Wrapped label",
    );
    expect(defaultSnapshotSemantics.getAccessibleName(required(document, "#image"))).toBe(
      "Alt text",
    );
    expect(defaultSnapshotSemantics.getRole(required(document, "#range"))).toBe("slider");
    expect(defaultSnapshotSemantics.getRole(required(document, "#plain-anchor"))).toBe("generic");
    expect(defaultSnapshotSemantics.getRole(required(document, "#link"))).toBe("link");
  });

  it("treats hidden subtrees as invisible for snapshots and state checks", () => {
    const document = documentFor(
      `<main>
        <button id="visible">Visible</button>
        <section hidden><button id="hidden-ancestor">Hidden ancestor</button></section>
        <section aria-hidden="true"><button id="aria-hidden-ancestor">ARIA hidden</button></section>
        <button id="display-none" style="display: none">Display none</button>
        <button id="visibility-hidden" style="visibility: hidden">Visibility hidden</button>
        <input id="hidden-input" type="hidden" value="secret">
      </main>`,
    );

    expect(defaultSnapshotSemantics.isVisible(required(document, "#visible"))).toBe(true);
    for (const selector of [
      "#hidden-ancestor",
      "#aria-hidden-ancestor",
      "#display-none",
      "#visibility-hidden",
      "#hidden-input",
    ]) {
      expect(defaultSnapshotSemantics.isVisible(required(document, selector))).toBe(false);
    }

    const snapshot = createSnapshotResult(
      document,
      { interactiveOnly: true, compact: true, maxDepth: 4, maxOutputBytes: 10_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );
    expect(snapshot.text).toContain('@e1 button "Visible"');
    expect(snapshot.text).not.toContain("Hidden ancestor");
    expect(snapshot.text).not.toContain("ARIA hidden");
    expect(snapshot.text).not.toContain("Display none");
    expect(snapshot.text).not.toContain("Visibility hidden");
    expect(snapshot.text).not.toContain("secret");
  });

  it("documents disabled fieldset, legend, optgroup, and aria-disabled semantics", () => {
    const document = documentFor(
      `<main>
        <fieldset disabled>
          <legend><button id="legend-button">Legend action</button></legend>
          <input id="fieldset-input">
        </fieldset>
        <select>
          <optgroup disabled><option id="optgroup-option">Disabled option</option></optgroup>
        </select>
        <button id="aria-disabled" aria-disabled="true">ARIA disabled</button>
      </main>`,
    );

    expect(defaultSnapshotSemantics.isDisabled(required(document, "#legend-button"))).toBe(false);
    expect(defaultSnapshotSemantics.isDisabled(required(document, "#fieldset-input"))).toBe(true);
    expect(defaultSnapshotSemantics.isDisabled(required(document, "#optgroup-option"))).toBe(true);
    expect(defaultSnapshotSemantics.isDisabled(required(document, "#aria-disabled"))).toBe(true);

    const snapshot = createSnapshotResult(
      document,
      { interactiveOnly: true, compact: true, maxDepth: 4, maxOutputBytes: 10_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );
    expect(snapshot.text).toContain('@e1 button "Legend action"');
    expect(snapshot.text).not.toContain("ARIA disabled");
  });

  it("documents scrollable region detection without overriding native control roles", () => {
    const document = documentFor(
      `<main>
        <section id="feed" aria-label="Activity feed" style="overflow-y: auto; height: 100px">
          <article>One</article>
        </section>
        <textarea id="notes" aria-label="Notes" style="overflow-y: scroll">Long notes</textarea>
      </main>`,
    );
    const feed = required(document, "#feed");
    const notes = required(document, "#notes");
    for (const element of [feed, notes]) {
      Object.defineProperties(element, {
        clientHeight: { value: 100 },
        scrollHeight: { value: 400 },
      });
    }

    expect(defaultSnapshotSemantics.isScrollableContainer(feed)).toBe(true);
    expect(defaultSnapshotSemantics.getRole(feed)).toBe("region");
    expect(defaultSnapshotSemantics.isScrollableContainer(notes)).toBe(true);
    expect(defaultSnapshotSemantics.getRole(notes)).toBe("textbox");

    const snapshot = createSnapshotResult(
      document,
      { interactiveOnly: true, compact: true, maxDepth: 3, maxOutputBytes: 10_000 },
      new ElementRefRegistry<Element>(),
      1000,
    );
    expect(snapshot.text).toContain('@e1 region "Activity feed" scrollable=true');
    expect(snapshot.text).toContain('@e2 textbox "Notes" scrollable=true');
  });

  it("documents iframe diagnostic selector semantics", () => {
    const document = documentFor(`<main></main>`);
    const simple = document.createElement("iframe");
    simple.setAttribute("id", "child");
    document.body.append(simple);

    const unsafeId = 'frame:id[1]"\\\n';
    const idFrame = document.createElement("iframe");
    idFrame.setAttribute("id", unsafeId);
    document.body.append(idFrame);

    const unsafeName = 'quote"name\\\nA';
    const namedFrame = document.createElement("iframe");
    namedFrame.setAttribute("name", unsafeName);
    document.body.append(namedFrame);

    const anonymousFrame = document.createElement("iframe");
    document.body.append(anonymousFrame);

    expect(defaultSnapshotSemantics.describeFrame(simple)).toBe("iframe#child");
    expect(defaultSnapshotSemantics.describeFrame(idFrame)).toBe(
      `iframe[id="${escapeCssString(unsafeId)}"]`,
    );
    expect(defaultSnapshotSemantics.describeFrame(namedFrame)).toBe(
      `iframe[name="${escapeCssString(unsafeName)}"]`,
    );
    expect(defaultSnapshotSemantics.describeFrame(anonymousFrame)).toBe("iframe:nth-of-type(4)");
  });
});

function required(document: Document, selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`Missing fixture element: ${selector}`);
  }
  return element;
}
