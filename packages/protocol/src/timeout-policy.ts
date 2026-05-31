export type TimeoutPolicy = {
  readonly name: string;
  readonly timeoutMs: number;
};

export type PollingTimeoutPolicy = TimeoutPolicy & {
  readonly intervalMs: number;
};

export type ByteBoundTimeoutPolicy = TimeoutPolicy & {
  readonly maxBytes: number;
};

export type ProcessStopTimeoutPolicy = {
  readonly name: string;
  readonly interruptGraceMs: number;
  readonly terminateGraceMs: number;
  readonly forceGraceMs: number;
};

export const timeoutPolicies = {
  cliHostConnect: {
    name: "cli-host-connect",
    timeoutMs: 5_000,
  },
  cliHostRequest: {
    name: "cli-host-request",
    timeoutMs: 660_000,
  },
  localIpcServerRequestLine: {
    name: "local-ipc-server-request-line",
    timeoutMs: 5_000,
  },
  localIpcStartupLock: {
    name: "local-ipc-startup-lock",
    timeoutMs: 5_000,
  },
  hostExtensionRequest: {
    name: "host-extension-request",
    timeoutMs: 660_000,
  },
  nativeMessagingPartialFrame: {
    name: "native-messaging-partial-frame",
    timeoutMs: 660_000,
  },
  browserWait: {
    name: "browser-wait",
    timeoutMs: 30_000,
    intervalMs: 100,
  },
  browserEval: {
    name: "browser-eval",
    timeoutMs: 30_000,
  },
  browserScreenshot: {
    name: "browser-screenshot",
    timeoutMs: 30_000,
  },
  marionettePortDiscovery: {
    name: "marionette-port-discovery",
    timeoutMs: 20_000,
    intervalMs: 100,
  },
  marionetteCommand: {
    name: "marionette-command",
    timeoutMs: 10_000,
  },
  marionetteFrame: {
    name: "marionette-frame",
    timeoutMs: 10_000,
    maxBytes: 16 * 1024 * 1024,
  },
  processStop: {
    name: "process-stop",
    interruptGraceMs: 5_000,
    terminateGraceMs: 3_000,
    forceGraceMs: 3_000,
  },
} as const satisfies {
  readonly cliHostConnect: TimeoutPolicy;
  readonly cliHostRequest: TimeoutPolicy;
  readonly localIpcServerRequestLine: TimeoutPolicy;
  readonly localIpcStartupLock: TimeoutPolicy;
  readonly hostExtensionRequest: TimeoutPolicy;
  readonly nativeMessagingPartialFrame: TimeoutPolicy;
  readonly browserWait: PollingTimeoutPolicy;
  readonly browserEval: TimeoutPolicy;
  readonly browserScreenshot: TimeoutPolicy;
  readonly marionettePortDiscovery: PollingTimeoutPolicy;
  readonly marionetteCommand: TimeoutPolicy;
  readonly marionetteFrame: ByteBoundTimeoutPolicy;
  readonly processStop: ProcessStopTimeoutPolicy;
};
