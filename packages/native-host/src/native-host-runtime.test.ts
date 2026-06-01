import { PassThrough } from "node:stream";
import { createOkResponse, createRequest, kernelCapabilities, MAX_UPLOAD_FILE_BYTES, PROTOCOL_VERSION } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { NativeHostBroker } from "./host-broker.js";
import { attachNativeMessagingConnection } from "./native-host-runtime.js";
import { encodeNativeMessageFrame, NativeMessagingFrameReader } from "./native-messaging-frame.js";

describe("native host runtime", () => {
  it("bridges broker requests to the extension over native messaging frames", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    await sendExtensionHello(extensionInput, extensionReader);
    const cliRequest = createRequest("capabilities", {}, "request-1");
    const brokerResponse = broker.handleCliRequest(cliRequest);
    const forwarded = await extensionReader.read();

    expect(forwarded).toEqual(cliRequest);
    extensionInput.write(
      encodeNativeMessageFrame(
        createOkResponse(cliRequest, {
          capabilities: [...kernelCapabilities],
        }),
      ),
    );

    await expect(brokerResponse).resolves.toEqual(createOkResponse(cliRequest, { capabilities: [...kernelCapabilities] }));
  });

  it("rejects duplicate pending request IDs without replacing the first request", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    await sendExtensionHello(extensionInput, extensionReader);
    const request = createRequest("noop", {}, "duplicate-id");
    const firstResponse = broker.handleCliRequest(request);
    await extensionReader.read();

    await expect(broker.handleCliRequest(request)).resolves.toMatchObject({
      id: "duplicate-id",
      ok: false,
      error: { code: "INVALID_ENVELOPE" },
    });

    extensionInput.write(encodeNativeMessageFrame(createOkResponse(request, { ok: true })));
    await expect(firstResponse).resolves.toEqual(createOkResponse(request, { ok: true }));
  });

  it("rejects oversized upload requests before writing to the extension connection", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const outputChunks: Buffer[] = [];
    extensionOutput.on("data", (chunk: Buffer) => {
      outputChunks.push(Buffer.from(chunk));
    });
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });
    const request = createRequest(
      "upload",
      {
        selector: "#file",
        files: [
          {
            name: "too-large.bin",
            dataBase64: Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1).toString("base64"),
          },
        ],
      },
      "upload-too-large",
    );

    await expect(broker.handleCliRequest(request)).resolves.toMatchObject({
      id: "invalid-request",
      ok: false,
      error: { code: "INVALID_ENVELOPE" },
    });
    expect(outputChunks).toHaveLength(0);
  });

  it("resolves pending broker requests with TIMEOUT and ignores late responses", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
      requestTimeoutMs: 10,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    await sendExtensionHello(extensionInput, extensionReader);
    const request = createRequest("noop", {}, "timeout-id");
    const response = broker.handleCliRequest(request);
    await extensionReader.read();

    await expect(response).resolves.toMatchObject({
      id: "timeout-id",
      ok: false,
      error: { code: "TIMEOUT" },
    });

    extensionInput.write(encodeNativeMessageFrame(createOkResponse(request, { ok: true })));
    const nextRequest = createRequest("noop", {}, "next-id");
    const nextResponse = broker.handleCliRequest(nextRequest);
    const nextForwarded = await extensionReader.read();

    expect(nextForwarded).toEqual(nextRequest);
    extensionInput.write(encodeNativeMessageFrame(createOkResponse(nextRequest, { ok: true })));
    await expect(nextResponse).resolves.toEqual(createOkResponse(nextRequest, { ok: true }));
  });

  it("resolves pending broker requests when the extension disconnects", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    const connection = await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    await sendExtensionHello(extensionInput, extensionReader);
    const request = createRequest("noop", {}, "disconnect-id");
    const response = broker.handleCliRequest(request);

    await extensionReader.read();
    connection.close();

    await expect(response).resolves.toMatchObject({
      id: "disconnect-id",
      ok: false,
      error: { code: "EXTENSION_NOT_CONNECTED" },
    });
  });

  it("answers extension-initiated hello without corrupting stdout", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: false,
      productVersion: "0.0.0",
    });
    const hello = createRequest(
      "hello",
      {
        component: "extension",
        productName: "firefox-cli",
        productVersion: "0.0.0",
        protocolMin: 1,
        protocolMax: PROTOCOL_VERSION,
        features: [],
      },
      "hello-1",
    );
    const response = new NativeMessagingFrameReader(extensionOutput).read();
    extensionInput.write(encodeNativeMessageFrame(hello));

    await expect(response).resolves.toMatchObject({
      id: "hello-1",
      ok: true,
      result: {
        accepted: true,
        peer: {
          component: "native-host",
        },
      },
    });
  });

  it("isolates complete invalid JSON native-messaging frames without disconnecting", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: false,
      productVersion: "0.0.0",
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    const invalidResponse = extensionReader.read();

    extensionInput.write(invalidJsonNativeMessageFrame("{"));

    await expect(invalidResponse).resolves.toMatchObject({
      id: "invalid-request",
      ok: false,
      error: { code: "INVALID_ENVELOPE" },
    });

    const helloResponse = sendExtensionHello(extensionInput, extensionReader);

    await expect(helloResponse).resolves.toMatchObject({
      id: "hello-negotiate",
      ok: true,
      result: {
        accepted: true,
      },
    });
  });

  it("rejects broker forwarding until extension protocol negotiation completes", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });

    await expect(broker.handleCliRequest(createRequest("noop", {}, "cli-before-hello"))).resolves.toMatchObject({
      id: "cli-before-hello",
      ok: false,
      error: { code: "EXTENSION_NOT_CONNECTED" },
    });
  });

  it("stores incompatible host-extension protocol state after no-overlap hello", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "ff-cli-bridge@respawn.pro",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    const hello = createRequest(
      "hello",
      {
        component: "extension",
        productName: "firefox-cli",
        productVersion: "2.0.0",
        protocolMin: PROTOCOL_VERSION + 1,
        protocolMax: PROTOCOL_VERSION + 1,
        features: [],
      },
      "hello-no-overlap",
      3,
    );
    const helloResponse = extensionReader.read();
    extensionInput.write(encodeNativeMessageFrame(hello));

    await expect(helloResponse).resolves.toMatchObject({
      id: "hello-no-overlap",
      ok: false,
      error: { code: "VERSION_MISMATCH" },
    });
    await expect(broker.handleCliRequest(createRequest("noop", {}, "cli-after-mismatch"))).resolves.toMatchObject({
      id: "cli-after-mismatch",
      ok: false,
      error: { code: "VERSION_MISMATCH" },
    });
  });
});

async function sendExtensionHello(
  extensionInput: PassThrough,
  extensionReader: NativeMessagingFrameReader,
  options: { readonly id?: string; readonly pairToken?: string } = {},
): Promise<unknown> {
  const hello = createRequest(
    "hello",
    {
      component: "extension",
      productName: "firefox-cli",
      productVersion: "0.0.0",
      protocolMin: 1,
      protocolMax: PROTOCOL_VERSION,
      features: [],
      ...(options.pairToken === undefined ? {} : { pairToken: options.pairToken }),
    },
    options.id ?? "hello-negotiate",
  );
  const response = extensionReader.read();
  extensionInput.write(encodeNativeMessageFrame(hello));
  return response;
}

function invalidJsonNativeMessageFrame(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.byteLength, 0);
  return Buffer.concat([header, body]);
}
