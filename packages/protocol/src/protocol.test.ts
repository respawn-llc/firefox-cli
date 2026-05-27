import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  createOkResponse,
  createRequest,
  kernelCapabilities,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type Boundary,
  type ComponentIdentity,
} from "./index.js";

const boundaries: readonly Boundary[] = [
  "cli-to-host",
  "host-to-extension",
  "extension-to-content-script",
];

const cliIdentity: ComponentIdentity = {
  component: "cli",
  productName: "firefox-cli",
  productVersion: "0.0.0",
  protocolMin: 1,
  protocolMax: 1,
  features: [],
};

describe("parseBoundaryRequest", () => {
  it.each(boundaries)("validates hello requests across %s", (boundary) => {
    const request = createRequest("hello", cliIdentity, "request-1");
    const parsed = parseBoundaryRequest(boundary, JSON.stringify(request));

    expect(parsed).toEqual({
      ok: true,
      value: request,
    });
  });

  it("rejects malformed JSON", () => {
    const parsed = parseBoundaryRequest("cli-to-host", "{");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_JSON");
    }
  });

  it("rejects unknown commands", () => {
    const parsed = parseBoundaryRequest("cli-to-host", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      command: "missing",
      params: {},
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
    }
  });

  it("rejects protocol version mismatches", () => {
    const parsed = parseBoundaryRequest("cli-to-host", {
      protocolVersion: PROTOCOL_VERSION + 1,
      id: "request-1",
      command: "noop",
      params: {},
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("VERSION_MISMATCH");
    }
  });

  it("rejects extra request envelope fields", () => {
    const parsed = parseBoundaryRequest("cli-to-host", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      command: "noop",
      params: {},
      surprise: true,
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("rejects invalid command params", () => {
    const parsed = parseBoundaryRequest("cli-to-host", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      command: "hello",
      params: {},
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("validates tab list requests", () => {
    const request = createRequest(
      "tabs.list",
      {
        target: {
          window: { kind: "index", index: 0 },
        },
      },
      "request-1",
    );

    expect(parseBoundaryRequest("host-to-extension", request)).toEqual({
      ok: true,
      value: request,
    });
  });

  it("validates navigation and tab/window target requests", () => {
    const requests = [
      createRequest("open", { url: "https://example.com/", newTab: false }, "open-1"),
      createRequest("tab.select", { target: { tab: { kind: "id", id: 42 } } }, "tab-select-1"),
      createRequest(
        "window.select",
        { target: { window: { kind: "index", index: 0 } } },
        "window-select-1",
      ),
      createRequest(
        "snapshot",
        {
          interactiveOnly: true,
          compact: true,
          maxDepth: 3,
          selector: "#main",
          maxOutputBytes: 10_000,
        },
        "snapshot-1",
      ),
      createRequest("ref.resolve", { ref: "@e1", generationId: "g1" }, "ref-resolve-1"),
      createRequest("get", { kind: "text", selector: "#main", maxOutputBytes: 1000 }, "get-1"),
      createRequest(
        "get",
        { kind: "attr", ref: "@e1", generationId: "g1", attribute: "href" },
        "get-2",
      ),
      createRequest("get", { kind: "title" }, "get-title-1"),
      createRequest("is", { kind: "visible", selector: "#main" }, "is-1"),
      createRequest("is", { kind: "checked", ref: "@e1", generationId: "g1" }, "is-2"),
      createRequest("wait", { kind: "ms", durationMs: 50 }, "wait-ms-1"),
      createRequest("wait", { kind: "element", selector: "#main", state: "visible" }, "wait-1"),
      createRequest("wait", { kind: "url", urlGlob: "https://example.test/*" }, "wait-url-1"),
      createRequest(
        "eval",
        { script: "document.title", source: "argv", timeoutMs: 1000, maxResultBytes: 1000 },
        "eval-1",
      ),
      createRequest(
        "screenshot",
        {
          path: "/tmp/page.png",
          format: "png",
          timeoutMs: 1000,
          maxImageBytes: 1000,
        },
        "screenshot-1",
      ),
      createRequest("click", { selector: "button" }, "click-1"),
      createRequest("dblclick", { ref: "@e1", generationId: "g1" }, "dblclick-1"),
      createRequest("focus", { selector: "input" }, "focus-1"),
      createRequest("hover", { selector: "button" }, "hover-1"),
      createRequest("fill", { selector: "input", text: "hello" }, "fill-1"),
      createRequest("type", { selector: "textarea", text: "hello" }, "type-1"),
      createRequest("press", { key: "Enter" }, "press-1"),
      createRequest("keyboard.type", { text: "hello" }, "keyboard-type-1"),
      createRequest("keyboard.inserttext", { text: "hello" }, "keyboard-insert-1"),
      createRequest("check", { selector: "input[type=checkbox]" }, "check-1"),
      createRequest("uncheck", { selector: "input[type=checkbox]" }, "uncheck-1"),
      createRequest("select", { selector: "select", values: ["pro"] }, "select-1"),
      createRequest("scroll", { direction: "down", distancePx: 400 }, "scroll-1"),
      createRequest("scrollintoview", { selector: "#footer" }, "scrollintoview-1"),
      createRequest("swipe", { direction: "left", distancePx: 300 }, "swipe-1"),
    ];

    expect(requests.map((request) => parseBoundaryRequest("host-to-extension", request))).toEqual(
      requests.map((request) => ({ ok: true, value: request })),
    );
  });
});

describe("parseBoundaryResponse", () => {
  it.each(boundaries)("validates successful responses across %s", (boundary) => {
    const request = createRequest("capabilities", {}, "request-1");
    const response = createOkResponse(request, { capabilities: [...kernelCapabilities] });
    const parsed = parseBoundaryResponse(boundary, "capabilities", response);

    expect(parsed).toEqual({
      ok: true,
      value: response,
    });
  });

  it("validates tab list responses", () => {
    const request = createRequest("tabs.list", {}, "request-1");
    const response = createOkResponse(request, {
      tabs: [
        {
          id: 42,
          index: 0,
          active: true,
          title: "Example",
          url: "https://example.com/",
          windowId: 7,
          private: false,
          cookieStoreId: "firefox-default",
        },
      ],
    });

    expect(parseBoundaryResponse("cli-to-host", "tabs.list", response)).toEqual({
      ok: true,
      value: response,
    });
  });

  it("validates target, window, and navigation responses", () => {
    const target = {
      windowId: 7,
      windowIndex: 0,
      tabId: 42,
      tabIndex: 0,
      title: "Example",
      url: "https://example.com/",
      private: false,
    };
    const open = createRequest("open", { url: "https://example.com/", newTab: false }, "open-1");
    const windows = createRequest("windows.list", {}, "windows-1");

    expect(
      parseBoundaryResponse(
        "cli-to-host",
        "open",
        createOkResponse(open, {
          target,
          url: "https://example.com/",
          loadState: "complete",
        }),
      ),
    ).toEqual({
      ok: true,
      value: createOkResponse(open, {
        target,
        url: "https://example.com/",
        loadState: "complete",
      }),
    });
    expect(
      parseBoundaryResponse(
        "cli-to-host",
        "windows.list",
        createOkResponse(windows, {
          windows: [
            {
              id: 7,
              index: 0,
              focused: true,
              activeTabId: 42,
              tabCount: 1,
              private: false,
            },
          ],
        }),
      ),
    ).toEqual({
      ok: true,
      value: createOkResponse(windows, {
        windows: [
          {
            id: 7,
            index: 0,
            focused: true,
            activeTabId: 42,
            tabCount: 1,
            private: false,
          },
        ],
      }),
    });
  });

  it("validates snapshot responses with generation metadata", () => {
    const request = createRequest("snapshot", { interactiveOnly: true }, "snapshot-1");
    const response = createOkResponse(request, {
      generationId: "g1",
      text: '@e1 button "Submit"',
      refs: 1,
      truncated: false,
      frames: [
        {
          selector: "iframe:nth-of-type(1)",
          unsupported: true,
          reason: "Iframe refs are prototype-gated.",
        },
      ],
    });

    expect(parseBoundaryResponse("extension-to-content-script", "snapshot", response)).toEqual({
      ok: true,
      value: response,
    });
  });

  it("validates ref resolve responses", () => {
    const request = createRequest("ref.resolve", { ref: "@e1" }, "ref-resolve-1");
    const response = createOkResponse(request, {
      element: {
        ref: "@e1",
        generationId: "g1",
        tagName: "button",
        role: "button",
        name: "Save",
        text: "Save",
        visible: true,
      },
    });

    expect(parseBoundaryResponse("extension-to-content-script", "ref.resolve", response)).toEqual({
      ok: true,
      value: response,
    });
  });

  it("validates get responses with scalar and object values", () => {
    const text = createRequest("get", { kind: "text", selector: "#main" }, "get-text-1");
    const box = createRequest("get", { kind: "box", ref: "@e1" }, "get-box-1");

    expect(
      parseBoundaryResponse(
        "extension-to-content-script",
        "get",
        createOkResponse(text, {
          kind: "text",
          value: "Hello",
          truncated: false,
          element: {
            ref: "@e1",
            generationId: "g1",
            tagName: "main",
            role: "main",
            visible: true,
          },
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseBoundaryResponse(
        "extension-to-content-script",
        "get",
        createOkResponse(box, {
          kind: "box",
          value: {
            x: 1,
            y: 2,
            width: 100,
            height: 20,
            top: 2,
            right: 101,
            bottom: 22,
            left: 1,
          },
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects attr getters without an attribute name", () => {
    const parsed = parseBoundaryRequest("host-to-extension", {
      protocolVersion: PROTOCOL_VERSION,
      id: "get-1",
      command: "get",
      params: {
        kind: "attr",
        selector: "a",
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("rejects get responses whose value does not match the getter kind", () => {
    const request = createRequest("get", { kind: "count", selector: ".item" }, "get-1");
    const parsed = parseBoundaryResponse("extension-to-content-script", "get", {
      protocolVersion: PROTOCOL_VERSION,
      id: request.id,
      ok: true,
      result: {
        kind: "count",
        value: "2",
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it("rejects malformed get box and styles result objects", () => {
    const box = createRequest("get", { kind: "box", selector: "#main" }, "get-box-1");
    const styles = createRequest("get", { kind: "styles", selector: "#main" }, "get-styles-1");

    for (const response of [
      {
        protocolVersion: PROTOCOL_VERSION,
        id: box.id,
        ok: true,
        result: {
          kind: "box",
          value: { x: "oops" },
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: styles.id,
        ok: true,
        result: {
          kind: "styles",
          value: { display: "block", surprise: true },
        },
      },
    ]) {
      const parsed = parseBoundaryResponse("extension-to-content-script", "get", response);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_RESPONSE");
      }
    }
  });

  it("validates is responses with boolean values", () => {
    const request = createRequest("is", { kind: "enabled", selector: "button" }, "is-1");
    const response = createOkResponse(request, {
      kind: "enabled",
      value: true,
      element: {
        ref: "@e1",
        generationId: "g1",
        tagName: "button",
        role: "button",
        visible: true,
      },
    });

    expect(parseBoundaryResponse("extension-to-content-script", "is", response)).toEqual({
      ok: true,
      value: response,
    });
  });

  it("rejects invalid is params and non-boolean is results", () => {
    for (const params of [
      {
        kind: "visible",
      },
      {
        kind: "visible",
        selector: "#main",
        generationId: "g1",
      },
    ]) {
      const invalidParams = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "is-1",
        command: "is",
        params,
      });
      expect(invalidParams.ok).toBe(false);
      if (!invalidParams.ok) {
        expect(invalidParams.error.code).toBe("INVALID_ENVELOPE");
      }
    }

    const request = createRequest("is", { kind: "visible", selector: "#main" }, "is-2");
    const invalidResult = parseBoundaryResponse("extension-to-content-script", "is", {
      protocolVersion: PROTOCOL_VERSION,
      id: request.id,
      ok: true,
      result: {
        kind: "visible",
        value: "true",
      },
    });
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) {
      expect(invalidResult.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it("validates wait responses with elapsed timing and serializable values", () => {
    const element = createRequest(
      "wait",
      { kind: "element", selector: "#main", state: "visible" },
      "wait-element-1",
    );
    const fn = createRequest("wait", { kind: "function", expression: "1" }, "wait-fn-1");

    expect(
      parseBoundaryResponse(
        "extension-to-content-script",
        "wait",
        createOkResponse(element, {
          kind: "element",
          matched: true,
          elapsedMs: 12,
          element: {
            ref: "@e1",
            generationId: "g1",
            tagName: "main",
            role: "main",
            visible: true,
          },
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseBoundaryResponse(
        "extension-to-content-script",
        "wait",
        createOkResponse(fn, {
          kind: "function",
          matched: true,
          elapsedMs: 3,
          value: {
            ready: true,
          },
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects invalid wait params and malformed wait results", () => {
    for (const params of [
      { kind: "ms" },
      { kind: "ms", durationMs: 10, selector: "#main" },
      { kind: "element", selector: "#main", ref: "@e1" },
      { kind: "element", selector: "#main", generationId: "g1" },
      { kind: "element", selector: "#main", state: "complete" },
      { kind: "text" },
      { kind: "text", text: "Ready", selector: "#main" },
      { kind: "url" },
      { kind: "url", urlGlob: "https://example.test/*", text: "Ready" },
      { kind: "function" },
      { kind: "function", expression: "true", urlGlob: "*" },
      { kind: "load-state" },
      { kind: "load-state", state: "visible" },
      { kind: "load-state", state: "complete", ref: "@e1" },
      { kind: "text", text: "Ready", durationMs: 10 },
    ]) {
      const invalidParams = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "wait-1",
        command: "wait",
        params,
      });
      expect(invalidParams.ok).toBe(false);
      if (!invalidParams.ok) {
        expect(invalidParams.error.code).toBe("INVALID_ENVELOPE");
      }
    }

    const request = createRequest("wait", { kind: "text", text: "Ready" }, "wait-2");
    for (const result of [
      {
        kind: "text",
        matched: false,
        elapsedMs: 1,
      },
      {
        kind: "text",
        matched: true,
        elapsedMs: 1,
      },
      {
        kind: "ms",
        matched: true,
        elapsedMs: 1,
        element: {
          ref: "@e1",
          generationId: "g1",
          tagName: "main",
          role: "main",
          visible: true,
        },
      },
      {
        kind: "url",
        matched: true,
        elapsedMs: 1,
        value: "https://example.test/",
        element: {
          tagName: "main",
          role: "main",
          visible: true,
        },
      },
      {
        kind: "element",
        matched: true,
        elapsedMs: 1,
        element: {
          ref: "@e1",
          tagName: "main",
          role: "main",
          visible: true,
        },
      },
      {
        kind: "element",
        matched: true,
        elapsedMs: 1,
        element: {
          generationId: "g1",
          tagName: "main",
          role: "main",
          visible: true,
        },
      },
    ]) {
      const invalidResult = parseBoundaryResponse("extension-to-content-script", "wait", {
        protocolVersion: PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result,
      });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.error.code).toBe("INVALID_RESPONSE");
      }
    }
  });

  it("rejects invalid ref resolve params", () => {
    const parsed = parseBoundaryRequest("host-to-extension", {
      protocolVersion: PROTOCOL_VERSION,
      id: "ref-1",
      command: "ref.resolve",
      params: {
        ref: "e1",
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("validates eval responses with JSON values and undefined markers", () => {
    const json = createRequest("eval", { script: "({ ready: true })", source: "argv" }, "eval-1");
    const undefinedValue = createRequest(
      "eval",
      { script: "let value = 1;", source: "stdin" },
      "eval-2",
    );

    expect(
      parseBoundaryResponse(
        "host-to-extension",
        "eval",
        createOkResponse(json, {
          value: {
            type: "json",
            value: {
              ready: true,
              items: [1, "two", null],
            },
          },
          elapsedMs: 7,
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseBoundaryResponse(
        "host-to-extension",
        "eval",
        createOkResponse(undefinedValue, {
          value: { type: "undefined" },
          elapsedMs: 1,
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects invalid eval params and malformed eval results", () => {
    for (const params of [
      { script: "", source: "argv" },
      { script: "1", source: "file" },
      { script: "1", source: "argv", timeoutMs: 0 },
      { script: "1", source: "argv", maxResultBytes: 900_001 },
      { script: "x".repeat(100_001), source: "argv" },
    ]) {
      const parsed = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "eval-invalid",
        command: "eval",
        params,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_ENVELOPE");
      }
    }

    const request = createRequest("eval", { script: "1", source: "argv" }, "eval-1");
    for (const result of [
      {
        value: 1,
        elapsedMs: 1,
      },
      {
        value: { type: "json", value: undefined },
        elapsedMs: 1,
      },
      {
        value: { type: "undefined", value: null },
        elapsedMs: 1,
      },
      {
        value: { type: "json", value: Number.NaN },
        elapsedMs: 1,
      },
      {
        value: { type: "json", value: true },
        elapsedMs: -1,
      },
    ]) {
      const parsed = parseBoundaryResponse("host-to-extension", "eval", {
        protocolVersion: PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_RESPONSE");
      }
    }
  });

  it("validates screenshot responses and rejects malformed screenshot contracts", () => {
    const request = createRequest(
      "screenshot",
      { path: "/tmp/page.png", format: "png" },
      "screenshot-1",
    );

    expect(
      parseBoundaryResponse(
        "host-to-extension",
        "screenshot",
        createOkResponse(request, {
          path: "/tmp/page.png",
          format: "png",
          bytes: 68,
          width: 1,
          height: 1,
          activation: {
            tabActivated: false,
            windowFocused: false,
          },
          imageBase64: "iVBORw0KGgo=",
        }),
      ),
    ).toMatchObject({ ok: true });

    expect(
      parseBoundaryResponse(
        "cli-to-host",
        "screenshot",
        createOkResponse(request, {
          path: "/tmp/page.png",
          format: "png",
          bytes: 68,
          activation: {
            tabActivated: false,
            windowFocused: false,
          },
        }),
      ),
    ).toMatchObject({ ok: true });

    for (const params of [
      { path: "", format: "png" },
      { path: "/tmp/page.png", format: "jpeg" },
      { path: "/tmp/page.png", format: "png", timeoutMs: 0 },
      { path: "/tmp/page.png", format: "png", maxImageBytes: 8_000_001 },
    ]) {
      const parsed = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "screenshot-invalid",
        command: "screenshot",
        params,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_ENVELOPE");
      }
    }

    for (const result of [
      {
        path: "/tmp/page.png",
        format: "png",
        bytes: -1,
        activation: {
          tabActivated: false,
          windowFocused: false,
        },
      },
      {
        path: "/tmp/page.png",
        format: "png",
        bytes: 1,
        activation: {
          tabActivated: "false",
          windowFocused: false,
        },
      },
      {
        path: "/tmp/page.png",
        format: "jpeg",
        bytes: 1,
        activation: {
          tabActivated: false,
          windowFocused: false,
        },
      },
    ]) {
      const parsed = parseBoundaryResponse("host-to-extension", "screenshot", {
        protocolVersion: PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_RESPONSE");
      }
    }
  });

  it("validates interaction responses and rejects malformed action contracts", () => {
    const click = createRequest("click", { selector: "button" }, "click-1");
    expect(
      parseBoundaryResponse(
        "extension-to-content-script",
        "click",
        createOkResponse(click, {
          action: "click",
          ok: true,
          element: {
            tagName: "button",
            role: "button",
            visible: true,
          },
        }),
      ),
    ).toMatchObject({ ok: true });

    for (const response of [
      {
        protocolVersion: PROTOCOL_VERSION,
        id: click.id,
        ok: true,
        result: {
          action: "fill",
          ok: true,
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: click.id,
        ok: true,
        result: {
          action: "click",
          ok: true,
          selectedValues: ["wrong"],
          element: {
            tagName: "button",
            role: "button",
            visible: true,
          },
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: click.id,
        ok: true,
        result: {
          action: "click",
          ok: true,
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: click.id,
        ok: true,
        result: {
          action: "click",
          ok: true,
          element: {
            ref: "@e1",
            tagName: "button",
            role: "button",
            visible: true,
          },
        },
      },
    ]) {
      const parsed = parseBoundaryResponse("extension-to-content-script", "click", response);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_RESPONSE");
      }
    }
  });

  it("rejects invalid interaction params", () => {
    for (const [command, params] of [
      ["click", {}],
      ["click", { selector: "button", ref: "@e1" }],
      ["click", { selector: "button", generationId: "g1" }],
      ["fill", { selector: "input" }],
      ["press", { key: "" }],
      ["select", { selector: "select", values: [] }],
      ["scroll", { direction: "north" }],
      ["scroll", { selector: "#feed", ref: "@e1", direction: "down" }],
      ["scroll", { direction: "down", generationId: "g1" }],
    ] as const) {
      const parsed = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: `${command}-invalid`,
        command,
        params,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_ENVELOPE");
      }
    }
  });

  it.each(boundaries)("rejects invalid successful result payloads across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "capabilities", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: true,
      result: {},
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it.each(boundaries)("validates structured error responses across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Not implemented.",
      },
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        protocolVersion: PROTOCOL_VERSION,
        id: "request-1",
        ok: false,
        error: {
          code: "UNSUPPORTED_CAPABILITY",
          message: "Not implemented.",
        },
      },
    });
  });

  it.each(boundaries)("rejects malformed error responses across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: false,
      error: {
        message: "Missing code.",
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it.each(boundaries)("rejects extra response envelope fields across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: true,
      result: {
        ok: true,
      },
      surprise: true,
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it.each(
    boundaries,
  )("rejects success responses that also include errors across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: true,
      result: {
        ok: true,
      },
      error: {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Unexpected.",
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });

  it.each(boundaries)("rejects error responses that also include results across %s", (boundary) => {
    const parsed = parseBoundaryResponse(boundary, "noop", {
      protocolVersion: PROTOCOL_VERSION,
      id: "request-1",
      ok: false,
      error: {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Expected.",
      },
      result: {
        ok: true,
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
  });
});
