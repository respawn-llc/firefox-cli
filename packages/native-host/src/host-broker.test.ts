import { describe, expect, it } from "vitest";
import {
  createOkResponse,
  createRequest,
  kernelCapabilities,
  parseBoundaryResponse,
} from "@firefox-cli/protocol";
import { FIREFOX_CLI_EXTENSION_ID } from "./host-launch.js";
import { createHostIdentity } from "./pair-state.js";
import { NativeHostBroker } from "./host-broker.js";

describe("NativeHostBroker", () => {
  it("forwards CLI requests through host-to-extension validation", async () => {
    const request = createRequest("capabilities", {}, "request-1");
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
    });
    broker.connectExtension({
      approved: true,
      token: "test-token",
      send: async (forwarded) =>
        createOkResponse(forwarded, { capabilities: [...kernelCapabilities] }),
    });

    const response = await broker.handleCliRequest(JSON.stringify(request));

    expect(parseBoundaryResponse("cli-to-host", "capabilities", response)).toEqual({
      ok: true,
      value: createOkResponse(request, { capabilities: [...kernelCapabilities] }),
    });
  });

  it("writes screenshot bytes and strips internal image data from CLI responses", async () => {
    const request = createRequest(
      "screenshot",
      { path: "/tmp/page.png", format: "png" },
      "screenshot-1",
    );
    const writes: { readonly path: string; readonly data: readonly number[] }[] = [];
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
      writeFile: async (path, data) => {
        writes.push({ path, data: [...data] });
      },
    });
    broker.connectExtension({
      approved: true,
      token: "test-token",
      send: async (forwarded) =>
        createOkResponse(forwarded as typeof request, {
          path: "/extension/attempted-retarget.png",
          format: "png",
          bytes: 3,
          activation: {
            tabActivated: false,
            windowFocused: false,
          },
          imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
        }),
    });

    const response = await broker.handleCliRequest(request);

    expect(writes).toEqual([{ path: "/tmp/page.png", data: [1, 2, 3] }]);
    expect(response).toEqual(
      createOkResponse(request, {
        path: "/tmp/page.png",
        format: "png",
        bytes: 3,
        activation: {
          tabActivated: false,
          windowFocused: false,
        },
      }),
    );
  });

  it("maps screenshot write and byte-contract failures to structured errors", async () => {
    for (const testCase of [
      {
        result: {
          path: "/tmp/page.png",
          format: "png" as const,
          bytes: 3,
          activation: { tabActivated: false, windowFocused: false },
        },
        code: "INVALID_RESPONSE",
      },
      {
        result: {
          path: "/tmp/page.png",
          format: "png" as const,
          bytes: 4,
          activation: { tabActivated: false, windowFocused: false },
          imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
        },
        code: "INVALID_RESPONSE",
      },
      {
        params: { maxImageBytes: 2 },
        result: {
          path: "/tmp/page.png",
          format: "png" as const,
          bytes: 3,
          activation: { tabActivated: false, windowFocused: false },
          imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
        },
        code: "OUTPUT_TOO_LARGE",
      },
      {
        result: {
          path: "/tmp/page.png",
          format: "png" as const,
          bytes: 3,
          activation: { tabActivated: false, windowFocused: false },
          imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
        },
        code: "FILE_WRITE_FAILED",
        writeFailure: true,
      },
    ]) {
      const request = createRequest(
        "screenshot",
        {
          path: "/tmp/page.png",
          format: "png",
          ...("params" in testCase ? testCase.params : {}),
        },
        `screenshot-${testCase.code}`,
      );
      const broker = new NativeHostBroker({
        hostIdentity: createHostIdentity({
          extensionId: FIREFOX_CLI_EXTENSION_ID,
          generateId: () => "host-1",
        }),
        writeFile: async () => {
          if (testCase.writeFailure === true) {
            throw new Error("disk full");
          }
        },
      });
      broker.connectExtension({
        approved: true,
        token: "test-token",
        send: async (forwarded) => createOkResponse(forwarded as typeof request, testCase.result),
      });

      await expect(broker.handleCliRequest(request)).resolves.toMatchObject({
        ok: false,
        error: {
          code: testCase.code,
        },
      });
    }
  });

  it("rejects CLI requests before extension approval", async () => {
    const request = createRequest("noop", {}, "request-1");
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
    });
    broker.connectExtension({
      approved: false,
      token: undefined,
      send: async () => {
        throw new Error("should not forward");
      },
    });

    const response = await broker.handleCliRequest(request);

    expect(response).toEqual({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "NOT_APPROVED",
        message: "Approve firefox-cli in the extension popup before running CLI commands.",
      },
    });
  });

  it("rejects CLI requests when the extension pair token is invalid", async () => {
    const request = createRequest("noop", {}, "request-1");
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
      verifyPairToken: (token) => ({
        ok: false,
        code: token === undefined ? "TOKEN_REQUIRED" : "TOKEN_MISMATCH",
        message: "Pair token does not match the approved extension.",
      }),
    });
    broker.connectExtension({
      approved: true,
      token: "wrong-token",
      send: async () => {
        throw new Error("should not forward");
      },
    });

    const response = await broker.handleCliRequest(request);

    expect(response).toEqual({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "PAIRING_MISMATCH",
        message: "Pair token does not match the approved extension.",
      },
    });
  });

  it("forwards CLI requests only after the extension token passes pair verification", async () => {
    const request = createRequest("noop", {}, "request-1");
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
      verifyPairToken: (token) =>
        token === "paired-token"
          ? { ok: true }
          : {
              ok: false,
              code: "TOKEN_MISMATCH",
              message: "Pair token does not match the approved extension.",
            },
    });
    broker.connectExtension({
      approved: true,
      token: "paired-token",
      send: async (forwarded) => createOkResponse(forwarded, { ok: true }),
    });

    await expect(broker.handleCliRequest(request)).resolves.toEqual(
      createOkResponse(request, { ok: true }),
    );
  });

  it("returns an actionable error when the extension is disconnected", async () => {
    const request = createRequest("noop", {}, "request-1");
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
    });

    const response = await broker.handleCliRequest(request);

    expect(response).toEqual({
      protocolVersion: request.protocolVersion,
      id: request.id,
      ok: false,
      error: {
        code: "EXTENSION_NOT_CONNECTED",
        message: "Firefox extension is not connected to the native host.",
      },
    });
  });

  it("maps malformed CLI requests to structured protocol errors", async () => {
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
    });

    expect(await broker.handleCliRequest("{")).toEqual({
      protocolVersion: 1,
      id: "invalid-request",
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "Payload is not valid JSON.",
        details: expect.any(Object),
      },
    });
  });
});
