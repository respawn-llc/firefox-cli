import { createRequest } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import { ElementRefRegistry, createSnapshotResult } from "./content-snapshot.js";
import { describeFrame } from "./content-snapshot/accessibility.js";
import { escapeCssString } from "./content-snapshot/format.js";
import { createContentLogCaptureService, installLogCapture } from "./content-snapshot/log-capture.js";
import {
  handleContentScriptRequest,
  captureConsoleLogWithoutStdout,
  readHighlightFields,
  createManualHighlightScheduler,
} from "./content-snapshot-test-support.js";

export function runCase01() {
  const { window } = new JSDOM(`<button id="save">Save</button>`, {
    url: "https://example.test/",
  });
  const registry = new ElementRefRegistry<Element>();
  createSnapshotResult(window.document, { interactiveOnly: true, compact: true, maxDepth: 2, maxOutputBytes: 10_000 }, registry, 1000);
  window.document.querySelector("#save")?.replaceWith(window.document.createElement("button"));

  const response = handleContentScriptRequest(createRequest("ref.resolve", { ref: "@e1" }, "ref-1"), {
    document: window.document,
    registry,
    now: 1001,
  });

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "REF_NOT_FOUND",
    },
  });
}

export function runCase02() {
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
}

export function runCase03() {
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
}

export function runCase04() {
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
    logCapture: createContentLogCaptureService(),
    now: 1000,
  };

  expect(handleContentScriptRequest(createRequest("find", { kind: "role", value: "button", nth: 1 }, "find-role-1"), base)).toMatchObject({
    ok: true,
    result: {
      elements: [{ role: "button", name: "Second action" }],
    },
  });
  expect(handleContentScriptRequest(createRequest("find", { kind: "label", value: "email" }, "find-label-1"), base)).toMatchObject({
    ok: true,
    result: {
      elements: [{ tagName: "input", name: "Email address" }],
    },
  });
  expect(handleContentScriptRequest(createRequest("find", { kind: "testid", value: "account-card", first: true }, "find-tid-1"), base)).toMatchObject({
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
}

export function runCase05() {
  const { window } = new JSDOM(
    `<main>
        <input id="clip" value="copied">
        <button id="highlight">Highlight me</button>
      </main>`,
    { url: "https://example.test/", pretendToBeVisual: true },
  );
  const logCapture = createContentLogCaptureService();
  const windowLogHandle = logCapture.installWindow(window.document.defaultView);
  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture,
    now: 1000,
  };
  const globalLogHandle = installLogCapture();

  try {
    expect(handleContentScriptRequest(createRequest("clipboard", { action: "copy", selector: "#clip" }, "copy-1"), base)).toMatchObject({
      ok: true,
      result: { action: "copy", ok: true, text: "copied" },
    });
    expect(handleContentScriptRequest(createRequest("clipboard", { action: "paste", selector: "#clip", text: "pasted" }, "paste-1"), base)).toMatchObject({
      ok: true,
      result: { action: "paste", ok: true },
    });
    expect(window.document.querySelector<HTMLInputElement>("#clip")?.value).toBe("pasted");

    expect(handleContentScriptRequest(createRequest("storage", { area: "local", action: "set", key: "phase", value: "8" }, "s1"), base)).toMatchObject({
      ok: true,
      result: { area: "local", action: "set", ok: true },
    });
    expect(handleContentScriptRequest(createRequest("storage", { area: "local", action: "get", key: "phase" }, "s2"), base)).toMatchObject({
      ok: true,
      result: { area: "local", action: "get", value: "8" },
    });
    expect(handleContentScriptRequest(createRequest("storage", { area: "local", action: "get" }, "s3"), base)).toMatchObject({
      ok: true,
      result: { entries: { phase: "8" } },
    });

    expect(handleContentScriptRequest(createRequest("dialog", { action: "status" }, "dialog-1"), base)).toMatchObject({
      ok: true,
      result: { action: "status", handled: false },
    });

    expect(handleContentScriptRequest(createRequest("console", { action: "clear" }, "console-clear"), base)).toMatchObject({ ok: true });
    captureConsoleLogWithoutStdout("phase8-log", 42);
    expect(handleContentScriptRequest(createRequest("console", { action: "list" }, "console-list"), base)).toMatchObject({
      ok: true,
      result: {
        entries: [expect.objectContaining({ level: "log", text: "phase8-log 42" })],
      },
    });

    expect(handleContentScriptRequest(createRequest("errors", { action: "clear" }, "errors-clear"), base)).toMatchObject({ ok: true });
    window.dispatchEvent(new window.ErrorEvent("error", { message: "phase8-error" }));
    expect(handleContentScriptRequest(createRequest("errors", { action: "list" }, "errors-list"), base)).toMatchObject({
      ok: true,
      result: {
        errors: [expect.objectContaining({ level: "error", text: "phase8-error" })],
      },
    });

    expect(handleContentScriptRequest(createRequest("highlight", { selector: "#highlight" }, "highlight-1"), base)).toMatchObject({
      ok: true,
      result: {
        ok: true,
        element: { role: "button", name: "Highlight me" },
      },
    });
    const highlighted = window.document.querySelector<HTMLElement>("#highlight");
    expect(highlighted?.dataset.firefoxCliHighlight).toBe("true");
    expect(highlighted?.style.outline).toContain("#ff9500");
  } finally {
    windowLogHandle.dispose();
    globalLogHandle.dispose();
  }
}

export function runCase06() {
  const { window } = new JSDOM(
    `<main>
        <button id="target" data-firefox-cli-highlight="existing" style="outline: 1px solid red; outline-offset: 4px;">Target</button>
        <button id="other" data-firefox-cli-highlight="true" style="outline: 2px dotted blue; outline-offset: 8px;">Other</button>
      </main>`,
    { url: "https://example.test/", pretendToBeVisual: true },
  );
  const target = window.document.querySelector<HTMLElement>("#target");
  const other = window.document.querySelector<HTMLElement>("#other");
  if (target === null || other === null) {
    throw new Error("fixture missing highlight elements");
  }
  const scheduler = createManualHighlightScheduler();
  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
    now: 1000,
    highlightScheduler: scheduler.scheduler,
  };
  const originalTarget = readHighlightFields(target);
  const originalOther = readHighlightFields(other);

  expect(handleContentScriptRequest(createRequest("highlight", { selector: "#target", durationMs: 100 }, "highlight-timed"), base)).toMatchObject({
    ok: true,
    result: { ok: true },
  });
  expect(target.getAttribute("data-firefox-cli-highlight")).toBe("true");
  expect(target.style.outline).toContain("#ff9500");
  expect(readHighlightFields(other)).toEqual(originalOther);
  expect(scheduler.activeTimers()).toHaveLength(1);

  scheduler.runOnlyTimer();

  expect(readHighlightFields(target)).toEqual(originalTarget);
  expect(readHighlightFields(other)).toEqual(originalOther);
  expect(scheduler.activeTimers()).toHaveLength(0);
}
