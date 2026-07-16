import { describe, expect, it } from "vitest";
import { createRequest, PROTOCOL_VERSION, parseBoundaryRequest } from "./index.js";
import { boundaries, cliIdentity, inheritedCommandNames } from "./protocol-test-support.js";

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

  it.each(inheritedCommandNames)("rejects inherited command name %s", (command) => {
    let parsed: ReturnType<typeof parseBoundaryRequest> | undefined;

    expect(() => {
      parsed = parseBoundaryRequest("cli-to-host", {
        protocolVersion: PROTOCOL_VERSION,
        id: `request-${command}`,
        command,
        params: {},
      });
    }).not.toThrow();

    expect(parsed).toMatchObject({
      ok: false,
      error: {
        code: "UNKNOWN_COMMAND",
      },
    });
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

  it("uses strict command params for non-batch request envelopes", () => {
    const parsed = parseBoundaryRequest("cli-to-host", {
      protocolVersion: PROTOCOL_VERSION,
      id: "tab-close-1",
      command: "tab.close",
      params: { unexpected: true },
    });

    expect(parsed).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_ENVELOPE",
      },
    });
  });

  it("preserves omitted select and close targets for extension ambiguity checks", () => {
    const requests = [
      createRequest("tab.select", {}, "tab-select-omitted"),
      createRequest("tab.close", {}, "tab-close-omitted"),
      createRequest("window.select", {}, "window-select-omitted"),
      createRequest("window.close", {}, "window-close-omitted"),
    ];

    expect(requests.map((request) => parseBoundaryRequest("host-to-extension", request))).toEqual(requests.map((request) => ({ ok: true, value: request })));
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
      createRequest("window.select", { target: { window: { kind: "index", index: 0 } } }, "window-select-1"),
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
      createRequest("get", { kind: "attr", ref: "@e1", generationId: "g1", attribute: "href" }, "get-2"),
      createRequest("get", { kind: "title" }, "get-title-1"),
      createRequest("is", { kind: "visible", selector: "#main" }, "is-1"),
      createRequest("is", { kind: "checked", ref: "@e1", generationId: "g1" }, "is-2"),
      createRequest("wait", { kind: "ms", durationMs: 50 }, "wait-ms-1"),
      createRequest("wait", { kind: "element", selector: "#main", state: "visible" }, "wait-1"),
      createRequest("wait", { kind: "url", urlGlob: "https://example.test/*" }, "wait-url-1"),
      createRequest("eval", { script: "document.title", source: "argv", timeoutMs: 1000, maxResultBytes: 1000 }, "eval-1"),
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
      createRequest(
        "batch",
        {
          steps: [
            { command: "snapshot", params: { interactiveOnly: true } },
            { command: "click", params: { selector: "button" } },
          ],
          bail: true,
          timeoutMs: 1000,
          maxResultBytes: 1000,
        },
        "batch-1",
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

    expect(requests.map((request) => parseBoundaryRequest("host-to-extension", request))).toEqual(requests.map((request) => ({ ok: true, value: request })));
  });

  it("rejects tab selectors for window-only browsing commands at direct and batch boundaries", () => {
    const invalidRequests: readonly unknown[] = [
      {
        protocolVersion: PROTOCOL_VERSION,
        id: "tabs-list-tab-target",
        command: "tabs.list",
        params: { target: { tab: { kind: "id", id: 42 } } },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: "tab-new-tab-target",
        command: "tab.new",
        params: { target: { tab: { kind: "id", id: 42 } } },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: "window-select-tab-target",
        command: "window.select",
        params: { target: { tab: { kind: "id", id: 42 } } },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: "window-close-tab-target",
        command: "window.close",
        params: { target: { tab: { kind: "id", id: 42 } } },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: "set-viewport-tab-target",
        command: "set.viewport",
        params: { width: 1200, height: 800, target: { tab: { kind: "id", id: 42 } } },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: "batch-window-only-tab-target",
        command: "batch",
        params: {
          steps: [
            { command: "tabs.list", params: { target: { tab: { kind: "id", id: 42 } } } },
            { command: "tab.new", params: { target: { tab: { kind: "id", id: 42 } } } },
            { command: "window.select", params: { target: { tab: { kind: "id", id: 42 } } } },
            { command: "window.close", params: { target: { tab: { kind: "id", id: 42 } } } },
            { command: "set.viewport", params: { width: 1200, height: 800, target: { tab: { kind: "id", id: 42 } } } },
          ],
        },
      },
    ];

    for (const request of invalidRequests) {
      const parsed = parseBoundaryRequest("host-to-extension", request);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_ENVELOPE");
      }
    }
  });

  it("rejects negative selector ids at direct and batch boundaries", () => {
    const requests: readonly unknown[] = [
      {
        protocolVersion: PROTOCOL_VERSION,
        id: "negative-window",
        command: "open",
        params: { url: "https://example.com/", newTab: false, target: { window: { kind: "id", id: -1 } } },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        id: "negative-tab-batch",
        command: "batch",
        params: {
          steps: [{ command: "snapshot", params: { target: { tab: { kind: "id", id: -1 } } } }],
        },
      },
    ];

    for (const request of requests) {
      expect(parseBoundaryRequest("host-to-extension", request)).toMatchObject({
        ok: false,
        error: { code: "INVALID_ENVELOPE" },
      });
    }
  });

  it("accepts window selectors for window-only browsing commands and full selectors for page commands", () => {
    const validRequests = [
      createRequest("tabs.list", { target: { window: { kind: "id", id: 7 } } }, "tabs-list-window-target"),
      createRequest("tab.new", { target: { window: { kind: "id", id: 7 } } }, "tab-new-window-target"),
      createRequest("window.select", { target: { window: { kind: "id", id: 7 } } }, "window-select-window-target"),
      createRequest("window.close", { target: { window: { kind: "id", id: 7 } } }, "window-close-window-target"),
      createRequest("set.viewport", { width: 1200, height: 800, target: { window: { kind: "id", id: 7 } } }, "set-viewport-window-target"),
      createRequest(
        "open",
        {
          url: "https://example.com/",
          newTab: false,
          target: {
            window: { kind: "id", id: 7 },
            tab: { kind: "id", id: 42 },
          },
        },
        "open-full-target",
      ),
    ];

    expect(validRequests.map((request) => parseBoundaryRequest("host-to-extension", request))).toEqual(
      validRequests.map((request) => ({ ok: true, value: request })),
    );
  });
});
