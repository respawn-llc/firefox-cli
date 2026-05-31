import { createRequest, parseBoundaryResponse } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import { ElementRefRegistry, createSnapshotResult, handleContentScriptRequest as handleRawContentScriptRequest } from "../content-snapshot.js";
import { createContentLogCaptureService, type ContentLogCaptureService } from "../content-snapshot/log-capture.js";
import { createContentElementResolver } from "./element-resolver.js";

type TestContentOptions = Omit<Parameters<typeof handleRawContentScriptRequest>[1], "logCapture"> & {
  readonly logCapture?: ContentLogCaptureService;
};

async function handleContentScriptRequest(request: Parameters<typeof handleRawContentScriptRequest>[0], options: TestContentOptions) {
  return handleRawContentScriptRequest(request, {
    logCapture: createContentLogCaptureService(),
    ...options,
  });
}

export function runCase01() {
  const { window } = new JSDOM(`<button id="save">Save</button>`);
  const resolver = createContentElementResolver({
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    now: 1000,
  });

  expect(resolver.resolveOptionalTarget({}, 1000)).toBeUndefined();
  expect(() =>
    resolver.resolveRequiredTarget(
      {},
      {
        missingMessage: "Element selector or ref is required.",
        now: 1000,
      },
    ),
  ).toThrow(expect.objectContaining({ code: "SELECTOR_NOT_FOUND" }));
  expect(() => resolver.queryOptional("[")).toThrow("Selector is invalid:");
  expect(() => resolver.resolveContentCommandTarget({}, 1000)).toThrow(
    expect.objectContaining({
      code: "SELECTOR_NOT_FOUND",
      message: "Element selector is required.",
    }),
  );
  expect(() =>
    resolver.resolveRequiredTarget(
      { selector: "#missing" },
      {
        missingMessage: "unused",
        now: 1000,
      },
    ),
  ).toThrow(
    expect.objectContaining({
      code: "SELECTOR_NOT_FOUND",
      message: "Selector not found: #missing",
    }),
  );
}

export function runCase02() {
  const { window } = new JSDOM(`<button id="save">Save</button>`);
  const registry = new ElementRefRegistry<Element>();
  const snapshot = createSnapshotResult(window.document, { selector: "#save", interactiveOnly: true }, registry, 1000);
  const resolver = createContentElementResolver({ document: window.document, registry });

  expect(
    resolver.resolveRequiredTarget({ ref: "@e1", generationId: snapshot.generationId }, { missingMessage: "Element selector or ref is required.", now: 1000 }),
  ).toMatchObject({
    element: window.document.querySelector("#save"),
    ref: "@e1",
    generationId: snapshot.generationId,
  });
  expect(() =>
    resolver.resolveRequiredTarget({ ref: "@e1", generationId: "stale-generation" }, { missingMessage: "Element selector or ref is required.", now: 1000 }),
  ).toThrow(expect.objectContaining({ code: "REF_NOT_FOUND" }));
}

export function runCase03() {
  const { window } = new JSDOM(`<button id="source">Source</button>`);
  const resolver = createContentElementResolver({
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    now: 1000,
  });

  expect(() => resolver.resolveRequiredDragTarget({}, "source", 1000)).toThrow(
    expect.objectContaining({
      code: "SELECTOR_NOT_FOUND",
      message: "Drag source is required.",
    }),
  );
  expect(() => resolver.resolveRequiredDragTarget({ sourceSelector: "#source" }, "target", 1000)).toThrow(
    expect.objectContaining({
      code: "SELECTOR_NOT_FOUND",
      message: "Drag target is required.",
    }),
  );
}

export async function runCase04() {
  const { window } = new JSDOM(`<main></main>`);
  const response = await handleContentScriptRequest(
    createRequest("wait", { kind: "element", state: "hidden", selector: "#missing", timeoutMs: 1 }, "wait-hidden"),
    { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
  );

  expect(parseBoundaryResponse("extension-to-content-script", "wait", response)).toMatchObject({
    ok: true,
    value: {
      ok: true,
      result: {
        kind: "element",
        matched: true,
      },
    },
  });
}

export async function runCase05() {
  const { window } = new JSDOM(`<button id="source">Source</button>`);
  const response = await handleContentScriptRequest(createRequest("drag", { sourceSelector: "#source" }, "drag-target-missing"), {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    now: 1000,
  });

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "SELECTOR_NOT_FOUND",
      message: "Drag target is required.",
    },
  });
}
