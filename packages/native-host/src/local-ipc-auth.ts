import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createErrorResponse,
  localProtocolVersionRange,
  type ResponseEnvelope,
} from "@firefox-cli/protocol";
import type { LocalIpcFrameError } from "./local-ipc-frame.js";
import type { LocalIpcAuthTokenStore } from "./local-ipc-types.js";
import { withFileLock, writeFileAtomically } from "./reliability.js";

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
    await mkdir(dirname(this.filePath), { recursive: true });
    if (process.platform !== "win32") {
      await chmod(dirname(this.filePath), 0o700);
    }
    await writeFileAtomically(this.filePath, `${token}\n`, { mode: 0o600 });
  }
}

export async function getOrCreateLocalIpcAuthToken(store: LocalIpcAuthTokenStore): Promise<string> {
  return withFileLock(`${store.filePath}.lock`, async () => {
    const stored = await store.read();
    if (stored !== null) {
      return stored;
    }

    const token = randomBytes(32).toString("base64url");
    await store.write(token);
    return token;
  });
}

export function unwrapAuthorizedMessage(
  raw: unknown,
  expectedAuthToken: string | undefined,
  protocolVersion = localProtocolVersionRange.protocolMax,
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
    response: createErrorResponse(
      getRequestId(raw),
      {
        code: "PERMISSION_DENIED",
        message: "Local IPC authentication failed.",
      },
      protocolVersion,
    ),
  };
}

export function wrapAuthorizedMessage(
  message: unknown,
  authToken: string | null | undefined,
): unknown {
  return authToken === undefined || authToken === null ? message : { authToken, message };
}

export function isHelloRequestLike(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && "command" in raw && raw.command === "hello";
}

export function getRequestId(raw: unknown): string {
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

export function getRequestIdFromFrameError(error: LocalIpcFrameError): string {
  if (error.rawLine === undefined || error.frameCode === "MESSAGE_TOO_LARGE") {
    return "invalid-request";
  }

  try {
    return getRequestId(JSON.parse(error.rawLine.toString("utf8")) as unknown);
  } catch {
    return "invalid-request";
  }
}
