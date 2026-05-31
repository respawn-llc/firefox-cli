import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, createOkResponse, createRequest, parseBoundaryRequest, parseBoundaryResponse } from "./index.js";

describe("parseBoundaryResponse", () => {
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
    const element = createRequest("wait", { kind: "element", selector: "#main", state: "visible" }, "wait-element-1");
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
});
