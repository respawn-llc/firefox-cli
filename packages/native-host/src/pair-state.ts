import { readFile, unlink } from "node:fs/promises";
import { createHash, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import { join, posix, win32 } from "node:path";
import { z } from "zod";
import { type PersistedJsonFileError, isPersistedJsonFileError, parsePersistedJson } from "./persisted-json.js";
import { withFileLock, writeFileAtomically } from "./reliability.js";

export interface PairState {
  readonly schemaVersion: 1;
  readonly hostId: string;
  readonly extensionId: string;
  readonly tokenHash: string;
  readonly approvedAt: string;
  readonly generation: number;
}

export interface HostIdentity {
  readonly hostId: string;
  readonly extensionId: string;
}

export const pairStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    hostId: z.string().min(1),
    extensionId: z.string().min(1),
    tokenHash: z.string().min(1),
    approvedAt: z.string().min(1),
    generation: z.number().int().positive(),
  })
  .strict();

export const hostIdentitySchema = z
  .object({
    hostId: z.string().min(1),
    extensionId: z.string().min(1),
  })
  .strict();

export type PairStateStatus =
  | {
      readonly status: "missing";
    }
  | {
      readonly status: "valid";
      readonly state: PairState;
    }
  | {
      readonly status: "invalid";
      readonly error: PersistedJsonFileError;
    };

export interface HostIdentityStore {
  readonly filePath: string;
  read(): Promise<HostIdentity | null>;
  write(identity: HostIdentity): Promise<void>;
}

export type PairTokenVerification =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code: "NOT_APPROVED" | "TOKEN_REQUIRED" | "TOKEN_MISMATCH" | "HOST_ID_MISMATCH" | "EXTENSION_ID_MISMATCH" | "PAIR_STATE_INVALID";
      readonly message: string;
    };

export interface PairTokenRotation {
  readonly state: PairState;
  readonly token: string;
}

export interface PairStateStore {
  readonly filePath?: string;
  read(): Promise<PairState | null>;
  write(state: PairState): Promise<void>;
  clear(): Promise<void>;
}

export interface PairStateDependencies {
  readonly now?: () => Date;
  readonly randomBytes?: () => Buffer;
}

export interface HostIdentityOptions {
  readonly extensionId: string;
  readonly generateId?: () => string;
}

export function createHostIdentity(options: HostIdentityOptions): HostIdentity {
  return {
    hostId: options.generateId?.() ?? randomUUID(),
    extensionId: options.extensionId,
  };
}

export async function getOrCreateHostIdentity(store: HostIdentityStore, options: HostIdentityOptions): Promise<HostIdentity> {
  return withFileLock(`${store.filePath}.lock`, async () => {
    let stored: HostIdentity | null;
    try {
      stored = await store.read();
    } catch (error) {
      if (!isPersistedJsonFileError(error)) {
        throw error;
      }
      stored = null;
    }
    if (stored !== null && stored.extensionId === options.extensionId) {
      return stored;
    }

    const identity = createHostIdentity(options);
    await store.write(identity);
    return identity;
  });
}

export function approvePairing(hostIdentity: HostIdentity, dependencies: PairStateDependencies = {}): PairTokenRotation {
  return createPairTokenRotation(
    {
      schemaVersion: 1,
      hostId: hostIdentity.hostId,
      extensionId: hostIdentity.extensionId,
      tokenHash: "",
      approvedAt: "",
      generation: 0,
    },
    dependencies,
  );
}

export function rotatePairToken(currentState: PairState, dependencies: PairStateDependencies = {}): PairTokenRotation {
  return createPairTokenRotation(currentState, dependencies);
}

export function verifyPairToken(state: PairState | null, hostIdentity: HostIdentity, token: string | undefined): PairTokenVerification {
  if (state === null) {
    return {
      ok: false,
      code: "NOT_APPROVED",
      message: "Native host has not been approved by the extension popup.",
    };
  }

  if (state.hostId !== hostIdentity.hostId) {
    return {
      ok: false,
      code: "HOST_ID_MISMATCH",
      message: "Native host identity changed after approval.",
    };
  }

  if (state.extensionId !== hostIdentity.extensionId) {
    return {
      ok: false,
      code: "EXTENSION_ID_MISMATCH",
      message: "Extension identity does not match the approved pair state.",
    };
  }

  if (token === undefined || token.length === 0) {
    return {
      ok: false,
      code: "TOKEN_REQUIRED",
      message: "Extension is not paired with this native host.",
    };
  }

  if (hashToken(token) !== state.tokenHash) {
    return {
      ok: false,
      code: "TOKEN_MISMATCH",
      message: "Pair token does not match the approved extension.",
    };
  }

  return { ok: true };
}

