import { open as openFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  type UploadParams,
} from "@firefox-cli/protocol";
import {
  optionalStringOption,
  optionalTarget,
  parseElementTarget,
  parsePositionalsAndOptions,
  parseTargetOptions,
} from "./parse.js";
import {
  CliUsageError,
  type CliDependencies,
  type UploadBudget,
  type UploadReadLimits,
} from "./types.js";

export type ParsedUploadArguments = {
  readonly elementTarget: string;
  readonly paths: readonly string[];
  readonly optionArgs: readonly string[];
};

type UploadFilePlan = {
  readonly inputPath: string;
  readonly absolutePath: string;
  readonly size: number;
};

export function parseUploadArguments(args: readonly string[]): ParsedUploadArguments {
  const parsed = parsePositionalsAndOptions(args, { preserveUnknownOptions: true });
  const [elementTarget, ...paths] = parsed.positionals;
  if (elementTarget === undefined || paths.length === 0) {
    throw new CliUsageError("Missing upload selector/ref or file path.");
  }
  if (paths.length > MAX_UPLOAD_FILES) {
    throw new CliUsageError(`Upload accepts at most ${MAX_UPLOAD_FILES} files.`);
  }

  return {
    elementTarget,
    paths,
    optionArgs: parsed.optionArgs,
  };
}

export async function createUploadParams(
  parsed: ParsedUploadArguments,
  dependencies: CliDependencies,
  uploadBudget: UploadBudget,
): Promise<UploadParams> {
  const files = await readUploadFiles(parsed.paths, dependencies, uploadBudget);
  return {
    ...parseElementTarget(parsed.elementTarget),
    files,
    ...optionalStringOption(parsed.optionArgs, ["--generation"], "generationId"),
    ...optionalTarget(parseTargetOptions(parsed.optionArgs)),
  };
}

export function createUploadBudget(): UploadBudget {
  return { bytes: 0 };
}

async function readUploadFiles(
  paths: readonly string[],
  dependencies: CliDependencies,
  uploadBudget: UploadBudget,
): Promise<UploadParams["files"]> {
  const plans = await statUploadFiles(paths, dependencies);
  assertUploadPlanBudget(plans, uploadBudget.bytes);

  const files: UploadParams["files"] = [];
  for (const plan of plans) {
    const rawBytes = await readUploadFileBytes(plan, dependencies, {
      maxFileBytes: MAX_UPLOAD_FILE_BYTES,
      maxRemainingTotalBytes: MAX_UPLOAD_TOTAL_BYTES - uploadBudget.bytes,
    });
    if (rawBytes.byteLength > MAX_UPLOAD_FILE_BYTES) {
      throw uploadFileTooLarge(plan.inputPath, rawBytes.byteLength);
    }
    if (uploadBudget.bytes + rawBytes.byteLength > MAX_UPLOAD_TOTAL_BYTES) {
      throw uploadTotalTooLarge(uploadBudget.bytes + rawBytes.byteLength);
    }
    const bytes = Buffer.from(rawBytes);
    uploadBudget.bytes += bytes.byteLength;
    files.push({
      name: basename(plan.inputPath),
      dataBase64: bytes.toString("base64"),
    });
  }

  return files;
}

export async function statUploadFiles(
  paths: readonly string[],
  dependencies: CliDependencies,
): Promise<readonly UploadFilePlan[]> {
  if (paths.length > MAX_UPLOAD_FILES) {
    throw new CliUsageError(`Upload accepts at most ${MAX_UPLOAD_FILES} files.`);
  }

  return Promise.all(
    paths.map(async (inputPath) => {
      const absolutePath = resolve(dependencies.cwd ?? process.cwd(), inputPath);
      const fileStat = await statUploadPath(absolutePath, dependencies);
      if (!fileStat.isFile) {
        throw new CliUsageError(`Upload path is not a file: ${inputPath}`);
      }
      if (fileStat.size > MAX_UPLOAD_FILE_BYTES) {
        throw uploadFileTooLarge(inputPath, fileStat.size);
      }

      return {
        inputPath,
        absolutePath,
        size: fileStat.size,
      };
    }),
  );
}

function assertUploadPlanBudget(plans: readonly UploadFilePlan[], existingBytes: number): void {
  const plannedBytes = plans.reduce((total, plan) => total + plan.size, 0);
  const aggregateBytes = existingBytes + plannedBytes;
  if (aggregateBytes > MAX_UPLOAD_TOTAL_BYTES) {
    throw uploadTotalTooLarge(aggregateBytes);
  }
}

async function statUploadPath(
  absolutePath: string,
  dependencies: CliDependencies,
): Promise<{ readonly size: number; readonly isFile: boolean }> {
  if (dependencies.statUploadFile !== undefined) {
    return dependencies.statUploadFile(absolutePath);
  }

  const fileStat = await stat(absolutePath);
  return {
    size: fileStat.size,
    isFile: fileStat.isFile(),
  };
}

async function readUploadFileBytes(
  plan: UploadFilePlan,
  dependencies: CliDependencies,
  limits: UploadReadLimits,
): Promise<Uint8Array> {
  if (dependencies.readUploadFile !== undefined) {
    return dependencies.readUploadFile(plan.absolutePath, limits);
  }

  const handle = await openFile(plan.absolutePath, "r");
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of handle.createReadStream({ highWaterMark: 64 * 1024 })) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.byteLength;
      if (totalBytes > limits.maxFileBytes) {
        throw uploadFileTooLarge(plan.inputPath, totalBytes);
      }
      if (totalBytes > limits.maxRemainingTotalBytes) {
        throw uploadTotalTooLarge(
          MAX_UPLOAD_TOTAL_BYTES - limits.maxRemainingTotalBytes + totalBytes,
        );
      }
      chunks.push(bytes);
    }
  } finally {
    await handle.close();
  }

  return Buffer.concat(chunks, totalBytes);
}

export function uploadFileTooLarge(path: string, actualBytes: number): CliUsageError {
  return new CliUsageError(
    `Upload file exceeds ${MAX_UPLOAD_FILE_BYTES} byte per-file limit: ${path} (${actualBytes} bytes).`,
  );
}

export function uploadTotalTooLarge(actualBytes: number): CliUsageError {
  return new CliUsageError(
    `Upload files exceed ${MAX_UPLOAD_TOTAL_BYTES} byte total limit (${actualBytes} bytes).`,
  );
}
