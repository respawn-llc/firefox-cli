import { createRequest, parseBoundaryResponse } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import { ElementRefRegistry } from "./content-snapshot.js";
import { createContentMessageHandler } from "./content.js";
import { startContentScriptRuntime } from "./content-runtime.js";
import {
  createConsoleResult,
  createContentLogCaptureService,
  createErrorsResult,
  installLogCapture,
  installWindowLogCapture,
  restoreLogCapture,
  restoreWindowLogCapture,
  type ContentLogCaptureService,
} from "./content-snapshot/log-capture.js";
import { captureConsoleLogWithoutStdout, createFakeContentRuntime, getConsoleLog, setConsoleLog, writeConsoleLog } from "./content-snapshot-test-support.js";

export async function runCase01() {
  const { window } = new JSDOM(`<button>Save</button>`, { url: "https://example.test/" });
  const registrationOrder: string[] = [];
  const runtime = createFakeContentRuntime(registrationOrder);
  const realLogCapture = createContentLogCaptureService();
  const logCapture = {
    installGlobal: () => {
      registrationOrder.push("installGlobal");
      return realLogCapture.installGlobal();
    },
    installWindow: (view: Window | null) => {
      registrationOrder.push("installWindow");
      return realLogCapture.installWindow(view);
    },
    createConsoleResult: (action, protocolVersion) => realLogCapture.createConsoleResult(action, protocolVersion),
    createErrorsResult: (action, protocolVersion) => realLogCapture.createErrorsResult(action, protocolVersion),
  } satisfies ContentLogCaptureService;
  restoreLogCapture();
  createConsoleResult("clear");

  const lifecycle = startContentScriptRuntime({
    browserRuntime: runtime.browserRuntime,
    document: window.document,
    logCapture,
    now: 1000,
  });

  expect(registrationOrder).toEqual(["installGlobal", "installWindow", "addListener"]);
  expect(runtime.listenerCount()).toBe(1);
  captureConsoleLogWithoutStdout("runtime-log-before-message");
  const response = await runtime.emit(createRequest("console", { action: "list" }, "runtime-console-list"));
  const parsed = parseBoundaryResponse("extension-to-content-script", "console", response);

  expect(parsed).toMatchObject({
    ok: true,
    value: {
      ok: true,
      result: {
        entries: [expect.objectContaining({ text: "runtime-log-before-message" })],
      },
    },
  });

  lifecycle.dispose();
  expect(runtime.listenerCount()).toBe(0);
  captureConsoleLogWithoutStdout("after-runtime-dispose");
  expect(createConsoleResult("list").entries?.some((entry) => entry.text === "after-runtime-dispose")).toBe(false);
}

export async function runCase02() {
  const { window } = new JSDOM(`<button id="save">Save</button>`, {
    url: "https://example.test/",
  });
  const runtime = createFakeContentRuntime();

  const first = startContentScriptRuntime({
    browserRuntime: runtime.browserRuntime,
    document: window.document,
    now: 1000,
  });
  const snapshotResponse = await runtime.emit(createRequest("snapshot", { selector: "#save", interactiveOnly: true }, "snapshot-ref"));
  const snapshotParsed = parseBoundaryResponse("extension-to-content-script", "snapshot", snapshotResponse);
  expect(snapshotParsed).toMatchObject({
    ok: true,
    value: {
      ok: true,
      result: {
        refs: 1,
      },
    },
  });

  const second = startContentScriptRuntime({
    browserRuntime: runtime.browserRuntime,
    document: window.document,
    now: 1000,
  });
  expect(runtime.listenerCount()).toBe(1);

  const resolvedWhileDuplicateStarted = await runtime.emit(createRequest("ref.resolve", { ref: "@e1" }, "resolve-ref"));
  expect(parseBoundaryResponse("extension-to-content-script", "ref.resolve", resolvedWhileDuplicateStarted)).toMatchObject({
    ok: true,
    value: {
      ok: true,
      result: {
        element: {
          ref: "@e1",
        },
      },
    },
  });

  second.dispose();
  expect(runtime.listenerCount()).toBe(1);
  first.dispose();
  expect(runtime.listenerCount()).toBe(0);
}

