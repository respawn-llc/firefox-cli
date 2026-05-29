export function parseDisposableFirefoxProcessIds(
  psOutput: string,
  options: {
    readonly profileDir: string;
    readonly currentPid?: number;
  },
): number[] {
  const currentPid = options.currentPid ?? process.pid;
  return psOutput
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .filter((match) => {
      const command = match[2] ?? "";
      return command.includes(options.profileDir) && isFirefoxExecutableCommand(command);
    })
    .map((match) => Number(match[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== currentPid);
}

export function isFirefoxExecutableCommand(command: string): boolean {
  return /(?:^|\/)(?:firefox|firefox-bin|firefox-esr)(?:\s|$)/iu.test(command);
}
