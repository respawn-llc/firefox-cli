import { MAX_LOG_ENTRIES, createRequest, parseBoundaryResponse } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import { ElementRefRegistry, handleContentScriptRequest as handleRawContentScriptRequest } from "./content-snapshot.js";
import { createContentLogCaptureService, createErrorsResult, installLogCapture } from "./content-snapshot/log-capture.js";
import type * as ContentSnapshotFacade from "./content-snapshot.js";
import {
  captureConsoleLogWithoutStdout,
  createManualHighlightScheduler,
  getConsoleLog,
  handleContentScriptRequest,
  readHighlightFields,
  setConsoleLog,
  writeConsoleLog,
} from "./content-snapshot-test-support.js";

function isContentSnapshotFacade(value: unknown): value is typeof ContentSnapshotFacade {
  return typeof value === "object" && value !== null && "ElementRefRegistry" in value && "handleContentScriptRequest" in value;
}

async function importColdContentSnapshotFacade(suffix: string): Promise<typeof ContentSnapshotFacade> {
  const module: unknown = await import(/* @vite-ignore */ `./content-snapshot.js?cold=${suffix}`);
  if (!isContentSnapshotFacade(module)) {
    throw new Error("content snapshot facade import returned an unexpected module shape");
  }
  return module;
}

export function runCase01() {
  const { window } = new JSDOM(
    `<main>
        <button id="first" style="outline: 1px solid red; outline-offset: 4px;">First</button>
        <button id="second">Second</button>
      </main>`,
    { url: "https://example.test/", pretendToBeVisual: true },
  );
  const first = window.document.querySelector<HTMLElement>("#first");
  const second = window.document.querySelector<HTMLElement>("#second");
  if (first === null || second === null) {
    throw new Error("fixture missing highlight targets");
  }
  const scheduler = createManualHighlightScheduler();
  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
    now: 1000,
    highlightScheduler: scheduler.scheduler,
  };
  const originalFirst = readHighlightFields(first);

  handleContentScriptRequest(createRequest("highlight", { selector: "#first" }, "highlight-first"), base);
  expect(first.style.outline).toContain("#ff9500");
  handleContentScriptRequest(createRequest("highlight", { selector: "#second" }, "highlight-second"), base);

  expect(readHighlightFields(first)).toEqual(originalFirst);
  expect(second.getAttribute("data-firefox-cli-highlight")).toBe("true");
  expect(second.style.outline).toContain("#ff9500");
  expect(scheduler.activeTimers()).toHaveLength(0);
}

export function runCase02() {
  const { window } = new JSDOM(`<button id="target">Target</button>`, {
    url: "https://example.test/",
    pretendToBeVisual: true,
  });
  const target = window.document.querySelector<HTMLElement>("#target");
  if (target === null) {
    throw new Error("fixture missing highlight target");
  }
  const scheduler = createManualHighlightScheduler();
  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
    now: 1000,
    highlightScheduler: scheduler.scheduler,
  };

  handleContentScriptRequest(createRequest("highlight", { selector: "#target", durationMs: 100 }, "highlight-owned-1"), base);
  target.setAttribute("data-firefox-cli-highlight", "page");
  target.style.outline = "4px solid blue";
  target.style.outlineOffset = "6px";
  scheduler.runOnlyTimer();
  expect(readHighlightFields(target)).toEqual({
    marker: "page",
    outline: "4px solid blue",
    outlineOffset: "6px",
  });

  handleContentScriptRequest(createRequest("highlight", { selector: "#target", durationMs: 100 }, "highlight-owned-2"), base);
  target.setAttribute("data-firefox-cli-highlight", "page-again");
  target.style.outline = "5px solid green";
  target.style.outlineOffset = "7px";
  handleContentScriptRequest(createRequest("highlight", { selector: "#target", durationMs: 200 }, "highlight-owned-3"), base);
  expect(scheduler.activeTimers()).toHaveLength(1);
  scheduler.runOnlyTimer();
  expect(readHighlightFields(target)).toEqual({
    marker: "page-again",
    outline: "5px solid green",
    outlineOffset: "7px",
  });
}

export function runCase03() {
  const { window } = new JSDOM(`<button id="target">Target</button>`, {
    url: "https://example.test/",
    pretendToBeVisual: true,
  });
  const target = window.document.querySelector<HTMLElement>("#target");
  if (target === null) {
    throw new Error("fixture missing highlight target");
  }
  const scheduler = createManualHighlightScheduler();
  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
    now: 1000,
    highlightScheduler: scheduler.scheduler,
  };

  handleContentScriptRequest(createRequest("highlight", { selector: "#target", durationMs: 100 }, "highlight-transition-1"), base);
  expect(scheduler.activeTimers()).toHaveLength(1);
  handleContentScriptRequest(createRequest("highlight", { selector: "#target" }, "highlight-transition-2"), base);
  expect(scheduler.activeTimers()).toHaveLength(0);
  expect(target.style.outline).toContain("#ff9500");

  handleContentScriptRequest(createRequest("highlight", { selector: "#target", durationMs: 100 }, "highlight-transition-3"), base);
  expect(scheduler.activeTimers()).toHaveLength(1);
  scheduler.runOnlyTimer();
  expect(readHighlightFields(target)).toEqual({
    marker: null,
    outline: "",
    outlineOffset: "",
  });
}

