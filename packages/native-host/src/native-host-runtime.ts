import type { Readable, Writable } from "node:stream";
import {
  PendingRequestTracker,
  createLocalComponentIdentity,
  createErrorResponse,
  createProtocolSession,
  createProtocolStateErrorResponse,
  getProtocolMessageId,
  isProtocolResponseLike,
  isUnknownRequestCommand,
  kernelCapabilities,
  localProtocolVersionRange,
  parseBoundaryRequest,
  timeoutPolicies,
  type CommandId,
  type ProtocolSession,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import type { NativeHostBroker } from "./host-broker.js";
import { getNativeProtocolSession, helloPairingResult, type ExtensionProtocolState } from "./native-host-runtime-helpers.js";
import { NativeMessagingFrameError, NativeMessagingFrameReader, writeNativeMessage } from "./native-messaging-frame.js";
import type { HostIdentity, PairStateStatus, PairTokenRotation, PairTokenVerification } from "./pair-state.js";
import { verifyPairStateStatus } from "./pair-state.js";

const DEFAULT_PENDING_REQUEST_TIMEOUT_MS = timeoutPolicies.hostExtensionRequest.timeoutMs;

export interface NativeMessagingConnection {
  readonly closed: Promise<void>;
  close(): void;
}

export interface AttachNativeMessagingConnectionOptions {
  readonly broker: NativeHostBroker;
  readonly input: Readable;
  readonly output: Writable;
  readonly approved: boolean;
  readonly token?: string;
  readonly productVersion?: string;
  readonly requestTimeoutMs?: number;
  readonly pairing?: NativeMessagingPairingController;
}

export interface NativeMessagingPairingController {
  readonly hostIdentity: HostIdentity;
  readStateStatus(): Promise<PairStateStatus>;
  approve(): Promise<PairTokenRotation>;
  reset(): Promise<void>;
}

interface NativeMessagingConnectionState {
  approved: boolean;
  token: string | undefined;
  pairingError: PairTokenVerification | undefined;
  protocolState: ExtensionProtocolState;
}

export async function attachNativeMessagingConnection(options: AttachNativeMessagingConnectionOptions): Promise<NativeMessagingConnection> {
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
  const reader = new NativeMessagingFrameReader(options.input, {
    partialFrameTimeoutMs: timeoutPolicies.nativeMessagingPartialFrame.timeoutMs,
  });
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
            request.protocolVersion,
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
      if (error && typeof error === "object" && "code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE") {
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
  readonly connectionState: NativeMessagingConnectionState;
}): Promise<void> {
  for (;;) {
    const message = await readNextNativeMessage(options);
    if (message === null) {
      return;
    }

    if (isProtocolResponseLike(message)) {
      const command = options.pending.getCommand(message.id);
      if (command === undefined) {
        continue;
      }

      const protocolSession = getNativeProtocolSession(options.connectionState.protocolState);
      const parsed = protocolSession.parseResponse("host-to-extension", command, message);
      options.pending.settle(message.id, parsed.ok ? parsed.value : protocolSession.createErrorResponse(message.id, parsed.error));
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

async function readNextNativeMessage(options: {
  readonly reader: NativeMessagingFrameReader;
  readonly output: Writable;
  readonly connectionState: NativeMessagingConnectionState;
}): Promise<unknown> {
  try {
    return await options.reader.read();
  } catch (error) {
    if (error instanceof NativeMessagingFrameError && error.recoverable) {
      const protocolSession = getNativeProtocolSession(options.connectionState.protocolState);
      await writeNativeMessage(
        options.output,
        protocolSession.createErrorResponse("invalid-request", {
          code: "INVALID_ENVELOPE",
          message: error.message,
          details: error.details,
        }),
      );
      return readNextNativeMessage(options);
    }
    throw error;
  }
}

async function handleExtensionRequest(options: {
  readonly message: unknown;
  readonly productVersion: string;
  readonly pairing: NativeMessagingPairingController | undefined;
  readonly connectionState: NativeMessagingConnectionState;
}): Promise<ResponseEnvelope> {
  const { message, productVersion, pairing, connectionState } = options;
  const parsed = parseBoundaryRequest("host-to-extension", message, {
    ...(connectionState.protocolState.state === "negotiated" ? { protocolVersion: connectionState.protocolState.session.protocolVersion } : {}),
    hello: {
      local: localProtocolVersionRange,
      expectedPeerComponent: "extension",
    },
  });
  if (!parsed.ok) {
    const response = createProtocolStateErrorResponse(connectionState.protocolState, getProtocolMessageId(message), parsed.error);
    if (isUnknownRequestCommand(message, "hello") || parsed.error.code === "VERSION_MISMATCH") {
      connectionState.protocolState = { state: "incompatible", error: parsed.error };
    }
    return response;
  }

  const request = parsed.value;
  const protocolSession = createProtocolSession(request.protocolVersion);
  if (request.command === "hello") {
    return handleHelloRequest({ request, protocolSession, productVersion, pairing, connectionState });
  }

  return handleNegotiatedExtensionRequest({ request, protocolSession, pairing, connectionState });
}

async function handleHelloRequest(options: {
  readonly request: RequestEnvelope<"hello">;
  readonly protocolSession: ProtocolSession;
  readonly productVersion: string;
  readonly pairing: NativeMessagingPairingController | undefined;
  readonly connectionState: NativeMessagingConnectionState;
}): Promise<ResponseEnvelope<"hello">> {
  const { request, protocolSession, productVersion, pairing, connectionState } = options;
  const pairState = pairing === undefined ? undefined : await pairing.readStateStatus();
  const pairVerification =
    pairing === undefined || pairState === undefined ? undefined : verifyPairStateStatus(pairState, pairing.hostIdentity, request.params.pairToken);
  connectionState.token = request.params.pairToken;
  connectionState.approved = pairVerification?.ok ?? connectionState.approved;
  connectionState.pairingError = pairVerification === undefined || pairVerification.ok ? undefined : pairVerification;
  connectionState.protocolState = { state: "negotiated", session: protocolSession };

  return protocolSession.createOkResponse(request, {
    accepted: true,
    negotiatedProtocolVersion: protocolSession.protocolVersion,
    peer: {
      ...createLocalComponentIdentity("native-host", productVersion),
      protocolMin: localProtocolVersionRange.protocolMin,
      protocolMax: localProtocolVersionRange.protocolMax,
    },
    ...helloPairingResult(pairing, pairState, pairVerification),
  });
}

async function handleNegotiatedExtensionRequest(options: {
  readonly request: RequestEnvelope;
  readonly protocolSession: ProtocolSession;
  readonly pairing: NativeMessagingPairingController | undefined;
  readonly connectionState: NativeMessagingConnectionState;
}): Promise<ResponseEnvelope> {
  const { request, protocolSession, pairing, connectionState } = options;
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
