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
