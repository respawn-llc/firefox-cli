import { PassThrough } from "node:stream";
import { PROTOCOL_VERSION, createOkResponse, createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { NativeHostBroker } from "./host-broker.js";
import { attachNativeMessagingConnection } from "./native-host-runtime.js";
import { NativeMessagingFrameReader, encodeNativeMessageFrame } from "./native-messaging-frame.js";
import { PersistedJsonFileError } from "./persisted-json.js";
import { approvePairing, verifyPairStateStatus, type PairState, type PairStateStatus } from "./pair-state.js";

describe("native host runtime pairing", () => {
  it("approves pairing requests and then gates broker forwarding by the returned token", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const hostIdentity = {
      hostId: "host-1",
      extensionId: "firefox-cli@example.invalid",
    };
    let pairState: PairState | null = null;
    const readStateStatus = (): PairStateStatus => (pairState === null ? { status: "missing" } : { status: "valid", state: pairState });
    const broker = new NativeHostBroker({
      hostIdentity,
      verifyPairToken: (token) => verifyPairStateStatus(readStateStatus(), hostIdentity, token),
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: false,
      productVersion: "0.0.0",
      pairing: {
        hostIdentity,
        readStateStatus: async () => readStateStatus(),
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
      },
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    const cliRequest = createRequest("noop", {}, "cli-1");
    await sendExtensionHello(extensionInput, extensionReader);

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
    const forwarded = await extensionReader.read();

    expect(forwarded).toEqual(cliRequest);
    extensionInput.write(encodeNativeMessageFrame(createOkResponse(cliRequest, { ok: true })));
    await expect(brokerResponse).resolves.toEqual(createOkResponse(cliRequest, { ok: true }));
  });

  it("surfaces invalid persisted pair state without crashing hello or CLI gating", async () => {
    const extensionInput = new PassThrough();
    const extensionOutput = new PassThrough();
    const hostIdentity = {
      hostId: "host-1",
      extensionId: "firefox-cli@example.invalid",
    };
    const invalidState: PairStateStatus = {
      status: "invalid",
      error: new PersistedJsonFileError({
        kind: "invalid-shape",
        filePath: "/state/pair-state.json",
        label: "Pair state",
        reason: "generation: Invalid input",
      }),
    };
    const broker = new NativeHostBroker({
      hostIdentity,
      verifyPairToken: (token) => verifyPairStateStatus(invalidState, hostIdentity, token),
    });
    await attachNativeMessagingConnection({
      broker,
      input: extensionInput,
      output: extensionOutput,
      approved: false,
      productVersion: "0.0.0",
      pairing: {
        hostIdentity,
        readStateStatus: async () => invalidState,
        approve: async () => {
          throw new Error("not used");
        },
        reset: async () => undefined,
      },
    });
    const extensionReader = new NativeMessagingFrameReader(extensionOutput);
    const hello = createRequest(
      "hello",
      {
        component: "extension",
        productName: "firefox-cli",
        productVersion: "0.0.0",
        protocolMin: 1,
        protocolMax: PROTOCOL_VERSION,
        features: [],
        pairToken: "stored-token",
      },
      "hello-invalid",
    );
    const helloResponse = extensionReader.read();
    extensionInput.write(encodeNativeMessageFrame(hello));

    await expect(helloResponse).resolves.toMatchObject({
      id: "hello-invalid",
      ok: true,
      result: {
        pairing: {
          approved: false,
          status: "invalid-pair-state",
        },
      },
    });
    await expect(broker.handleCliRequest(createRequest("noop", {}, "cli-invalid"))).resolves.toMatchObject({
      id: "cli-invalid",
      ok: false,
      error: { code: "PAIRING_MISMATCH" },
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
