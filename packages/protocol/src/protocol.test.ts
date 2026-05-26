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
