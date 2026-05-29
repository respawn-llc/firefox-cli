export {
  getBinaryName,
  getPlatformKey,
  resolvePackagedBinary,
  type PlatformInput,
} from "./platform-binary.js";
export {
  DEFAULT_MAX_NATIVE_MESSAGE_INCOMING_BYTES,
  MAX_NATIVE_MESSAGE_OUTGOING_BYTES,
  NativeMessagingFrameError,
  NativeMessagingFrameReader,
  encodeNativeMessageFrame,
  writeNativeMessage,
  type NativeMessagingFrameErrorCode,
  type NativeMessagingFrameReaderOptions,
} from "./native-messaging-frame.js";
export {
  FIREFOX_CLI_EXTENSION_ID,
  NATIVE_HOST_NAME,
  detectNativeHostLaunch,
  type NativeHostLaunchDetection,
  type NativeHostLaunchDetectionOptions,
} from "./host-launch.js";
export {
  createNativeMessagingManifest,
  parseNativeMessagingManifestJson,
  planNativeMessagingManifest,
  writeNativeMessagingManifest,
  nativeMessagingManifestSchema,
  type NativeMessagingManifest,
  type NativeMessagingManifestOptions,
  type NativeMessagingManifestPlan,
  type NativeMessagingManifestPlanOptions,
  type NativeMessagingManifestRegistration,
} from "./native-manifest.js";
export {
  FileHostIdentityStore,
  FilePairStateStore,
  approvePairing,
  createHostIdentity,
  getOrCreateHostIdentity,
  rotatePairToken,
  readPairStateStatus,
  unpair,
  verifyPairStateStatus,
  verifyPairToken,
  type PairStateStatus,
  type HostIdentityStore,
  type HostIdentity,
  type HostIdentityOptions,
  type PairState,
  type PairStateDependencies,
  type PairStateStore,
  type PairTokenRotation,
  type PairTokenVerification,
} from "./pair-state.js";
export {
  PersistedJsonFileError,
  isPersistedJsonFileError,
  parsePersistedJson,
  type PersistedJsonErrorKind,
} from "./persisted-json.js";
export {
  NativeHostBroker,
  type ExtensionConnection,
  type NativeHostBrokerOptions,
} from "./host-broker.js";
export {
  FileLocalIpcAuthTokenStore,
  LocalIpcError,
  LocalIpcServer,
  getOrCreateLocalIpcAuthToken,
  planLocalIpcEndpoint,
  sendLocalIpcRequest,
  sendNegotiatedLocalIpcRequest,
  type LocalIpcAuthTokenStore,
  type LocalIpcEndpoint,
  type LocalIpcEndpointOptions,
  type LocalIpcServerOptions,
} from "./local-ipc.js";
export {
  attachNativeMessagingConnection,
  type AttachNativeMessagingConnectionOptions,
  type NativeMessagingConnection,
} from "./native-host-runtime.js";
export {
  startNativeHostSession,
  type NativeHostSession,
  type NativeHostSessionOptions,
} from "./native-host-session.js";
