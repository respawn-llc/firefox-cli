import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, createOkResponse, createRequest, parseBoundaryRequest, parseBoundaryResponse } from "./index.js";
import { inheritedCommandNames } from "./protocol-test-support.js";

describe("parseBoundaryResponse", () => {
  it("validates batch responses and rejects malformed batch contracts", () => {
    const request = createRequest(
      "batch",
      {
        steps: [
          { command: "snapshot", params: { interactiveOnly: true } },
          { command: "screenshot", params: { path: "/tmp/page.png", format: "png" } },
        ],
      },
      "batch-1",
    );

    expect(
      parseBoundaryResponse(
        "host-to-extension",
        "batch",
        createOkResponse(request, {
          ok: true,
          steps: [
            {
              index: 0,
              command: "snapshot",
              ok: true,
              result: {
                generationId: "g1",
                text: '@e1 button "Submit"',
                refs: 1,
                truncated: false,
                frames: [],
              },
            },
            {
              index: 1,
              command: "screenshot",
              ok: true,
              result: {
                path: "/tmp/page.png",
                format: "png",
                bytes: 68,
                activation: {
                  tabActivated: false,
                  windowFocused: false,
                },
                imageBase64: "iVBORw0KGgo=",
              },
            },
          ],
          elapsedMs: 5,
        }),
      ),
    ).toMatchObject({ ok: true });

    expect(
      parseBoundaryResponse(
        "cli-to-host",
        "batch",
        createOkResponse(request, {
          ok: false,
          firstFailedIndex: 1,
          steps: [
            {
              index: 0,
              command: "snapshot",
              ok: true,
              result: {
                generationId: "g1",
                text: "",
                refs: 0,
                truncated: false,
                frames: [],
              },
            },
            {
              index: 1,
              command: "click",
              ok: false,
              error: {
                code: "SELECTOR_NOT_FOUND",
                message: "Button was not found.",
              },
            },
          ],
          elapsedMs: 5,
        }),
      ),
    ).toMatchObject({ ok: true });

    expect(
      parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "batch-default-target",
        command: "batch",
        params: {
          steps: [{ command: "tab.close", params: {} }],
        },
      }),
    ).toMatchObject({ ok: true });

    for (const params of [
      { steps: [] },
      { steps: [{ command: "batch", params: { steps: [] } }] },
      { steps: [{ command: "missing", params: {} }] },
      { steps: [{ command: "get", params: { kind: "text" } }] },
      { steps: [{ command: "snapshot", params: {} }], maxResultBytes: 900_001 },
    ]) {
      const parsed = parseBoundaryRequest("host-to-extension", {
        protocolVersion: PROTOCOL_VERSION,
        id: "batch-invalid",
        command: "batch",
        params,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("INVALID_ENVELOPE");
      }
    }

    for (const command of inheritedCommandNames) {
      let parsed: ReturnType<typeof parseBoundaryRequest> | undefined;

      expect(() => {
        parsed = parseBoundaryRequest("host-to-extension", {
          protocolVersion: PROTOCOL_VERSION,
          id: `batch-inherited-${command}`,
          command: "batch",
          params: {
            steps: [{ command, params: {} }],
          },
        });
      }).not.toThrow();

      expect(parsed).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_ENVELOPE",
        },
      });
    }

    for (const result of [
      {
        ok: true,
        steps: [
          {
            index: 0,
            command: "get",
            ok: true,
            result: {
              kind: "count",
              value: "2",
            },
          },
        ],
        elapsedMs: 1,
      },
      {
        ok: true,
        steps: [
          {
            index: 0,
            command: "click",
            ok: false,
            error: {
              code: "SELECTOR_NOT_FOUND",
              message: "Missing.",
            },
          },
        ],
        elapsedMs: 1,
      },
      {
        ok: true,
        firstFailedIndex: 0,
        steps: [
          {
            index: 0,
            command: "snapshot",
            ok: true,
            result: {
              generationId: "g1",
              text: "",
              refs: 0,
              truncated: false,
              frames: [],
            },
          },
        ],
        elapsedMs: 1,
      },
      {
        ok: false,
        steps: [
          {
            index: 0,
            command: "snapshot",
            ok: true,
            result: {
              generationId: "g1",
              text: "",
              refs: 0,
              truncated: false,
              frames: [],
            },
          },
        ],
        elapsedMs: 1,
      },
      {
        ok: false,
        firstFailedIndex: 2,
        steps: [
          {
            index: 0,
            command: "click",
            ok: false,
            error: {
              code: "SELECTOR_NOT_FOUND",
              message: "Missing.",
            },
          },
        ],
        elapsedMs: 1,
      },
    ]) {
      const parsed = parseBoundaryResponse("host-to-extension", "batch", {
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

    for (const command of inheritedCommandNames) {
      const successfulResponse = {
        protocolVersion: PROTOCOL_VERSION,
        id: `batch-result-inherited-${command}`,
        ok: true,
        result: {
          ok: true,
          steps: [{ index: 0, command, ok: true, result: {} }],
          elapsedMs: 5,
        },
      };
      expect(() => parseBoundaryResponse("host-to-extension", "batch", successfulResponse)).not.toThrow();
      expect(parseBoundaryResponse("host-to-extension", "batch", successfulResponse)).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
        },
      });

      const failedResponse = {
        protocolVersion: PROTOCOL_VERSION,
        id: `batch-result-failed-inherited-${command}`,
        ok: true,
        result: {
          ok: false,
          firstFailedIndex: 0,
          steps: [
            {
              index: 0,
              command,
              ok: false,
              error: {
                code: "TIMEOUT",
                message: "Timed out.",
              },
            },
          ],
          elapsedMs: 5,
        },
      };
      expect(() => parseBoundaryResponse("host-to-extension", "batch", failedResponse)).not.toThrow();
      expect(parseBoundaryResponse("host-to-extension", "batch", failedResponse)).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
        },
      });
    }
  });
});
