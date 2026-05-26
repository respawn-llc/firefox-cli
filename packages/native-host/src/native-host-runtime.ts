import type { Readable, Writable } from "node:stream";
import {
  PROTOCOL_VERSION,
  createErrorResponse,
  createOkResponse,
  kernelCapabilities,
  parseBoundaryRequest,
  parseBoundaryResponse,
  type CommandId,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import type { NativeHostBroker } from "./host-broker.js";
import { NativeMessagingFrameReader, writeNativeMessage } from "./native-messaging-frame.js";
import type {
  HostIdentity,
  PairState,
  PairTokenRotation,
  PairTokenVerification,
} from "./pair-state.js";

export type NativeMessagingConnection = {
  readonly closed: Promise<void>;
  close(): void;
};

export type AttachNativeMessagingConnectionOptions = {
  readonly broker: NativeHostBroker;
  readonly input: Readable;
  readonly output: Writable;
  readonly approved: boolean;
  readonly token?: string;
  readonly productVersion?: string;
  readonly pairing?: NativeMessagingPairingController;
};

export type NativeMessagingPairingController = {
  readonly hostIdentity: HostIdentity;
  readState(): Promise<PairState | null>;
  approve(): Promise<PairTokenRotation>;
  reset(): Promise<void>;
  verify(token: string | undefined): Promise<PairTokenVerification> | PairTokenVerification;
};

type PendingRequest = {
  readonly command: CommandId;
  resolve(response: unknown): void;
  reject(error: unknown): void;
};

export async function attachNativeMessagingConnection(
  options: AttachNativeMessagingConnectionOptions,
): Promise<NativeMessagingConnection> {
  const pending = new Map<string, PendingRequest>();
  const reader = new NativeMessagingFrameReader(options.input);
  const connectionState: {
    approved: boolean;
    token: string | undefined;
  } = {
    approved: options.approved,
    token: options.token,
  };
  const extensionConnection = {
    get approved() {
      return connectionState.approved;
    },
    get token() {
      return connectionState.token;
    },
    send: async (request: RequestEnvelope): Promise<unknown> => {
      await writeNativeMessage(options.output, request);
      return new Promise<unknown>((resolve, reject) => {
        pending.set(request.id, {
          command: request.command,
          resolve,
          reject,
        });
      });
    },
  };
  options.broker.connectExtension(extensionConnection);

  const closed = runReadLoop({
    reader,
    output: options.output,
    pending,
    productVersion: options.productVersion ?? "0.0.0",
    pairing: options.pairing,
    connectionState,
  })
    .catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ERR_STREAM_PREMATURE_CLOSE"
      ) {
        return;
      }
      throw error;
    })
    .finally(() => {
      options.broker.disconnectExtension(extensionConnection);
      for (const pendingRequest of pending.values()) {
        pendingRequest.reject(new Error("Native messaging connection closed."));
      }
      pending.clear();
    });

  return {
    closed,
    close: () => {
      options.input.destroy();
      options.output.end();
    },
  };
}

async function runReadLoop(options: {
  readonly reader: NativeMessagingFrameReader;
  readonly output: Writable;
  readonly pending: Map<string, PendingRequest>;
  readonly productVersion: string;
  readonly pairing: NativeMessagingPairingController | undefined;
  readonly connectionState: {
    approved: boolean;
    token: string | undefined;
  };
}): Promise<void> {
  while (true) {
    const message = await options.reader.read();
    if (message === null) {
      return;
    }

    if (isResponseLike(message)) {
      const pendingRequest = options.pending.get(message.id);
      if (pendingRequest !== undefined) {
        options.pending.delete(message.id);
        const parsed = parseBoundaryResponse("host-to-extension", pendingRequest.command, message);
        if (parsed.ok) {
          pendingRequest.resolve(parsed.value);
        } else {
          pendingRequest.resolve(createErrorResponse(message.id, parsed.error));
        }
        continue;
      }
    }

    const response = await handleExtensionRequest({
      message,
      productVersion: options.productVersion,
      pairing: options.pairing,
      connectionState: options.connectionState,
    });
    await writeNativeMessage(options.output, response);
  }
}

async function handleExtensionRequest(options: {
  readonly message: unknown;
  readonly productVersion: string;
  readonly pairing: NativeMessagingPairingController | undefined;
  readonly connectionState: {
    approved: boolean;
    token: string | undefined;
  };
}): Promise<ResponseEnvelope> {
  const { message, productVersion, pairing, connectionState } = options;
  const parsed = parseBoundaryRequest("host-to-extension", message);
  if (!parsed.ok) {
    return createErrorResponse("invalid-request", parsed.error);
  }

  const request = parsed.value;
  if (request.command === "hello") {
    const helloRequest = request as RequestEnvelope<"hello">;
    const pairState = pairing === undefined ? null : await pairing.readState();
    const pairVerification =
      pairing === undefined ? undefined : await pairing.verify(helloRequest.params.pairToken);
    connectionState.token = helloRequest.params.pairToken;
    connectionState.approved = pairVerification?.ok ?? connectionState.approved;

    return createOkResponse(request, {
      accepted: true,
      negotiatedProtocolVersion: PROTOCOL_VERSION,
      peer: {
        component: "native-host",
        productName: "firefox-cli",
        productVersion,
        protocolMin: PROTOCOL_VERSION,
        protocolMax: PROTOCOL_VERSION,
        features: [],
      },
      ...(pairing === undefined
        ? {}
        : {
            pairing: {
              hostId: pairing.hostIdentity.hostId,
              extensionId: pairing.hostIdentity.extensionId,
              approved: pairVerification?.ok ?? false,
              ...(pairState === null ? {} : { generation: pairState.generation }),
            },
          }),
    });
  }

  if (request.command === "pair.approve") {
    if (pairing === undefined) {
      return createErrorResponse(request.id, {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Native host pairing is not configured.",
      });
    }

    const approval = await pairing.approve();
    connectionState.approved = true;
    connectionState.token = approval.token;
    return createOkResponse(request, {
      hostId: approval.state.hostId,
      extensionId: approval.state.extensionId,
      token: approval.token,
      generation: approval.state.generation,
      approvedAt: approval.state.approvedAt,
    });
  }

  if (request.command === "pair.reset") {
    if (pairing === undefined) {
      return createErrorResponse(request.id, {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Native host pairing is not configured.",
      });
    }

    await pairing.reset();
    connectionState.approved = false;
    connectionState.token = undefined;
    return createOkResponse(request, { ok: true });
  }

  if (request.command === "capabilities") {
    return createOkResponse(request, { capabilities: [...kernelCapabilities] });
  }

  return createOkResponse(request, { ok: true });
}

function isResponseLike(message: unknown): message is { readonly id: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    "ok" in message &&
    typeof message.id === "string"
  );
}
