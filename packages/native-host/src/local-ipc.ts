import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import {
  parseBoundaryResponse,
  type RequestEnvelope,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import { NATIVE_HOST_NAME } from "./host-launch.js";

export type LocalIpcEndpoint =
  | {
      readonly kind: "unix-socket";
      readonly path: string;
    }
  | {
      readonly kind: "windows-named-pipe";
      readonly path: string;
    };

export type LocalIpcEndpointOptions = {
  readonly platform: NodeJS.Platform;
  readonly rootDir: string;
  readonly name?: string;
};

export type LocalIpcServerOptions = {
  readonly endpoint: LocalIpcEndpoint;
  readonly authToken?: string;
  handleMessage(message: unknown): Promise<unknown> | unknown;
};

export type LocalIpcAuthTokenStore = {
  readonly filePath: string;
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
};

export class LocalIpcError extends Error {
  readonly code: "INVALID_IPC_RESPONSE" | "CONNECTION_FAILED" | "SOCKET_FAILED" | "REQUEST_FAILED";

  constructor(
    code: LocalIpcError["code"],
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "LocalIpcError";
    this.code = code;
  }
}

export class LocalIpcServer {
  readonly #endpoint: LocalIpcEndpoint;
  readonly #authToken: string | undefined;
  readonly #handleMessage: LocalIpcServerOptions["handleMessage"];
  #server: Server | null = null;

  constructor(options: LocalIpcServerOptions) {
    this.#endpoint = options.endpoint;
    this.#authToken = options.authToken;
    this.#handleMessage = options.handleMessage;
  }

  async start(): Promise<void> {
    if (this.#server !== null) {
      return;
    }

    if (this.#endpoint.kind === "unix-socket") {
      await mkdir(dirname(this.#endpoint.path), { mode: 0o700, recursive: true });
      await chmod(dirname(this.#endpoint.path), 0o700);
      await unlinkStaleSocket(this.#endpoint.path);
    }

    this.#server = createServer((socket) => {
      void this.#handleSocket(socket);
    });

    await new Promise<void>((resolve, reject) => {
      if (this.#server === null) {
        reject(new LocalIpcError("SOCKET_FAILED", "IPC server was not initialized."));
        return;
      }

      this.#server.once("error", reject);
      this.#server.listen(this.#endpoint.path, () => {
        this.#server?.off("error", reject);
        resolve();
      });
    });

    if (this.#endpoint.kind === "unix-socket") {
      await chmod(this.#endpoint.path, 0o600);
    }
  }

  async stop(): Promise<void> {
    if (this.#server === null) {
      return;
    }

    const server = this.#server;
    this.#server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
          return;
        }
        reject(error);
      });
    });

    if (this.#endpoint.kind === "unix-socket") {
      await unlinkStaleSocket(this.#endpoint.path);
    }
  }

  async #handleSocket(socket: Socket): Promise<void> {
    try {
      const message = await readOneJsonLine(socket);
      const authorizedMessage = unwrapAuthorizedMessage(message, this.#authToken);
      if (!authorizedMessage.ok) {
        socket.end(`${JSON.stringify(authorizedMessage.response)}\n`);
        return;
      }

      const response = await this.#handleMessage(authorizedMessage.message);
      socket.end(`${JSON.stringify(response)}\n`);
    } catch (error) {
      socket.destroy(error instanceof Error ? error : undefined);
    }
  }
}

export function planLocalIpcEndpoint(options: LocalIpcEndpointOptions): LocalIpcEndpoint {
  const name = options.name ?? NATIVE_HOST_NAME;
  if (options.platform === "win32") {
    return {
      kind: "windows-named-pipe",
      path: `\\\\.\\pipe\\firefox-cli-${name}`,
    };
  }

  return {
    kind: "unix-socket",
    path: join(options.rootDir, "ipc", `${name}.sock`),
  };
}

