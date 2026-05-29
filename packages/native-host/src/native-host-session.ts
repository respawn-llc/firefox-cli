import type { Readable, Writable } from "node:stream";
import { join } from "node:path";
import { FIREFOX_CLI_EXTENSION_ID } from "@firefox-cli/protocol";
import { NativeHostBroker } from "./host-broker.js";
import {
  FileLocalIpcAuthTokenStore,
  LocalIpcServer,
  getOrCreateLocalIpcAuthToken,
  planLocalIpcEndpoint,
  type LocalIpcEndpoint,
  type LocalIpcAuthTokenStore,
} from "./local-ipc.js";
import { attachNativeMessagingConnection } from "./native-host-runtime.js";
import {
  FileHostIdentityStore,
  FilePairStateStore,
  approvePairing,
  getOrCreateHostIdentity,
  readPairStateStatus,
  verifyPairStateStatus,
  type HostIdentityStore,
  type PairStateStore,
} from "./pair-state.js";

export type NativeHostSessionOptions = {
  readonly input: Readable;
  readonly output: Writable;
  readonly stateRoot: string;
  readonly platform: NodeJS.Platform;
  readonly productVersion: string;
  readonly extensionId?: string;
  readonly homeDir?: string;
  readonly appDataDir?: string;
  readonly approved?: boolean;
  readonly hostIdentityStore?: HostIdentityStore;
  readonly pairStateStore?: PairStateStore;
  readonly ipcAuthTokenStore?: LocalIpcAuthTokenStore;
};

export type NativeHostSession = {
  readonly endpoint: LocalIpcEndpoint;
  readonly closed: Promise<void>;
  stop(): Promise<void>;
};

export async function startNativeHostSession(
  options: NativeHostSessionOptions,
): Promise<NativeHostSession> {
  const endpoint = planLocalIpcEndpoint({
    platform: options.platform,
    rootDir: options.stateRoot,
  });
  const ipcAuthTokenStore =
    options.ipcAuthTokenStore ?? new FileLocalIpcAuthTokenStore({ stateRoot: options.stateRoot });
  const ipcAuthToken = await getOrCreateLocalIpcAuthToken(ipcAuthTokenStore);
  const hostIdentityStore =
    options.hostIdentityStore ??
    (options.homeDir === undefined
      ? new FileHostIdentityStore({ filePath: join(options.stateRoot, "host-identity.json") })
      : new FileHostIdentityStore({
          rootDir: options.homeDir,
          platform: options.platform,
          ...(options.appDataDir === undefined ? {} : { appDataDir: options.appDataDir }),
        }));
  const pairStateStore =
    options.pairStateStore ??
    (options.homeDir === undefined
      ? new FilePairStateStore({ filePath: join(options.stateRoot, "pair-state.json") })
      : new FilePairStateStore({
          rootDir: options.homeDir,
          platform: options.platform,
          ...(options.appDataDir === undefined ? {} : { appDataDir: options.appDataDir }),
        }));
  const hostIdentity = await getOrCreateHostIdentity(hostIdentityStore, {
    extensionId: options.extensionId ?? FIREFOX_CLI_EXTENSION_ID,
  });
  const broker = new NativeHostBroker({
    hostIdentity,
    productVersion: options.productVersion,
    verifyPairToken: async (token) =>
      verifyPairStateStatus(await readPairStateStatus(pairStateStore), hostIdentity, token),
  });
  const nativeConnection = await attachNativeMessagingConnection({
    broker,
    input: options.input,
    output: options.output,
    approved: options.approved ?? false,
    productVersion: options.productVersion,
    pairing: {
      hostIdentity,
      readStateStatus: () => readPairStateStatus(pairStateStore),
      approve: async () => {
        const approval = approvePairing(hostIdentity);
        await pairStateStore.write(approval.state);
        return approval;
      },
      reset: () => pairStateStore.clear(),
    },
  });
  const ipcServer = new LocalIpcServer({
    endpoint,
    authToken: ipcAuthToken,
    enableProtocolNegotiation: true,
    handleMessage: (message, context) => broker.handleCliRequest(message, context),
  });
  await ipcServer.start();

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    nativeConnection.close();
    await ipcServer.stop();
  };
  const closed = nativeConnection.closed.finally(async () => {
    await stop();
  });

  return {
    endpoint,
    closed,
    stop,
  };
}
