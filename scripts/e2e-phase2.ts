import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createOkResponse, createRequest, parseBoundaryRequest } from "@firefox-cli/protocol";
import { z } from "zod";
import {
  FIREFOX_CLI_EXTENSION_ID,
  NativeMessagingFrameReader,
  encodeNativeMessageFrame,
  getBinaryName,
  getPlatformKey,
  type LocalIpcEndpoint,
} from "@firefox-cli/native-host";
import { createTempDir } from "@firefox-cli/test-support";
import { planPhase2E2e } from "./e2e-phase2-plan.js";
import { parseJsonWithSchema } from "./manifest-validation.js";
import { raceWithProcessFailure, runProcess, startManagedProcess } from "./process-runner.js";
import { pollUntil, sleep, withTimeout } from "./script-timing.js";

const binaryPath = resolve("dist/bin", getPlatformKey(), getBinaryName());
await access(binaryPath);

const homeDir = await createTempDir("firefox-cli-e2e-home");
const e2ePlan = planPhase2E2e({
  binaryPath,
  homeDir,
  platform: process.platform,
  baseEnv: process.env,
});
const nativeHost = startManagedProcess(binaryPath, [e2ePlan.manifestPlan.manifestPath, FIREFOX_CLI_EXTENSION_ID], {
  env: e2ePlan.env,
  stdin: "pipe",
  label: "phase2 native host",
});

try {
  if (nativeHost.child.stdout === null || nativeHost.child.stdin === null) {
    throw new Error("Native host stdio was not available.");
  }
  const reader = new NativeMessagingFrameReader(nativeHost.child.stdout);
  await raceWithProcessFailure(nativeHost, waitForEndpoint(e2ePlan.endpoint), "phase2 native host endpoint");
  const approve = createRequest("pair.approve", {}, "approve-1");
  nativeHost.child.stdin.write(encodeNativeMessageFrame(approve));
  const approval = await withTimeout(reader.read(), {
    timeoutMs: 5000,
    timeoutMessage: () => "Native host did not answer pair approval.",
  });
  const approved = parseJsonWithSchema(
    JSON.stringify(approval),
    "pair approval",
    "native host pair approval",
    z.object({ ok: z.literal(true), result: z.object({ token: z.string().min(1) }) }).loose(),
  );
  const hello = createRequest(
    "hello",
    {
      component: "extension",
      productName: "firefox-cli",
      productVersion: "0.0.0",
      protocolMin: 1,
      protocolMax: 1,
      features: [],
      pairToken: approved.result.token,
    },
    "hello-1",
  );
  nativeHost.child.stdin.write(encodeNativeMessageFrame(hello));
  await withTimeout(reader.read(), {
    timeoutMs: 5000,
    timeoutMessage: () => "Native host did not answer paired hello.",
  });

  const cli = runProcess(binaryPath, ["tab", "--json"], {
    env: e2ePlan.env,
    timeoutMs: 5000,
    label: "phase2 firefox-cli tab",
  });
  const request = await withTimeout(reader.read(), {
    timeoutMs: 5000,
    timeoutMessage: () => "Native host did not forward the CLI request to the extension.",
  });
  const parsedRequest = parseBoundaryRequest("host-to-extension", request);
  if (!parsedRequest.ok) {
    throw new Error(`Expected tabs.list request, received ${JSON.stringify(request)}`);
  }

  nativeHost.child.stdin.write(
    encodeNativeMessageFrame(
      createOkResponse(parsedRequest.value, {
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

  const { stdout } = await cli;
  const parsed = parseJsonWithSchema(stdout, "phase2 tab output", "phase2 firefox-cli tab stdout", z.object({ tabs: z.array(z.unknown()).optional() }).loose());
  if (!Array.isArray(parsed.tabs) || parsed.tabs.length !== 1) {
    throw new Error(`Unexpected tab output: ${stdout}`);
  }

  console.log("Phase 2 E2E smoke passed.");
} finally {
  nativeHost.child.stdin?.end();
  await nativeHost.stop();
  const stderr = nativeHost.stderr().trim();
  if (stderr.length > 0) {
    console.error(stderr);
  }
}

async function waitForEndpoint(endpoint: LocalIpcEndpoint): Promise<void> {
  if (endpoint.kind === "windows-named-pipe") {
    await sleep(100);
    return;
  }

  await pollUntil(
    async () => {
      try {
        await access(endpoint.path);
        return true;
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 5000,
      intervalMs: 25,
      timeoutMessage: () => `IPC endpoint did not appear: ${endpoint.path}`,
    },
  );
}
