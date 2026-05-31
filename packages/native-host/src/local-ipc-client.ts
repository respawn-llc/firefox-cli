import { createConnection, type Socket } from "node:net";
import {
  createErrorResponseForRequest,
  createLocalComponentIdentity,
  createProtocolSession,
  createRequest,
  createRequestProtocolMismatchError,
  timeoutPolicies,
  getRequestProtocolCompatibility,
  localProtocolVersionRange,
  parseBoundaryResponse,
  parseBoundaryResponseForRequest,
  type ProtocolVersionRange,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { wrapAuthorizedMessage } from "./local-ipc-auth.js";
import {
  createLocalIpcErrorResponse,
  encodeLocalIpcJsonLine,
  frameErrorToProtocolError,
  isMessageTooLargeError,
  LocalIpcFrameError,
  readOneJsonLine,
} from "./local-ipc-frame.js";
import { LocalIpcError, type LocalIpcEndpoint } from "./local-ipc-types.js";
import { NativeHostReliabilityError, withDeadline } from "./reliability.js";

const DEFAULT_LOCAL_IPC_CLIENT_TIMEOUT_MS = timeoutPolicies.cliHostRequest.timeoutMs;
const DEFAULT_LOCAL_IPC_CONNECT_TIMEOUT_MS = timeoutPolicies.cliHostConnect.timeoutMs;

export async function sendLocalIpcRequest<C extends RequestEnvelope["command"]>(
  endpoint: LocalIpcEndpoint,
  request: RequestEnvelope<C>,
  options: {
    readonly authToken?: string | null;
    readonly timeoutMs?: number;
    readonly connectTimeoutMs?: number;
  } = {},
): Promise<ResponseEnvelope<C>> {
  let encodedRequest: Buffer;
  try {
    encodedRequest = encodeLocalIpcJsonLine(wrapAuthorizedMessage(request, options.authToken));
  } catch (error) {
    if (isMessageTooLargeError(error)) {
      return createErrorResponseForRequest(request, {
        code: "OUTPUT_TOO_LARGE",
        message: error.message,
        details: { ...error.details },
      });
    }
    throw error;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_IPC_CLIENT_TIMEOUT_MS;
  const socket = await connectLocalIpcSocket(endpoint, {
    timeoutMs: options.connectTimeoutMs ?? Math.min(timeoutMs, DEFAULT_LOCAL_IPC_CONNECT_TIMEOUT_MS),
  });
  const rawResponse = await writeAndReadLocalIpcResponse(socket, encodedRequest, request.id, timeoutMs).finally(() => {
    socket.destroy();
  });

  const parsed = parseBoundaryResponseForRequest("cli-to-host", request, rawResponse);
  if (!parsed.ok) {
    throw new LocalIpcError("INVALID_IPC_RESPONSE", parsed.error.message);
  }

  return parsed.value;
}

export async function sendNegotiatedLocalIpcRequest<C extends RequestEnvelope["command"]>(
  endpoint: LocalIpcEndpoint,
  request: RequestEnvelope<C>,
  options: {
    readonly authToken?: string | null;
    readonly productVersion?: string;
    readonly protocolRange?: ProtocolVersionRange;
    readonly timeoutMs?: number;
    readonly connectTimeoutMs?: number;
  } = {},
): Promise<ResponseEnvelope<C>> {
  const protocolRange = options.protocolRange ?? localProtocolVersionRange;
  const hello = createRequest(
    "hello",
    {
      ...createLocalComponentIdentity("cli", options.productVersion ?? "0.0.0"),
      protocolMin: protocolRange.protocolMin,
      protocolMax: protocolRange.protocolMax,
    },
    `${request.id}:hello`,
    protocolRange.protocolMin,
  );
  const encodedHello = encodeRequestForLocalIpc(request, hello, options.authToken);
  if (!encodedHello.ok) {
    return encodedHello.response;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_IPC_CLIENT_TIMEOUT_MS;
  const socket = await connectLocalIpcSocket(endpoint, {
    timeoutMs: options.connectTimeoutMs ?? Math.min(timeoutMs, DEFAULT_LOCAL_IPC_CONNECT_TIMEOUT_MS),
  });
  let destroySocketOnReturn = true;
  try {
    const rawHelloResponse = await writeAndReadLocalIpcResponse(socket, encodedHello.buffer, request.id, timeoutMs);
    const negotiation = negotiateLocalIpcProtocol(request, rawHelloResponse, protocolRange);
    if (!negotiation.ok) {
      return negotiation.response;
    }

    const protocolSession = negotiation.session;
    const compatibility = getRequestProtocolCompatibility(request, protocolSession.protocolVersion);
    if (!compatibility.compatible) {
      closeNegotiatedSocketWithoutRequest(socket);
      destroySocketOnReturn = false;
      return protocolSession.createErrorResponseForRequest(request, createRequestProtocolMismatchError(request, protocolSession.protocolVersion));
    }

    const encodedRequest = encodeRequestForLocalIpc(request, protocolSession.withRequestVersion(request), options.authToken, protocolSession);
    if (!encodedRequest.ok) {
      return encodedRequest.response;
    }

    socket.write(encodedRequest.buffer);
    const rawResponse = await readLocalIpcResponse(socket, request.id, timeoutMs);
    const parsed = protocolSession.parseResponseForRequest("cli-to-host", request, rawResponse);
    if (!parsed.ok) {
      throw new LocalIpcError("INVALID_IPC_RESPONSE", parsed.error.message);
    }

    return parsed.value;
  } finally {
    if (destroySocketOnReturn) {
      socket.destroy();
    }
  }
}

function negotiateLocalIpcProtocol<C extends RequestEnvelope["command"]>(
  request: RequestEnvelope<C>,
  rawHelloResponse: unknown,
  protocolRange: ProtocolVersionRange,
):
  | { readonly ok: true; readonly session: ReturnType<typeof createProtocolSession> }
  | {
      readonly ok: false;
      readonly response: ResponseEnvelope<C>;
    } {
  const parsedHello = parseBoundaryResponse("cli-to-host", "hello", rawHelloResponse, {
    hello: {
      local: protocolRange,
      expectedPeerComponent: "native-host",
    },
  });
  if (!parsedHello.ok) {
    throw new LocalIpcError("INVALID_IPC_RESPONSE", parsedHello.error.message);
  }
  if (!parsedHello.value.ok) {
    return {
      ok: false,
      response: createErrorResponseForRequest(request, parsedHello.value.error, parsedHello.value.protocolVersion),
    };
  }

  return { ok: true, session: createProtocolSession(parsedHello.value.protocolVersion) };
}

function encodeRequestForLocalIpc<C extends RequestEnvelope["command"]>(
  responseRequest: RequestEnvelope<C>,
  outboundMessage: unknown,
  authToken: string | null | undefined,
  protocolSession = createProtocolSession(responseRequest.protocolVersion),
): { readonly ok: true; readonly buffer: Buffer } | { readonly ok: false; readonly response: ResponseEnvelope<C> } {
  try {
    return { ok: true, buffer: encodeLocalIpcJsonLine(wrapAuthorizedMessage(outboundMessage, authToken)) };
  } catch (error) {
    if (isMessageTooLargeError(error)) {
      return {
        ok: false,
        response: protocolSession.createErrorResponseForRequest(responseRequest, {
          code: "OUTPUT_TOO_LARGE",
          message: error.message,
          details: { ...error.details },
        }),
      };
    }
    throw error;
  }
}

function closeNegotiatedSocketWithoutRequest(socket: Socket): void {
  // The host is waiting for the second frame on this negotiated socket. End the write side
  // cleanly and let the host close after its frame-error response so it does not race a
  // client-side destroy with an EPIPE.
  socket.once("error", () => undefined);
  socket.end();
}

async function connectLocalIpcSocket(endpoint: LocalIpcEndpoint, options: { readonly timeoutMs: number }): Promise<Socket> {
  const socket = createConnection(endpoint.path);
  return withDeadline(
    new Promise<Socket>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.off("connect", onConnect);
        reject(
          new LocalIpcError("CONNECTION_FAILED", "Failed to connect to firefox-cli native host.", {
            cause: error,
          }),
        );
      };
      const onConnect = (): void => {
        socket.off("error", onError);
        resolve(socket);
      };

      socket.once("error", onError);
      socket.once("connect", onConnect);
    }),
    {
      timeoutMs: options.timeoutMs,
      message: "Timed out connecting to firefox-cli native host.",
      onTimeout: () => socket.destroy(),
    },
  ).catch((error: unknown) => {
    if (error instanceof NativeHostReliabilityError && error.code === "TRANSPORT_TIMEOUT") {
      throw new LocalIpcError("CONNECTION_FAILED", error.message, { cause: error });
    }
    throw error;
  });
}

async function writeAndReadLocalIpcResponse(socket: Socket, message: Buffer, fallbackRequestId: string, timeoutMs: number): Promise<unknown> {
  socket.write(message);
  return readLocalIpcResponse(socket, fallbackRequestId, timeoutMs);
}

async function readLocalIpcResponse(socket: Socket, fallbackRequestId: string, timeoutMs: number): Promise<unknown> {
  try {
    return await withDeadline(readOneJsonLine(socket), {
      timeoutMs,
      message: `Timed out waiting for firefox-cli native host response within ${String(timeoutMs)}ms.`,
      onTimeout: () => socket.destroy(),
    });
  } catch (error) {
    if (error instanceof NativeHostReliabilityError && error.code === "TRANSPORT_TIMEOUT") {
      return createLocalIpcErrorResponse(fallbackRequestId, "TIMEOUT", error.message);
    }
    if (error instanceof LocalIpcFrameError) {
      const protocolError = frameErrorToProtocolError(error);
      return createLocalIpcErrorResponse(fallbackRequestId, protocolError.code, protocolError.message, protocolError.details);
    }

    throw error;
  }
}