export async function sendLocalIpcRequest<C extends RequestEnvelope["command"]>(
  endpoint: LocalIpcEndpoint,
  request: RequestEnvelope<C>,
  options: { readonly authToken?: string | null } = {},
): Promise<ResponseEnvelope<C>> {
  const socket = createConnection(endpoint.path);
  const wireMessage =
    options.authToken === undefined || options.authToken === null
      ? request
      : {
          authToken: options.authToken,
          message: request,
        };
  const rawResponse = await new Promise<unknown>((resolve, reject) => {
    socket.once("error", (error) => {
      reject(
        new LocalIpcError("CONNECTION_FAILED", "Failed to connect to firefox-cli native host.", {
          cause: error,
        }),
      );
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(wireMessage)}\n`);
    });
    readOneJsonLine(socket).then(resolve, reject);
  });

  const parsed = parseBoundaryResponse("cli-to-host", request.command, rawResponse);
  if (!parsed.ok) {
    throw new LocalIpcError("INVALID_IPC_RESPONSE", parsed.error.message);
  }

  return parsed.value as ResponseEnvelope<C>;
}

export class FileLocalIpcAuthTokenStore implements LocalIpcAuthTokenStore {
  readonly filePath: string;

  constructor(options: { readonly stateRoot: string }) {
    this.filePath = join(options.stateRoot, "ipc", "auth-token");
  }

  async read(): Promise<string | null> {
    try {
      return (await readFile(this.filePath, "utf8")).trim() || null;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async write(token: string): Promise<void> {
    await mkdir(dirname(this.filePath), { mode: 0o700, recursive: true });
    await writeFile(this.filePath, `${token}\n`, { mode: 0o600 });
    if (process.platform !== "win32") {
      await chmod(dirname(this.filePath), 0o700);
      await chmod(this.filePath, 0o600);
    }
  }
}

export async function getOrCreateLocalIpcAuthToken(store: LocalIpcAuthTokenStore): Promise<string> {
  const stored = await store.read();
  if (stored !== null) {
    return stored;
  }

  const token = randomBytes(32).toString("base64url");
  await store.write(token);
  return token;
}

async function readOneJsonLine(socket: Socket): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let buffer = "";

    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    const finish = (line: string): void => {
      cleanup();
      try {
        resolve(JSON.parse(line) as unknown);
      } catch (error) {
        reject(
          new LocalIpcError("REQUEST_FAILED", "IPC message is not valid JSON.", {
            cause: error,
          }),
        );
      }
    };
    const onData = (chunk: Buffer): void => {
      buffer += Buffer.from(chunk).toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        finish(buffer.slice(0, newlineIndex));
      }
    };
    const onEnd = (): void => {
      cleanup();
      reject(
        new LocalIpcError("REQUEST_FAILED", "IPC connection closed before a response was sent."),
      );
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
  });
}

function unwrapAuthorizedMessage(
  raw: unknown,
  expectedAuthToken: string | undefined,
):
  | {
      readonly ok: true;
      readonly message: unknown;
    }
  | {
      readonly ok: false;
      readonly response: ResponseEnvelope;
    } {
  if (expectedAuthToken === undefined) {
    return { ok: true, message: raw };
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "authToken" in raw &&
    "message" in raw &&
    raw.authToken === expectedAuthToken
  ) {
    return { ok: true, message: raw.message };
  }

  return {
    ok: false,
    response: {
      protocolVersion: 1,
      id: getRequestId(raw),
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "Local IPC authentication failed.",
      },
    },
  };
}

function getRequestId(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    return "invalid-request";
  }

  if ("id" in raw && typeof raw.id === "string") {
    return raw.id;
  }

  if (
    "message" in raw &&
    typeof raw.message === "object" &&
    raw.message !== null &&
    "id" in raw.message &&
    typeof raw.message.id === "string"
  ) {
    return raw.message.id;
  }

  return "invalid-request";
}

async function unlinkStaleSocket(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
