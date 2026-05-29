import type { Readable, Writable } from "node:stream";
import {
  PendingRequestTracker,
  createLocalComponentIdentity,
  createErrorResponse,
  createProtocolSession,
  kernelCapabilities,
  localProtocolVersionRange,
  parseBoundaryRequest,
  type CommandId,
  type ProtocolError,
  type ProtocolSession,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import type { NativeHostBroker } from "./host-broker.js";
import { NativeMessagingFrameReader, writeNativeMessage } from "./native-messaging-frame.js";
import type {
  HostIdentity,
  PairStateStatus,
  PairTokenRotation,
  PairTokenVerification,
} from "./pair-state.js";
import { verifyPairStateStatus } from "./pair-state.js";

const DEFAULT_PENDING_REQUEST_TIMEOUT_MS = 660_000;

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
  readonly requestTimeoutMs?: number;
  readonly pairing?: NativeMessagingPairingController;
};

export type NativeMessagingPairingController = {
  readonly hostIdentity: HostIdentity;
  readStateStatus(): Promise<PairStateStatus>;
  approve(): Promise<PairTokenRotation>;
  reset(): Promise<void>;
};

export async function attachNativeMessagingConnection(
  options: AttachNativeMessagingConnectionOptions,
): Promise<NativeMessagingConnection> {
  const pending = new PendingRequestTracker<CommandId, unknown>({
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_PENDING_REQUEST_TIMEOUT_MS,
    onDuplicate: (request) =>
      createErrorResponse(
        request.id,
        {
          code: "INVALID_ENVELOPE",
          message: `Request ID is already pending: ${request.id}`,
        },
        request.protocolVersion ?? localProtocolVersionRange.protocolMax,
      ),
    onTimeout: (request) =>
      createErrorResponse(
        request.id,
        {
          code: "TIMEOUT",
          message: `Timed out waiting for extension response to ${request.command}.`,
        },
        request.protocolVersion ?? localProtocolVersionRange.protocolMax,
      ),
  });
  const reader = new NativeMessagingFrameReader(options.input);
  const connectionState: {
    approved: boolean;
    token: string | undefined;
    pairingError: PairTokenVerification | undefined;
    protocolState: ExtensionProtocolState;
  } = {
    approved: options.approved,
    token: options.token,
    pairingError: undefined,
    protocolState: { state: "negotiating" },
  };
  const extensionConnection = {
    get approved() {
      return connectionState.approved;
    },
    get token() {
      return connectionState.token;
    },
    get pairingError() {
      return connectionState.pairingError;
    },
    get protocolState() {
      return connectionState.protocolState;
    },
    send: async (request: RequestEnvelope): Promise<unknown> => {
      const tracked = pending.track(request);
      if (!tracked.ok) {
        return tracked.value;
      }

      try {
        await writeNativeMessage(options.output, request);
      } catch {
        pending.settle(
          request.id,
          createErrorResponse(
            request.id,
            {
              code: "EXTENSION_NOT_CONNECTED",
              message: "Failed to send request to the Firefox extension.",
            },
            request.protocolVersion ?? localProtocolVersionRange.protocolMax,
          ),
        );
      }

      return tracked.promise;
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
      pending.drain((request) =>
        createErrorResponse(
          request.id,
          {
            code: "EXTENSION_NOT_CONNECTED",
            message: "Firefox extension disconnected before responding.",
          },
          request.protocolVersion,
        ),
      );
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
  readonly pending: PendingRequestTracker<CommandId, unknown>;
  readonly productVersion: string;
  readonly pairing: NativeMessagingPairingController | undefined;
  readonly connectionState: {
    approved: boolean;
    token: string | undefined;
    pairingError: PairTokenVerification | undefined;
    protocolState: ExtensionProtocolState;
  };
}): Promise<void> {
  while (true) {
    const message = await options.reader.read();
    if (message === null) {
      return;
    }

    if (isResponseLike(message)) {
      const command = options.pending.getCommand(message.id);
      if (command === undefined) {
        continue;
      }

      const protocolSession = getExtensionProtocolSession(options.connectionState.protocolState);
      const parsed = protocolSession.parseResponse("host-to-extension", command, message);
      options.pending.settle(
        message.id,
        parsed.ok ? parsed.value : protocolSession.createErrorResponse(message.id, parsed.error),
      );
      continue;
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
    pairingError: PairTokenVerification | undefined;
    protocolState: ExtensionProtocolState;
  };
}): Promise<ResponseEnvelope> {
  const { message, productVersion, pairing, connectionState } = options;
  const parsed = parseBoundaryRequest("host-to-extension", message, {
    ...(connectionState.protocolState.state === "negotiated"
      ? { protocolVersion: connectionState.protocolState.session.protocolVersion }
      : {}),
    hello: {
      local: localProtocolVersionRange,
      expectedPeerComponent: "extension",
    },
  });
  if (!parsed.ok) {
    const response = createProtocolStateErrorResponse(
      connectionState.protocolState,
      getMessageId(message),
      parsed.error,
    );
    if (isRequestCommand(message, "hello") || parsed.error.code === "VERSION_MISMATCH") {
      connectionState.protocolState = { state: "incompatible", error: parsed.error };
    }
    return response;
  }

  const request = parsed.value;
  const protocolSession = createProtocolSession(request.protocolVersion);
  if (request.command === "hello") {
    const helloRequest = request as RequestEnvelope<"hello">;
    const pairState = pairing === undefined ? undefined : await pairing.readStateStatus();
    const pairVerification =
      pairing === undefined || pairState === undefined
        ? undefined
        : verifyPairStateStatus(pairState, pairing.hostIdentity, helloRequest.params.pairToken);
    connectionState.token = helloRequest.params.pairToken;
    connectionState.approved = pairVerification?.ok ?? connectionState.approved;
    connectionState.pairingError =
      pairVerification === undefined || pairVerification.ok ? undefined : pairVerification;
    connectionState.protocolState = { state: "negotiated", session: protocolSession };

    return protocolSession.createOkResponse(request, {
      accepted: true,
      negotiatedProtocolVersion: protocolSession.protocolVersion,
      peer: {
        ...createLocalComponentIdentity("native-host", productVersion),
        protocolMin: localProtocolVersionRange.protocolMin,
        protocolMax: localProtocolVersionRange.protocolMax,
      },
      ...(pairing === undefined
        ? {}
        : {
            pairing: {
              hostId: pairing.hostIdentity.hostId,
              extensionId: pairing.hostIdentity.extensionId,
              approved: pairVerification?.ok ?? false,
              status: helloPairingStatus(pairState, pairVerification),
              ...(pairVerification === undefined || pairVerification.ok
                ? {}
                : { message: pairVerification.message }),
              ...(pairState?.status === "valid" ? { generation: pairState.state.generation } : {}),
            },
          }),
    });
  }

  if (connectionState.protocolState.state === "incompatible") {
    return protocolSession.createErrorResponse(request.id, connectionState.protocolState.error);
  }

  if (connectionState.protocolState.state !== "negotiated") {
    return protocolSession.createErrorResponse(request.id, {
      code: "EXTENSION_NOT_CONNECTED",
      message: "Native host protocol negotiation has not completed.",
    });
  }

  if (request.command === "pair.approve") {
    if (pairing === undefined) {
      return protocolSession.createErrorResponse(request.id, {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Native host pairing is not configured.",
      });
    }

    const approval = await pairing.approve();
    connectionState.approved = true;
    connectionState.token = approval.token;
    connectionState.pairingError = undefined;
    return protocolSession.createOkResponse(request, {
      hostId: approval.state.hostId,
      extensionId: approval.state.extensionId,
      token: approval.token,
      generation: approval.state.generation,
      approvedAt: approval.state.approvedAt,
    });
  }

  if (request.command === "pair.reset") {
    if (pairing === undefined) {
      return protocolSession.createErrorResponse(request.id, {
        code: "UNSUPPORTED_CAPABILITY",
        message: "Native host pairing is not configured.",
      });
    }

    await pairing.reset();
    connectionState.approved = false;
    connectionState.token = undefined;
    connectionState.pairingError = undefined;
    return protocolSession.createOkResponse(request, { ok: true });
  }

  if (request.command === "capabilities") {
    return protocolSession.createOkResponse(request, { capabilities: [...kernelCapabilities] });
  }

  return protocolSession.createOkResponse(request, { ok: true });
}

function helloPairingStatus(
  state: PairStateStatus | undefined,
  verification: PairTokenVerification | undefined,
): "approved" | "not-approved" | "invalid-pair-state" {
  if (verification?.ok) {
    return "approved";
  }

  if (state?.status === "invalid") {
    return "invalid-pair-state";
  }

  return "not-approved";
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

type ExtensionProtocolState =
  | { readonly state: "negotiating" }
  | { readonly state: "negotiated"; readonly session: ProtocolSession }
  | { readonly state: "incompatible"; readonly error: ProtocolError };

function getExtensionProtocolSession(state: ExtensionProtocolState): ProtocolSession {
  return state.state === "negotiated"
    ? state.session
    : createProtocolSession(localProtocolVersionRange.protocolMax);
}

function createProtocolStateErrorResponse(
  state: ExtensionProtocolState,
  id: string,
  error: ProtocolError,
): ResponseEnvelope {
  return getExtensionProtocolSession(state).createErrorResponse(id, error);
}

function getMessageId(message: unknown): string {
  return typeof message === "object" &&
    message !== null &&
    "id" in message &&
    typeof message.id === "string"
    ? message.id
    : "invalid-request";
}

function isRequestCommand(message: unknown, command: string): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "command" in message &&
    message.command === command
  );
}
