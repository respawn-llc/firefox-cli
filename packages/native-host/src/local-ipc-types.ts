import type { ProtocolSession } from "@firefox-cli/protocol";

export type LocalIpcEndpoint =
  | {
      readonly kind: "unix-socket";
      readonly path: string;
    }
  | {
      readonly kind: "windows-named-pipe";
      readonly path: string;
    };

type Win32LocalIpcEndpointOptions = {
  readonly platform: "win32";
  readonly rootDir: string;
  readonly name?: string;
  readonly endpointScope: string;
};

type UnixLocalIpcEndpointOptions = {
  readonly platform: Exclude<NodeJS.Platform, "win32">;
  readonly rootDir: string;
  readonly name?: string;
};

export type LocalIpcEndpointOptions =
  | Win32LocalIpcEndpointOptions
  | UnixLocalIpcEndpointOptions
  | {
      readonly platform: NodeJS.Platform;
      readonly rootDir: string;
      readonly name?: string;
      readonly endpointScope: string;
    };

export type LocalIpcServerOptions = {
  readonly endpoint: LocalIpcEndpoint;
  readonly authToken?: string;
  readonly enableProtocolNegotiation?: boolean;
  readonly requestLineTimeoutMs?: number;
  readonly startupLockTimeoutMs?: number;
  handleMessage(
    message: unknown,
    context?: { readonly protocolSession?: ProtocolSession },
  ): Promise<unknown> | unknown;
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
