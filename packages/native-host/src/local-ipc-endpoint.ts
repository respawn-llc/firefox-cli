import { posix } from "node:path";
import { NATIVE_HOST_NAME } from "./host-launch.js";
import { createLocalIpcEndpointScope } from "./reliability.js";
import { LocalIpcError, type LocalIpcEndpoint, type LocalIpcEndpointOptions } from "./local-ipc-types.js";

export function planLocalIpcEndpoint(options: LocalIpcEndpointOptions): LocalIpcEndpoint {
  const name = options.name ?? NATIVE_HOST_NAME;
  if (options.platform === "win32") {
    const endpointScope = "endpointScope" in options ? options.endpointScope : undefined;
    if (endpointScope === undefined || endpointScope.length === 0) {
      throw new LocalIpcError("SOCKET_FAILED", "Windows local IPC endpoints require an auth-token-derived scope.");
    }
    return {
      kind: "windows-named-pipe",
      path: `\\\\.\\pipe\\firefox-cli-${name}-${endpointScope}`,
    };
  }

  return {
    kind: "unix-socket",
    path: posix.join(options.rootDir, "ipc", `${name}.sock`),
  };
}

export { createLocalIpcEndpointScope };
