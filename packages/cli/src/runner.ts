import { gatedCapabilities, type RequestEnvelope } from "@firefox-cli/protocol";
import { doctor, setup } from "./commands/setup-doctor.js";
import { formatCliResponse } from "./format.js";
import { renderHelp, findCliRouteBindingForArgv } from "./route-registry.js";
import { error, ok } from "./result.js";
import { formatProtocolError, sendOrUnavailable } from "./transport.js";
import {
  InvalidBatchArgvCommandError,
  CliUsageError,
  type CliDependencies,
  type CliRequestBuildContext,
  type CliResult,
} from "./types.js";
import { createUploadBudget } from "./upload.js";

const gatedCliCommands = new Map(
  gatedCapabilities.flatMap((capability) =>
    (capability.cliCommands ?? []).map((command) => [command, capability] as const),
  ),
);
const gatedCapabilitiesByCommand = new Map(
  gatedCapabilities.map((capability) => [capability.command, capability] as const),
);

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  try {
    return await runCliOrThrow(args, dependencies);
  } catch (error) {
    if (error instanceof CliUsageError) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${error.message}\n`,
      };
    }

    throw error;
  }
}

async function runCliOrThrow(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  if (args.includes("--version") || args.includes("-V")) {
    return ok(`${dependencies.version}\n`);
  }

  if (args[0] === "setup") {
    return setup(args.slice(1), dependencies, renderHelp);
  }

  if (args[0] === "doctor") {
    return doctor(args.slice(1), dependencies);
  }

  if (args[0] === "unpair") {
    await dependencies.clearPairState?.();
    return ok("Pair state cleared. Approve firefox-cli again from the extension popup.\n");
  }

  const routeBinding = findCliRouteBindingForArgv(args);
  if (routeBinding !== undefined) {
    return runCliRouteBinding(args, dependencies);
  }

  const gated = args[0] === undefined ? undefined : gatedCliCommands.get(args[0]);
  if (gated !== undefined) {
    return error(formatGatedCapability(gated.command));
  }

  return {
    exitCode: args.length === 0 ? 0 : 1,
    stdout: renderHelp(),
    stderr: "",
  };
}

async function runCliRouteBinding(
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> {
  const context: CliRequestBuildContext = {
    uploadBudget: createUploadBudget(),
    buildRequestForArgv,
  };
  const request = await buildRequestForArgv(argv, dependencies, context);
  const response = await sendOrUnavailable(dependencies, request);
  return formatCliResponse(request.command, response, argv);
}

async function buildRequestForArgv(
  argv: readonly string[],
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
): Promise<RequestEnvelope> {
  const binding = findCliRouteBindingForArgv(argv);
  if (binding === undefined) {
    throw new InvalidBatchArgvCommandError();
  }

  if (context.batchMode === true && !binding.route.batch) {
    throw new InvalidBatchArgvCommandError();
  }

  return binding.buildRequest(argv, dependencies, context);
}

function formatGatedCapability(command: string): string {
  const capability = gatedCapabilitiesByCommand.get(command);
  return formatProtocolError({
    code: "UNSUPPORTED_CAPABILITY",
    message: capability?.reason ?? `${command} is not supported by firefox-cli.`,
  });
}
