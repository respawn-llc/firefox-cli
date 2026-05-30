export function parseDisposableFirefoxProcessIds(
  psOutput: string,
  options: {
    readonly profileDir: string;
    readonly currentPid?: number;
  },
): number[] {
  const currentPid = options.currentPid ?? process.pid;
  return parseProcessRows(psOutput)
    .filter((row) => {
      return (
        commandLineUsesProfileDir(row.args, options.profileDir) &&
        isFirefoxExecutableCommand(row.command)
      );
    })
    .map((row) => row.pid)
    .filter((pid) => pid !== currentPid);
}

export function isFirefoxExecutableCommand(command: string): boolean {
  const basename = executableBasename(command).toLowerCase();
  return basename === "firefox" || basename === "firefox-bin" || basename === "firefox-esr";
}

function parseProcessRows(
  psOutput: string,
): readonly { readonly pid: number; readonly command: string; readonly args: string }[] {
  return psOutput
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\S+)(?:\s+(.*))?$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      command: match[2] ?? "",
      args: match[3] ?? "",
    }))
    .filter((row) => Number.isInteger(row.pid) && row.pid > 0);
}

function commandLineUsesProfileDir(commandLine: string, profileDir: string): boolean {
  const escapedProfileDir = escapeRegExp(profileDir);
  return new RegExp(
    `(?:^|\\s)(?:--profile|-profile)(?:=${escapedProfileDir}|\\s+${escapedProfileDir})(?:\\s|$)`,
    "u",
  ).test(commandLine);
}

function executableBasename(command: string): string {
  const executable = command.trim().split(/\s+/u)[0] ?? command;
  return executable.split(/[\\/]/u).at(-1) ?? executable;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