export async function readPairStateStatus(store: PairStateStore): Promise<PairStateStatus> {
  try {
    const state = await store.read();
    return state === null ? { status: "missing" } : { status: "valid", state };
  } catch (error) {
    if (isPersistedJsonFileError(error)) {
      return { status: "invalid", error };
    }
    throw error;
  }
}

export function verifyPairStateStatus(state: PairStateStatus, hostIdentity: HostIdentity, token: string | undefined): PairTokenVerification {
  if (state.status === "invalid") {
    return {
      ok: false,
      code: "PAIR_STATE_INVALID",
      message: "Stored pair state is invalid. Reset approval from the extension popup or run `firefox-cli unpair`, then approve firefox-cli again.",
    };
  }

  return verifyPairToken(state.status === "missing" ? null : state.state, hostIdentity, token);
}

export async function unpair(store: PairStateStore): Promise<void> {
  await store.clear();
}

export class FilePairStateStore implements PairStateStore {
  readonly filePath: string;

  constructor(
    options:
      | {
          readonly rootDir: string;
          readonly platform: NodeJS.Platform;
          readonly appDataDir?: string;
        }
      | {
          readonly filePath: string;
        },
  ) {
    if ("filePath" in options) {
      this.filePath = options.filePath;
      return;
    }

    this.filePath = getAppStateFilePath(options.rootDir, options.platform, "pair-state.json", {
      ...(options.appDataDir === undefined ? {} : { appDataDir: options.appDataDir }),
    });
  }

  async read(): Promise<PairState | null> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    return parsePersistedJson(content, pairStateSchema, {
      filePath: this.filePath,
      label: "Pair state",
    });
  }

  async write(state: PairState): Promise<void> {
    await writeFileAtomically(this.filePath, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

export class FileHostIdentityStore implements HostIdentityStore {
  readonly filePath: string;

  constructor(
    options:
      | {
          readonly rootDir: string;
          readonly platform: NodeJS.Platform;
          readonly appDataDir?: string;
        }
      | {
          readonly filePath: string;
        },
  ) {
    if ("filePath" in options) {
      this.filePath = options.filePath;
      return;
    }

    this.filePath = getAppStateFilePath(options.rootDir, options.platform, "host-identity.json", {
      ...(options.appDataDir === undefined ? {} : { appDataDir: options.appDataDir }),
    });
  }

  async read(): Promise<HostIdentity | null> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    return parsePersistedJson(content, hostIdentitySchema, {
      filePath: this.filePath,
      label: "Host identity",
    });
  }

  async write(identity: HostIdentity): Promise<void> {
    await writeFileAtomically(this.filePath, `${JSON.stringify(identity, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}

function createPairTokenRotation(state: PairState, dependencies: PairStateDependencies): PairTokenRotation {
  const token = createPairToken(dependencies);
  const approvedAt = (dependencies.now?.() ?? new Date()).toISOString();

  return {
    token,
    state: {
      ...state,
      tokenHash: hashToken(token),
      approvedAt,
      generation: state.generation + 1,
    },
  };
}

function createPairToken(dependencies: PairStateDependencies): string {
  const bytes = dependencies.randomBytes?.() ?? nodeRandomBytes(32);
  return bytes.toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function getAppStateFilePath(rootDir: string, platform: NodeJS.Platform, filename: string, options: { readonly appDataDir?: string }): string {
  if (platform === "darwin") {
    return join(rootDir, "Library/Application Support/firefox-cli", filename);
  }

  if (platform === "linux") {
    return posix.join(rootDir, ".config/firefox-cli", filename);
  }

  if (platform === "win32") {
    const appDataDir = options.appDataDir ?? win32.join(rootDir, "AppData", "Roaming");
    return win32.join(appDataDir, "firefox-cli", filename);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}
