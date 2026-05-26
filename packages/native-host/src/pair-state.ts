import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import { dirname, join, posix, win32 } from "node:path";

export type PairState = {
  readonly schemaVersion: 1;
  readonly hostId: string;
  readonly extensionId: string;
  readonly tokenHash: string;
  readonly approvedAt: string;
  readonly generation: number;
};

export type HostIdentity = {
  readonly hostId: string;
  readonly extensionId: string;
};

export type HostIdentityStore = {
  readonly filePath: string;
  read(): Promise<HostIdentity | null>;
  write(identity: HostIdentity): Promise<void>;
};

export type PairTokenVerification =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly code:
        | "NOT_APPROVED"
        | "TOKEN_REQUIRED"
        | "TOKEN_MISMATCH"
        | "HOST_ID_MISMATCH"
        | "EXTENSION_ID_MISMATCH";
      readonly message: string;
    };

export type PairTokenRotation = {
  readonly state: PairState;
  readonly token: string;
};

export type PairStateStore = {
  readonly filePath?: string;
  read(): Promise<PairState | null>;
  write(state: PairState): Promise<void>;
  clear(): Promise<void>;
};

export type PairStateDependencies = {
  readonly now?: () => Date;
  readonly randomBytes?: () => Buffer;
};

export type HostIdentityOptions = {
  readonly extensionId: string;
  readonly generateId?: () => string;
};

export function createHostIdentity(options: HostIdentityOptions): HostIdentity {
  return {
    hostId: options.generateId?.() ?? randomUUID(),
    extensionId: options.extensionId,
  };
}

export async function getOrCreateHostIdentity(
  store: HostIdentityStore,
  options: HostIdentityOptions,
): Promise<HostIdentity> {
  const stored = await store.read();
  if (stored !== null && stored.extensionId === options.extensionId) {
    return stored;
  }

  const identity = createHostIdentity(options);
  await store.write(identity);
  return identity;
}

export function approvePairing(
  hostIdentity: HostIdentity,
  dependencies: PairStateDependencies = {},
): PairTokenRotation {
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

export function rotatePairToken(
  currentState: PairState,
  dependencies: PairStateDependencies = {},
): PairTokenRotation {
  return createPairTokenRotation(currentState, dependencies);
}

export function verifyPairToken(
  state: PairState | null,
  hostIdentity: HostIdentity,
  token: string | undefined,
): PairTokenVerification {
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

    return JSON.parse(content) as PairState;
  }

  async write(state: PairState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") {
      await chmod(this.filePath, 0o600);
    }
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

    return JSON.parse(content) as HostIdentity;
  }

  async write(identity: HostIdentity): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") {
      await chmod(this.filePath, 0o600);
    }
  }
}

function createPairTokenRotation(
  state: PairState,
  dependencies: PairStateDependencies,
): PairTokenRotation {
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

function getAppStateFilePath(
  rootDir: string,
  platform: NodeJS.Platform,
  filename: string,
  options: { readonly appDataDir?: string },
): string {
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