export function runCase04() {
  const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });
  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
    now: 1000,
  };
  const globalLogHandle = installLogCapture();

  try {
    handleContentScriptRequest(createRequest("console", { action: "clear" }, "console-clear"), base);
    captureConsoleLogWithoutStdout("explicit-log");

    expect(handleContentScriptRequest(createRequest("console", { action: "list" }, "console-list"), base)).toMatchObject({
      ok: true,
      result: {
        entries: [expect.objectContaining({ level: "log", text: "explicit-log" })],
      },
    });

    handleContentScriptRequest(createRequest("console", { action: "clear" }, "console-clear-2"), base);
    expect(handleContentScriptRequest(createRequest("console", { action: "list" }, "console-list-2"), base)).toMatchObject({
      ok: true,
      result: {
        entries: [],
      },
    });
  } finally {
    globalLogHandle.dispose();
  }
}

export function runCase05() {
  const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });
  createErrorsResult("clear");

  expect(() => {
    void handleRawContentScriptRequest(createRequest("errors", { action: "list" }, "errors-list"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    });
  }).toThrow("ContentLogCaptureService is required");

  window.dispatchEvent(new window.ErrorEvent("error", { message: "missing-capture-service-leak-check" }));
  expect(createErrorsResult("list").errors?.some((entry) => entry.text === "missing-capture-service-leak-check")).toBe(false);
}

export function runCase06() {
  const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });
  const logCapture = createContentLogCaptureService();
  const windowLogHandle = logCapture.installWindow(window.document.defaultView);
  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture,
    now: 1000,
  };

  try {
    expect(handleContentScriptRequest(createRequest("errors", { action: "clear" }, "errors-clear"), base)).toMatchObject({ ok: true });
    for (let index = 0; index < MAX_LOG_ENTRIES + 2; index += 1) {
      window.dispatchEvent(new window.ErrorEvent("error", { message: `bounded-error-${String(index)}` }));
    }

    const response = parseBoundaryResponse(
      "extension-to-content-script",
      "errors",
      handleContentScriptRequest(createRequest("errors", { action: "list" }, "errors-list"), base),
    );

    expect(response).toMatchObject({ ok: true, value: { ok: true } });
    if (response.ok && response.value.ok) {
      expect(response.value.result.errors).toHaveLength(MAX_LOG_ENTRIES);
      expect(response.value.result.errors?.[0]?.text).toBe("bounded-error-2");
      expect(response.value.result.errors?.at(-1)?.text).toBe(`bounded-error-${String(MAX_LOG_ENTRIES + 1)}`);
      expect(response.value.result.truncated).toBe(true);
      expect(response.value.result.droppedEntries).toBe(2);
    }
  } finally {
    windowLogHandle.dispose();
  }
}

export async function runCase07() {
  const savedState = globalThis.__firefoxCliContentSnapshotLogCaptureState;
  const savedLog = getConsoleLog();
  const passthroughCalls: (readonly unknown[])[] = [];

  try {
    globalThis.__firefoxCliContentSnapshotLogCaptureState = undefined;
    setConsoleLog((...args: readonly unknown[]) => {
      passthroughCalls.push(args);
    });

    const firstFacade = await importColdContentSnapshotFacade(`${String(Date.now())}-first`);
    writeConsoleLog("cold-facade-log");

    expect(
      firstFacade.handleContentScriptRequest(createRequest("console", { action: "list" }, "console-list"), {
        document: new JSDOM(`<main></main>`).window.document,
        registry: new firstFacade.ElementRefRegistry<Element>(),
        logCapture: createContentLogCaptureService(),
        now: 1000,
      }),
    ).toMatchObject({
      ok: true,
      result: {
        entries: [],
      },
    });

    const secondFacade = await importColdContentSnapshotFacade(`${String(Date.now())}-second`);
    writeConsoleLog("after-facade-reload");

    const listed = parseBoundaryResponse(
      "extension-to-content-script",
      "console",
      secondFacade.handleContentScriptRequest(createRequest("console", { action: "list" }, "console-list-after-reload"), {
        document: new JSDOM(`<main></main>`).window.document,
        registry: new secondFacade.ElementRefRegistry<Element>(),
        logCapture: createContentLogCaptureService(),
        now: 1000,
      }),
    );
    expect(listed).toMatchObject({
      ok: true,
      value: {
        ok: true,
        result: {
          entries: [],
        },
      },
    });
    expect(passthroughCalls).toEqual([["cold-facade-log"], ["after-facade-reload"]]);
  } finally {
    setConsoleLog(savedLog);
    if (savedState === undefined) {
      globalThis.__firefoxCliContentSnapshotLogCaptureState = undefined;
    } else {
      globalThis.__firefoxCliContentSnapshotLogCaptureState = savedState;
    }
  }
}
