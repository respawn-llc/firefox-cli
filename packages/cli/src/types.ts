import type { CliRouteMetadata, CommandId, RequestEnvelope, ResponseEnvelope } from "@firefox-cli/protocol";

export type CliExitCode = 0 | 1;

export type CliResult = {
  readonly exitCode: CliExitCode;
  readonly stdout: string;
  readonly stderr: string;
};

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export class InvalidBatchArgvCommandError extends CliUsageError {
  constructor() {
    super("Invalid batch argv command.");
    this.name = "InvalidBatchArgvCommandError";
  }
}

export type CliDependencies = {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly homeDir: string;
  readonly appDataDir?: string;
  readonly packageRoot: string;
  readonly binaryPath?: string;
  readonly extensionPath?: string;
  readonly cwd?: string;
  sendRequest?(request: RequestEnvelope): Promise<unknown>;
  readStdin?(): Promise<string>;
  statUploadFile?(path: string): Promise<CliUploadFileStat>;
  readUploadFile?(path: string, limits: UploadReadLimits): Promise<Uint8Array>;
  clearPairState?(): Promise<void>;
};

export type CliUploadFileStat = {
  readonly size: number;
  readonly isFile: boolean;
};

export type UploadReadLimits = {
  readonly maxFileBytes: number;
  readonly maxRemainingTotalBytes: number;
};

export type UploadBudget = {
  bytes: number;
};

export type BuildRequestForArgv = (
  argv: readonly string[],
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
) => Promise<RequestEnvelope> | RequestEnvelope;

export type CliRequestBuildContext = {
  readonly uploadBudget: UploadBudget;
  readonly buildRequestForArgv: BuildRequestForArgv;
  readonly batchMode?: boolean;
};

export type CliRequestBuilder = (
  args: readonly string[],
  dependencies: CliDependencies,
  context: CliRequestBuildContext,
) => Promise<RequestEnvelope> | RequestEnvelope;

export type CliPayloadParserSpec = {
  readonly payloadStartPositionals: number;
  readonly minPositionals: number;
  readonly variadicAfterMin?: boolean;
};

export type CliRouteParserSpec = {
  readonly label: string;
  readonly flags: readonly string[];
  readonly valueOptions: readonly string[];
  readonly optionalValueOptions?: readonly string[];
  readonly payload?: CliPayloadParserSpec;
  readonly allowDashDashPayload?: boolean;
};

export type CliResponseFormatterKind =
  | "capabilities"
  | "tab-list"
  | "tab-target"
  | "tab-close"
  | "window-list"
  | "window-target"
  | "window-close"
  | "snapshot"
  | "ref"
  | "get"
  | "is"
  | "wait"
  | "eval"
  | "screenshot"
  | "find"
  | "frame"
  | "batch"
  | "action"
  | "json-object";

export type CliResponseFormatter<C extends CommandId = CommandId> = (
  response: ResponseEnvelope<C>,
  json: boolean,
) => CliResult;

export type CliRouteBinding<C extends CommandId = CommandId> = {
  readonly route: CliRouteMetadata;
  readonly command: C;
  readonly help: string;
  readonly parser: CliRouteParserSpec;
  readonly formatterKind: CliResponseFormatterKind;
  readonly formatter: CliResponseFormatter<C>;
  readonly buildRequest: CliRequestBuilder;
};
