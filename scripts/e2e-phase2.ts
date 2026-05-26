import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createOkResponse, createRequest } from "@firefox-cli/protocol";
import {
  FIREFOX_CLI_EXTENSION_ID,
  NATIVE_HOST_NAME,
  NativeMessagingFrameReader,
  encodeNativeMessageFrame,
  getBinaryName,
  getPlatformKey,
  planLocalIpcEndpoint,
} from "@firefox-cli/native-host";
import { createTempDir } from "@firefox-cli/test-support";

const binaryPath = resolve("dist/bin", getPlatformKey(), getBinaryName());
await access(binaryPath);

const homeDir = await createTempDir("firefox-cli-e2e-home");
const stateRoot =
  process.platform === "darwin"
    ? join(homeDir, "Library/Application Support/firefox-cli")
    : join(homeDir, ".config/firefox-cli");
const endpoint = planLocalIpcEndpoint({ platform: process.platform, rootDir: stateRoot });
const manifestPath = join(
  homeDir,
  "Library/Application Support/Mozilla/NativeMessagingHosts",
  `${NATIVE_HOST_NAME}.json`,
);
const nativeHost = spawn(binaryPath, [manifestPath, FIREFOX_CLI_EXTENSION_ID], {
  env: {
    ...process.env,
    HOME: homeDir,
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const nativeHostErrors: string[] = [];
nativeHost.stderr.setEncoding("utf8");
nativeHost.stderr.on("data", (chunk: string) => {
  nativeHostErrors.push(chunk);
});

try {
  const reader = new NativeMessagingFrameReader(nativeHost.stdout);
  await waitForEndpoint(endpoint);
  const approve = createRequest("pair.approve", {}, "approve-1");
  nativeHost.stdin.write(encodeNativeMessageFrame(approve));
  const approval = (await withTimeout(
    reader.read(),
    5000,
    "Native host did not answer pair approval.",
  )) as ReturnType<typeof createOkResponse<"pair.approve">>;
  if (!approval.ok) {
    throw new Error(`Pair approval failed: ${JSON.stringify(approval)}`);
  }

  const hello = createRequest(
    "hello",
    {
      component: "extension",
      productName: "firefox-cli",
      productVersion: "0.0.0",
      protocolMin: 1,
      protocolMax: 1,
      features: [],
      pairToken: approval.result.token,
    },
    "hello-1",
  );
  nativeHost.stdin.write(encodeNativeMessageFrame(hello));
  await withTimeout(reader.read(), 5000, "Native host did not answer paired hello.");

  const cli = spawn(binaryPath, ["tab", "--json"], {
    env: {
      ...process.env,
      HOME: homeDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const cliOutput = collectOutput(cli.stdout);
  const cliErrors = collectOutput(cli.stderr);
  const request = (await withTimeout(
    reader.read(),
    5000,
    "Native host did not forward the CLI request to the extension.",
  )) as ReturnType<typeof createRequest<"tabs.list">>;
  if (request.command !== "tabs.list") {
    throw new Error(`Expected tabs.list request, received ${JSON.stringify(request)}`);
  }

  nativeHost.stdin.write(
    encodeNativeMessageFrame(
      createOkResponse(request, {
        tabs: [
          {
            id: 42,
            index: 0,
            active: true,
            title: "Phase 2 E2E",
            url: "https://example.com/",
            windowId: 7,
            private: false,
          },
        ],
      }),
    ),
  );

  const exitCode = await waitForExit(cli);
  const stdout = await cliOutput;
  const stderr = await cliErrors;
  if (exitCode !== 0) {
    throw new Error(`CLI exited with ${exitCode}: ${stderr}`);
  }

  const parsed = JSON.parse(stdout) as { readonly tabs?: readonly unknown[] };
  if (!Array.isArray(parsed.tabs) || parsed.tabs.length !== 1) {
    throw new Error(`Unexpected tab output: ${stdout}`);
  }

  console.log("Phase 2 E2E smoke passed.");
} finally {
  nativeHost.stdin.end();
  nativeHost.kill();
  const stderr = nativeHostErrors.join("").trim();
  if (stderr.length > 0) {
    console.error(stderr);
  }
}

function collectOutput(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveOutput) => {
    let output = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      output += chunk;
    });
    stream.on("end", () => {
      resolveOutput(output);
    });
  });
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolveExit) => child.on("exit", resolveExit));
}

async function waitForEndpoint(endpoint: ReturnType<typeof planLocalIpcEndpoint>): Promise<void> {
  if (endpoint.kind === "windows-named-pipe") {
    await sleep(100);
    return;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      await access(endpoint.path);
      return;
    } catch {
      await sleep(25);
    }
  }

  throw new Error(`IPC endpoint did not appear: ${endpoint.path}`);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
