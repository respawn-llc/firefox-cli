import { PassThrough } from "node:stream";
import { createOkResponse, createRequest, kernelCapabilities } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { NativeHostBroker } from "./host-broker.js";
import { NativeMessagingFrameReader, encodeNativeMessageFrame } from "./native-messaging-frame.js";
import { attachNativeMessagingConnection } from "./native-host-runtime.js";
import { approvePairing, verifyPairToken, type PairState } from "./pair-state.js";

describe("native host runtime", () => {
  it("bridges broker requests to the extension over native messaging frames", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "firefox-cli@example.invalid",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    const cliRequest = createRequest("capabilities", {}, "request-1");
    const brokerResponse = broker.handleCliRequest(cliRequest);
    const forwarded = (await extensionReader.read()) as typeof cliRequest;

    expect(forwarded).toEqual(cliRequest);
    extensionInput.write(
      encodeNativeMessageFrame(
        createOkResponse(forwarded, {
          capabilities: [...kernelCapabilities],
        }),
      ),
    );

    await expect(brokerResponse).resolves.toEqual(
      createOkResponse(cliRequest, { capabilities: [...kernelCapabilities] }),
    );
  });

  it("rejects duplicate pending request IDs without replacing the first request", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "firefox-cli@example.invalid",
      },
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    const request = createRequest("noop", {}, "duplicate-id");
    const firstResponse = broker.handleCliRequest(request);
    const forwarded = (await extensionReader.read()) as typeof request;

    await expect(broker.handleCliRequest(request)).resolves.toMatchObject({
      id: "duplicate-id",
      ok: false,
      error: { code: "INVALID_ENVELOPE" },
    });

    extensionInput.write(encodeNativeMessageFrame(createOkResponse(forwarded, { ok: true })));
    await expect(firstResponse).resolves.toEqual(createOkResponse(request, { ok: true }));
  });

  it("resolves pending broker requests with TIMEOUT and ignores late responses", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "firefox-cli@example.invalid",
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
    const request = createRequest("noop", {}, "timeout-id");
    const response = broker.handleCliRequest(request);
    const forwarded = (await extensionReader.read()) as typeof request;

    await expect(response).resolves.toMatchObject({
      id: "timeout-id",
      ok: false,
      error: { code: "TIMEOUT" },
    });

    extensionInput.write(encodeNativeMessageFrame(createOkResponse(forwarded, { ok: true })));
    const nextRequest = createRequest("noop", {}, "next-id");
    const nextResponse = broker.handleCliRequest(nextRequest);
    const nextForwarded = (await extensionReader.read()) as typeof nextRequest;

    expect(nextForwarded).toEqual(nextRequest);
    extensionInput.write(encodeNativeMessageFrame(createOkResponse(nextForwarded, { ok: true })));
    await expect(nextResponse).resolves.toEqual(createOkResponse(nextRequest, { ok: true }));
  });

  it("resolves pending broker requests when the extension disconnects", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const broker = new NativeHostBroker({
      hostIdentity: {
        hostId: "host-1",
        extensionId: "firefox-cli@example.invalid",
      },
    });
    const connection = await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: true,
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
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
        extensionId: "firefox-cli@example.invalid",
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
        protocolMax: 1,
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

  it("approves pairing requests and then gates broker forwarding by the returned token", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const hostIdentity = {
      hostId: "host-1",
      extensionId: "firefox-cli@example.invalid",
    };
    let pairState: PairState | null = null;
    const broker = new NativeHostBroker({
      hostIdentity,
      verifyPairToken: (token) => verifyPairToken(pairState, hostIdentity, token),
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: false,
      productVersion: "0.0.0",
      pairing: {
        hostIdentity,
        readState: async () => pairState,
        approve: async () => {
          const approval = approvePairing(hostIdentity, {
            now: () => new Date("2026-01-02T03:04:05.000Z"),
            randomBytes: () => Buffer.from("paired-secret"),
          });
          pairState = approval.state;
          return approval;
        },
        reset: async () => {
          pairState = null;
        },
        verify: (token) => verifyPairToken(pairState, hostIdentity, token),
      },
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    const cliRequest = createRequest("noop", {}, "cli-1");

    await expect(broker.handleCliRequest(cliRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_APPROVED" },
    });

    const approve = createRequest("pair.approve", {}, "approve-1");
    const approveResponse = extensionReader.read();
    extensionInput.write(encodeNativeMessageFrame(approve));

    const approved = await approveResponse;
    expect(approved).toMatchObject({
      id: "approve-1",
      ok: true,
      result: {
        hostId: "host-1",
        generation: 1,
      },
    });
    const token = (approved as { readonly result: { readonly token: string } }).result.token;

    const hello = createRequest(
      "hello",
      {
        component: "extension",
        productName: "firefox-cli",
        productVersion: "0.0.0",
        protocolMin: 1,
        protocolMax: 1,
        features: [],
        pairToken: token,
      },
      "hello-1",
    );
    const helloResponse = extensionReader.read();
    extensionInput.write(encodeNativeMessageFrame(hello));
    await expect(helloResponse).resolves.toMatchObject({
      id: "hello-1",
      ok: true,
      result: {
        pairing: {
          approved: true,
          generation: 1,
        },
      },
    });

    const brokerResponse = broker.handleCliRequest(cliRequest);
    const forwarded = (await extensionReader.read()) as typeof cliRequest;

    expect(forwarded).toEqual(cliRequest);
    extensionInput.write(encodeNativeMessageFrame(createOkResponse(forwarded, { ok: true })));
    await expect(brokerResponse).resolves.toEqual(createOkResponse(cliRequest, { ok: true }));
  });
});
