import rootPackage from "../../../package.json" with { type: "json" };
import { detectNativeHostLaunch, startNativeHostSession } from "@firefox-cli/native-host";
import { createDefaultDependencies, getDefaultStateRoot, runCli } from "./index.js";

const args = process.argv.slice(2);
const launch = detectNativeHostLaunch(args);

if (launch.kind === "native-host") {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const session = await startNativeHostSession({
    input: process.stdin,
    output: process.stdout,
    stateRoot: getDefaultStateRoot(process.platform, homeDir, process.env.APPDATA),
    platform: process.platform,
    productVersion: rootPackage.version,
    extensionId: launch.extensionId,
    homeDir,
    ...(process.env.APPDATA === undefined ? {} : { appDataDir: process.env.APPDATA }),
  });
  await session.closed;
  process.exit(0);
}

if (launch.kind === "invalid-native-host") {
  process.stderr.write(`${launch.code}: ${launch.message}\n`);
  process.exit(1);
}

const result = await runCli(args, createDefaultDependencies(rootPackage.version));

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}

if (result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}

process.exit(result.exitCode);
