export function parseDisposableFirefoxProcessIds(
  psOutput: string,
  options: {
    readonly profileDir: string;
    readonly currentPid?: number;
  },
): number[] {
  const currentPid = options.currentPid ?? process.pid;
  return parseDisposableFirefoxProcesses(psOutput, options)
    .map((row) => row.pid)
    .filter((pid) => pid !== currentPid);
}

export type DisposableFirefoxProcess = {
  readonly pid: number;
  readonly command: string;
  readonly args: string;
};

export function parseDisposableFirefoxProcesses(
  psOutput: string,
  options: {
    readonly profileDir: string;
  },
): readonly DisposableFirefoxProcess[] {
  return parseProcessRows(psOutput).filter((row) => {
    return (
      commandLineUsesProfileDir(row.args, options.profileDir) &&
      isFirefoxExecutableCommand(row.command)
    );
  });
}

export function isFirefoxExecutableCommand(command: string): boolean {
  const basename = executableBasename(command)
    .toLowerCase()
    .replace(/\.exe$/u, "");
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

export function commandLineUsesProfileDir(commandLine: string, profileDir: string): boolean {
  const tokens = tokenizeCommandLine(commandLine);
  return tokens.some((token, index) => {
    if (token === "--profile" || token === "-profile") {
      return tokens[index + 1] === profileDir;
    }
    if (token.startsWith("--profile=")) {
      return token.slice("--profile=".length) === profileDir;
    }
    if (token.startsWith("-profile=")) {
      return token.slice("-profile=".length) === profileDir;
    }
    return false;
  });
}

function executableBasename(command: string): string {
  const executable = command.trim().split(/\s+/u)[0] ?? command;
  return executable.split(/[\\/]/u).at(-1) ?? executable;
}

function tokenizeCommandLine(commandLine: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index];
    if (char === undefined) {
      continue;
    }
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      const next = commandLine[index + 1];
      if (
        next !== undefined &&
        (/\s/u.test(next) || next === "\\" || next === "'" || next === '"')
      ) {
        escaping = true;
      } else {
        current += char;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) {
    current += "\\";
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
