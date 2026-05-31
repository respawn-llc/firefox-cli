import { describe, expect, it } from "vitest";
import { createOkResponse, createRequest, type ScreenshotResult } from "@firefox-cli/protocol";
import { NativeHostBroker } from "./host-broker.js";
import { FIREFOX_CLI_EXTENSION_ID } from "./host-launch.js";
import { createHostIdentity } from "./pair-state.js";

describe("NativeHostBroker screenshot forwarding", () => {
  it("writes screenshot bytes and strips internal image data from CLI responses", async () => {
    const request = createRequest("screenshot", { path: "/tmp/page.png", format: "png" }, "screenshot-1");
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
      send: async () =>
        createOkResponse(request, {
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
    const testCases: readonly {
      readonly result: ScreenshotResult;
      readonly code: string;
      readonly params?: { readonly maxImageBytes: number };
      readonly writeFailure?: true;
    }[] = [
      {
        result: {
          path: "/tmp/page.png",
          format: "png",
          bytes: 3,
          activation: { tabActivated: false, windowFocused: false },
        },
        code: "INVALID_RESPONSE",
      },
      {
        result: {
          path: "/tmp/page.png",
          format: "png",
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
          format: "png",
          bytes: 3,
          activation: { tabActivated: false, windowFocused: false },
          imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
        },
        code: "OUTPUT_TOO_LARGE",
      },
      {
        result: {
          path: "/tmp/page.png",
          format: "png",
          bytes: 3,
          activation: { tabActivated: false, windowFocused: false },
          imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
        },
        code: "FILE_WRITE_FAILED",
        writeFailure: true,
      },
    ];

    for (const testCase of testCases) {
      const request = createRequest(
        "screenshot",
        {
          path: "/tmp/page.png",
          format: "png",
          ...testCase.params,
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
        send: async () => createOkResponse(request, testCase.result),
      });

      await expect(broker.handleCliRequest(request)).resolves.toMatchObject({
        ok: false,
        error: {
          code: testCase.code,
        },
      });
    }
  });

  it("writes nested batch screenshot bytes and strips image data", async () => {
    const request = createRequest(
      "batch",
      {
        steps: [{ command: "screenshot", params: { path: "/tmp/page.png", format: "png" } }],
      },
      "batch-1",
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
      send: async () =>
        createOkResponse(request, {
          ok: true,
          steps: [
            {
              index: 0,
              command: "screenshot",
              ok: true,
              result: {
                path: "/extension/attempted-retarget.png",
                format: "png",
                bytes: 3,
                activation: {
                  tabActivated: false,
                  windowFocused: false,
                },
                imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
              },
            },
          ],
          elapsedMs: 4,
        }),
    });

    const response = await broker.handleCliRequest(request);

    expect(writes).toEqual([{ path: "/tmp/page.png", data: [1, 2, 3] }]);
    expect(response).toEqual(
      createOkResponse(request, {
        ok: true,
        steps: [
          {
            index: 0,
            command: "screenshot",
            ok: true,
            result: {
              path: "/tmp/page.png",
              format: "png",
              bytes: 3,
              activation: {
                tabActivated: false,
                windowFocused: false,
              },
            },
          },
        ],
        elapsedMs: 4,
      }),
    );
  });

  it("rejects batch screenshot results that do not match the request step", async () => {
    const request = createRequest(
      "batch",
      {
        steps: [{ command: "snapshot", params: {} }],
      },
      "batch-mismatched-screenshot",
    );
    const writes: unknown[] = [];
    const broker = new NativeHostBroker({
      hostIdentity: createHostIdentity({
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => "host-1",
      }),
      writeFile: async (...args) => {
        writes.push(args);
      },
    });
    broker.connectExtension({
      approved: true,
      token: "test-token",
      send: async () =>
        createOkResponse(request, {
          ok: true,
          steps: [
            {
              index: 0,
              command: "screenshot",
              ok: true,
              result: {
                path: "/extension/attempted-retarget.png",
                format: "png",
                bytes: 3,
                activation: {
                  tabActivated: false,
                  windowFocused: false,
                },
                imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
              },
            },
          ],
          elapsedMs: 4,
        }),
    });

    await expect(broker.handleCliRequest(request)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "Batch screenshot result did not match the request step.",
      },
    });
    expect(writes).toEqual([]);
  });
});
