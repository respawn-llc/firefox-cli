import { createRequest, parseBoundaryResponse } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import { ElementRefRegistry, createSnapshotResult } from "./content-snapshot.js";
import { createContentLogCaptureService } from "./content-snapshot/log-capture.js";
import { handleAsyncContentScriptRequest, handleContentScriptRequest } from "./content-snapshot-test-support.js";

export function runCase01() {
  const { window } = new JSDOM(`<main>Page</main>`, { url: "https://example.test/" });

  const response = handleContentScriptRequest(createRequest("eval", { script: "document.title", source: "argv" }, "wrong-boundary-eval"), {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
  });

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "UNSUPPORTED_CAPABILITY",
      message: "Unsupported content command: eval",
    },
  });
}

export function runCase02() {
  const { window } = new JSDOM(`<main>${"x".repeat(100)}</main>`, {
    url: "https://example.test/",
  });

  const response = parseBoundaryResponse(
    "extension-to-content-script",
    "get",
    handleContentScriptRequest(createRequest("get", { kind: "text", selector: "main", maxOutputBytes: 20 }, "get-1"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      logCapture: createContentLogCaptureService(),
      now: 1000,
    }),
  );

  expect(response).toMatchObject({
    ok: true,
    value: {
      ok: true,
      result: {
        kind: "text",
        truncated: true,
      },
    },
  });
  if (!response.ok || !response.value.ok || response.value.result.kind !== "text") {
    throw new Error("expected truncated text response");
  }
  expect(response.value.result.value).toContain("[truncated]");
}

export function runCase03() {
  const { window } = new JSDOM(`<main>${"x".repeat(100)}</main>`, {
    url: "https://example.test/",
  });

  const response = parseBoundaryResponse(
    "extension-to-content-script",
    "get",
    handleContentScriptRequest(createRequest("get", { kind: "text", selector: "main", maxOutputBytes: 1 }, "get-1"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      logCapture: createContentLogCaptureService(),
      now: 1000,
    }),
  );

  expect(response).toMatchObject({
    ok: true,
    value: {
      ok: true,
      result: {
        kind: "text",
        truncated: true,
      },
    },
  });
  if (response.ok && response.value.ok && response.value.result.kind === "text") {
    expect(new TextEncoder().encode(response.value.result.value).length).toBeLessThanOrEqual(1);
  }
}

export function runCase04() {
  const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });

  const response = handleContentScriptRequest(createRequest("get", { kind: "text", selector: "#missing" }, "get-1"), {
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

export async function runCase05() {
  const { window } = new JSDOM(
    `<main>
        <button id="ready">Ready</button>
        <div style="display: none">Hidden Ready</div>
      </main>`,
    { url: "https://example.test/" },
  );
  Object.defineProperty(window.document, "readyState", { value: "complete", configurable: true });
  const registry = new ElementRefRegistry<Element>();

  const visibleElementResponse = parseBoundaryResponse(
    "extension-to-content-script",
    "wait",
    await handleAsyncContentScriptRequest(createRequest("wait", { kind: "element", selector: "#ready", state: "visible" }, "w1"), {
      document: window.document,
      registry,
      now: 1000,
    }),
  );
  expect(visibleElementResponse).toMatchObject({
    ok: true,
    value: {
      ok: true,
      result: {
        kind: "element",
        matched: true,
        element: {
          tagName: "button",
          role: "button",
          visible: true,
        },
      },
    },
  });
  if (!visibleElementResponse.ok || !visibleElementResponse.value.ok || visibleElementResponse.value.result.kind !== "element") {
    throw new Error("expected visible element wait response");
  }
  expect(typeof visibleElementResponse.value.result.elapsedMs).toBe("number");
  await expect(
    handleAsyncContentScriptRequest(createRequest("wait", { kind: "element", selector: "#missing", state: "hidden" }, "w2"), {
      document: window.document,
      registry,
      now: 1000,
    }),
  ).resolves.toMatchObject({
    ok: true,
    result: {
      kind: "element",
      matched: true,
    },
  });
  await expect(
    handleAsyncContentScriptRequest(createRequest("wait", { kind: "text", text: "Ready" }, "w3"), {
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
    handleAsyncContentScriptRequest(createRequest("wait", { kind: "load-state", state: "domcontentloaded" }, "w4"), {
      document: window.document,
      registry,
      now: 1000,
    }),
  ).resolves.toMatchObject({
    ok: true,
    result: {
      kind: "load-state",
      matched: true,
    },
  });
  await expect(
    handleAsyncContentScriptRequest(createRequest("wait", { kind: "function", expression: "({ ready: true })" }, "w5"), {
      document: window.document,
      registry,
      now: 1000,
    }),
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
}

export async function runCase06() {
  const { window } = new JSDOM(`<main></main>`, { url: "https://example.test/" });

  await expect(
    handleAsyncContentScriptRequest(createRequest("wait", { kind: "element", selector: "#ready", state: "visible", timeoutMs: 1, intervalMs: 1 }, "wait-1"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: {
      code: "TIMEOUT",
    },
  });
}

export async function runCase07() {
  const { window } = new JSDOM(`<button id="save">Save</button>`, {
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
  window.document.querySelector("#save")?.remove();

  await expect(
    handleAsyncContentScriptRequest(
      createRequest(
        "wait",
        {
          kind: "element",
          ref: "@e1",
          generationId: snapshot.value.result.generationId,
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
}

export function runCase08() {
  const { window } = new JSDOM(`<button>Save</button>`, { url: "https://example.test/" });

  const response = handleContentScriptRequest(createRequest("ref.resolve", { ref: "@e1" }, "ref-1"), {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    logCapture: createContentLogCaptureService(),
    now: 1000,
  });

  expect(response).toMatchObject({
    ok: false,
    error: {
      code: "REF_NOT_FOUND",
    },
  });
}

export function runCase09() {
  const { window } = new JSDOM(`<button id="save">Save</button>`, {
    url: "https://example.test/",
  });
  const registry = new ElementRefRegistry<Element>();
  createSnapshotResult(window.document, { interactiveOnly: true, compact: true, maxDepth: 2, maxOutputBytes: 10_000 }, registry, 1000);
  window.document.querySelector("#save")?.remove();

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
