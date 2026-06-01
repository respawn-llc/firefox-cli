import { describe, expect, it } from "vitest";
import { createOkResponse, createRequest, kernelCapabilities, PROTOCOL_VERSION, parseBoundaryRequest, parseBoundaryResponse } from "./index.js";
import { boundaries, cliIdentity } from "./protocol-test-support.js";

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

  it("rejects impossible hello pairing status combinations", () => {
    const request = createRequest("hello", cliIdentity, "hello-1");
    const parsed = parseBoundaryResponse("host-to-extension", "hello", {
      protocolVersion: PROTOCOL_VERSION,
      id: request.id,
      ok: true,
      result: {
        accepted: true,
        negotiatedProtocolVersion: PROTOCOL_VERSION,
        peer: cliIdentity,
        pairing: {
          hostId: "host-1",
          extensionId: "ff-cli-bridge@respawn.pro",
          approved: true,
          status: "invalid-pair-state",
        },
      },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_RESPONSE");
    }
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
});