export function runCase03() {
  restoreLogCapture();
  const baselineLog = getConsoleLog();
  const passthroughCalls: (readonly unknown[])[] = [];
  setConsoleLog((...args: readonly unknown[]) => {
    passthroughCalls.push(args);
  });

  try {
    installLogCapture();
    createConsoleResult("clear");
    writeConsoleLog("captured-once");

    expect(createConsoleResult("list")).toMatchObject({
      entries: [expect.objectContaining({ text: "captured-once" })],
    });
    expect(passthroughCalls).toEqual([["captured-once"]]);

    restoreLogCapture();
    writeConsoleLog("after-restore");
    expect(createConsoleResult("list").entries?.some((entry) => entry.text === "after-restore")).toBe(false);
    expect(passthroughCalls).toEqual([["captured-once"], ["after-restore"]]);

    installLogCapture();
    writeConsoleLog("after-reinstall");
    const listed = createConsoleResult("list");
    expect(listed.entries?.filter((entry) => entry.text === "after-reinstall")).toHaveLength(1);
    expect(listed.entries?.filter((entry) => entry.text === "captured-once")).toHaveLength(1);
  } finally {
    restoreLogCapture();
    setConsoleLog(baselineLog);
    installLogCapture();
  }
}

export function runCase04() {
  restoreLogCapture();
  createConsoleResult("clear");
  const firstHandle = installLogCapture();
  const secondHandle = installLogCapture();

  try {
    captureConsoleLogWithoutStdout("scoped-global-before-dispose");
    secondHandle.dispose();
    captureConsoleLogWithoutStdout("scoped-global-after-one-dispose");
    expect(createConsoleResult("list")).toMatchObject({
      entries: [expect.objectContaining({ text: "scoped-global-before-dispose" }), expect.objectContaining({ text: "scoped-global-after-one-dispose" })],
    });

    firstHandle.dispose();
    captureConsoleLogWithoutStdout("scoped-global-after-all-dispose");
    expect(createConsoleResult("list").entries?.some((entry) => entry.text === "scoped-global-after-all-dispose")).toBe(false);
  } finally {
    firstHandle.dispose();
    secondHandle.dispose();
    installLogCapture();
  }
}

export function runCase05() {
  const firstDom = new JSDOM(`<main></main>`, { url: "https://first.example.test/" });
  const secondDom = new JSDOM(`<main></main>`, { url: "https://second.example.test/" });
  const firstWindow = firstDom.window.document.defaultView;
  const secondWindow = secondDom.window.document.defaultView;

  createErrorsResult("clear");
  installWindowLogCapture(firstWindow);
  installWindowLogCapture(secondWindow);
  firstDom.window.dispatchEvent(new firstDom.window.ErrorEvent("error", { message: "window-error-1" }));
  expect(createErrorsResult("list")).toMatchObject({
    errors: [expect.objectContaining({ text: "window-error-1" })],
  });

  restoreWindowLogCapture(firstWindow);
  firstDom.window.dispatchEvent(new firstDom.window.ErrorEvent("error", { message: "window-error-2" }));
  secondDom.window.dispatchEvent(new secondDom.window.ErrorEvent("error", { message: "window-error-3" }));
  expect(createErrorsResult("list").errors?.some((entry) => entry.text === "window-error-2")).toBe(false);
  expect(createErrorsResult("list").errors?.filter((entry) => entry.text === "window-error-3")).toHaveLength(1);

  installWindowLogCapture(firstWindow);
  installWindowLogCapture(firstWindow);
  firstDom.window.dispatchEvent(new firstDom.window.ErrorEvent("error", { message: "window-error-4" }));
  expect(createErrorsResult("list").errors?.filter((entry) => entry.text === "window-error-4")).toHaveLength(1);
}

export function runCase06() {
  const dom = new JSDOM(`<main></main>`, { url: "https://scoped.example.test/" });
  const view = dom.window.document.defaultView;
  createErrorsResult("clear");

  const firstHandle = installWindowLogCapture(view);
  const secondHandle = installWindowLogCapture(view);

  dom.window.dispatchEvent(new dom.window.ErrorEvent("error", { message: "scoped-window-before-dispose" }));
  firstHandle.dispose();
  dom.window.dispatchEvent(new dom.window.ErrorEvent("error", { message: "scoped-window-after-one-dispose" }));
  secondHandle.dispose();
  dom.window.dispatchEvent(new dom.window.ErrorEvent("error", { message: "scoped-window-after-all-dispose" }));

  const listed = createErrorsResult("list").errors ?? [];
  expect(listed.filter((entry) => entry.text === "scoped-window-before-dispose")).toHaveLength(1);
  expect(listed.filter((entry) => entry.text === "scoped-window-after-one-dispose")).toHaveLength(1);
  expect(listed.some((entry) => entry.text === "scoped-window-after-all-dispose")).toBe(false);
}

export async function runCase07() {
  const { window } = new JSDOM(`<button>Save</button>`, { url: "https://example.test/" });
  const request = createRequest("snapshot", { interactiveOnly: true }, "snapshot-1");
  const response = await createContentMessageHandler({
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
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
}
