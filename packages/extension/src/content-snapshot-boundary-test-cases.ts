import { createRequest, parseBoundaryResponse } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import { ElementRefRegistry } from "./content-snapshot.js";
import { createContentMessageHandler } from "./content.js";
import { createContentLogCaptureService } from "./content-snapshot/log-capture.js";
import { handleContentScriptRequest } from "./content-snapshot-test-support.js";

export async function runCase01() {
  const { window } = new JSDOM(`<label for="email">Email</label><input id="email" value="user@example.test">`, { url: "https://example.test/" });
  const handler = createContentMessageHandler({
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
  });

  const snapshot = await handler(createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"));
  const parsedSnapshot = parseBoundaryResponse("extension-to-content-script", "snapshot", snapshot);
  if (!parsedSnapshot.ok || !parsedSnapshot.value.ok) {
    throw new Error("snapshot failed");
  }
  const snapshotResponse = parsedSnapshot.value;

  const resolved = await handler(createRequest("ref.resolve", { ref: "@e1", generationId: snapshotResponse.result.generationId }, "ref-1"));

  const parsedResolve = parseBoundaryResponse("extension-to-content-script", "ref.resolve", resolved);
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
}

export function runCase02() {
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
  main.getBoundingClientRect = () => ({
    x: 1,
    y: 2,
    width: 300,
    height: 200,
    top: 2,
    right: 301,
    bottom: 202,
    left: 1,
    toJSON: () => ({}),
  });
  const registry = new ElementRefRegistry<Element>();
  const snapshot = parseBoundaryResponse(
    "extension-to-content-script",
    "snapshot",
    handleContentScriptRequest(createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"), { document: window.document, registry, now: 1000 }),
  );
  if (!snapshot.ok || !snapshot.value.ok) {
    throw new Error("snapshot failed");
  }
  const generationId = snapshot.value.result.generationId;

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
    handleContentScriptRequest(createRequest("get", { kind: "value", selector: "#email" }, "g3"), {
      document: window.document,
      registry,
      now: 1001,
    }),
  ).toMatchObject({ ok: true, result: { kind: "value", value: "user@example.test" } });
  expect(
    handleContentScriptRequest(createRequest("get", { kind: "value", selector: "#main" }, "g3b"), {
      document: window.document,
      registry,
      now: 1001,
    }),
  ).toMatchObject({ ok: true, result: { kind: "value", value: null } });
  expect(
    handleContentScriptRequest(createRequest("get", { kind: "attr", ref: "@e1", generationId, attribute: "href" }, "g4"), {
      document: window.document,
      registry,
      now: 1001,
    }),
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
    handleContentScriptRequest(createRequest("get", { kind: "styles", selector: "#main" }, "g7"), {
      document: window.document,
      registry,
      now: 1001,
    }),
  ).toMatchObject({
    ok: true,
    result: { kind: "styles", value: { display: "block", color: "rgb(255, 0, 0)" } },
  });
}

export function runCase03() {
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
  const snapshot = parseBoundaryResponse(
    "extension-to-content-script",
    "snapshot",
    handleContentScriptRequest(createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"), { document: window.document, registry, now: 1000 }),
  );
  if (!snapshot.ok || !snapshot.value.ok) {
    throw new Error("snapshot failed");
  }

  expect(
    handleContentScriptRequest(createRequest("is", { kind: "visible", selector: "#save" }, "i1"), {
      document: window.document,
      registry,
      now: 1001,
    }),
  ).toMatchObject({ ok: true, result: { kind: "visible", value: true } });
  expect(
    handleContentScriptRequest(createRequest("is", { kind: "visible", selector: "#hidden" }, "i2"), {
      document: window.document,
      registry,
      now: 1001,
    }),
  ).toMatchObject({ ok: true, result: { kind: "visible", value: false } });
  expect(
    handleContentScriptRequest(createRequest("is", { kind: "enabled", selector: "#disabled" }, "i3"), {
      document: window.document,
      registry,
      now: 1001,
    }),
  ).toMatchObject({ ok: true, result: { kind: "enabled", value: false } });
  expect(
    handleContentScriptRequest(createRequest("is", { kind: "enabled", selector: "#fieldset-input" }, "i4"), { document: window.document, registry, now: 1001 }),
  ).toMatchObject({ ok: true, result: { kind: "enabled", value: false } });
  expect(
    handleContentScriptRequest(createRequest("is", { kind: "enabled", selector: "#legend-button" }, "i4b"), { document: window.document, registry, now: 1001 }),
  ).toMatchObject({ ok: true, result: { kind: "enabled", value: true } });
  expect(
    handleContentScriptRequest(createRequest("is", { kind: "enabled", selector: "#disabled-option" }, "i4c"), {
      document: window.document,
      registry,
      now: 1001,
    }),
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
  expect(snapshot.value.result.generationId).toMatch(/^g/u);
  expect(
    handleContentScriptRequest(createRequest("is", { kind: "checked", selector: "#aria-check" }, "i6"), {
      document: window.document,
      registry,
      now: 1001,
    }),
  ).toMatchObject({ ok: true, result: { kind: "checked", value: true } });
}

export function runCase04() {
  const { window } = new JSDOM(`<input id="agree" type="checkbox" checked>`, {
    url: "https://example.test/",
  });
  const registry = new ElementRefRegistry<Element>();
  const snapshot = parseBoundaryResponse(
    "extension-to-content-script",
    "snapshot",
    handleContentScriptRequest(createRequest("snapshot", { interactiveOnly: true }, "snapshot-1"), { document: window.document, registry, now: 1000 }),
  );
  if (!snapshot.ok || !snapshot.value.ok) {
    throw new Error("snapshot failed");
  }

  expect(
    handleContentScriptRequest(createRequest("is", { kind: "checked", ref: "@e1", generationId: snapshot.value.result.generationId }, "is-1"), {
      document: window.document,
      registry,
      now: 1001,
    }),
  ).toMatchObject({ ok: true, result: { kind: "checked", value: true } });
}

export function runCase05() {
  const { window } = new JSDOM(`<button>Save</button><div id="bad" aria-checked="true"></div>`, {
    url: "https://example.test/",
  });

  for (const selector of ["button", "#bad"]) {
    const response = handleContentScriptRequest(createRequest("is", { kind: "checked", selector }, "is-1"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      logCapture: createContentLogCaptureService(),
      now: 1000,
    });

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
      },
    });
  }
}
