import { PassThrough } from "node:stream";
import { PROTOCOL_VERSION, createOkResponse, createRequest, kernelCapabilities } from "@firefox-cli/protocol";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { NativeMessagingFrameReader, encodeNativeMessageFrame } from "./native-messaging-frame.js";
import { FileLocalIpcAuthTokenStore, sendNegotiatedLocalIpcRequest } from "./local-ipc.js";
import { startNativeHostSession } from "./native-host-session.js";

describe("native host session", () => {
  it("bridges local IPC requests to the connected extension over native messaging", async () => {
    const stateRoot = await createTempDir("firefox-cli-host-session");
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const session = await startNativeHostSession({
      input: extensionInput,
      output: extensionOutput,
      stateRoot,
      platform: process.platform,
      productVersion: "0.0.0",
      approved: true,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    const initialHello = createRequest(
      "hello",
      {
        component: "extension",
        productName: "firefox-cli",
        productVersion: "0.0.0",
        protocolMin: 1,
        protocolMax: PROTOCOL_VERSION,
        features: [],
      },
      "hello-initial",
    );
    const initialHelloResponse = extensionReader.read();
    extensionInput.write(encodeNativeMessageFrame(initialHello));
    await expect(initialHelloResponse).resolves.toMatchObject({
      ok: true,
      result: { peer: { component: "native-host" } },
    });
    const approve = createRequest("pair.approve", {}, "approve-1");
    const approveResponse = extensionReader.read();
    extensionInput.write(encodeNativeMessageFrame(approve));
    const approved = await approveResponse;
    const token = getPairApproveToken(approved);
    const hello = createRequest(
      "hello",
      {
        component: "extension",
        productName: "firefox-cli",
        productVersion: "0.0.0",
        protocolMin: 1,
        protocolMax: PROTOCOL_VERSION,
        features: [],
        pairToken: token,
      },
      "hello-1",
    );
    const helloResponse = extensionReader.read();
    extensionInput.write(encodeNativeMessageFrame(hello));
    await expect(helloResponse).resolves.toMatchObject({
      ok: true,
      result: { pairing: { approved: true } },
    });
    const ipcAuthToken = await new FileLocalIpcAuthTokenStore({ stateRoot }).read();

    const request = createRequest("capabilities", {}, "request-1");
    const response = sendNegotiatedLocalIpcRequest(session.endpoint, request, {
      authToken: ipcAuthToken,
      productVersion: "0.0.0",
    });
    const forwarded = await extensionReader.read();

    expect(forwarded).toEqual(request);
    extensionInput.write(encodeNativeMessageFrame(createOkResponse(request, { capabilities: [...kernelCapabilities] })));

    await expect(response).resolves.toEqual(createOkResponse(request, { capabilities: [...kernelCapabilities] }));
    await session.stop();
  });
});

function getPairApproveToken(response: unknown): string {
  if (
    typeof response === "object" &&
    response !== null &&
    "ok" in response &&
    response.ok === true &&
    "result" in response &&
    typeof response.result === "object" &&
    response.result !== null &&
    "token" in response.result &&
    typeof response.result.token === "string"
  ) {
    return response.result.token;
  }

  throw new Error("Expected pair.approve response with a token.");
}
