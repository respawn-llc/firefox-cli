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

export interface DisposableFirefoxProcess {
  readonly pid: number;
  readonly command: string;
  readonly args: string;
}

export function parseDisposableFirefoxProcesses(
  psOutput: string,
  options: {
    readonly profileDir: string;
  },
): readonly DisposableFirefoxProcess[] {
  return parseProcessRows(psOutput).filter((row) => {
    return commandLineUsesProfileDir(row.args, options.profileDir) && isFirefoxExecutableCommand(row.command);
  });
}

export function isFirefoxExecutableCommand(command: string): boolean {
  const basename = executableBasename(command)
    .toLowerCase()
    .replace(/\.exe$/u, "");
  return basename === "firefox" || basename === "firefox-bin" || basename === "firefox-esr";
}

function parseProcessRows(psOutput: string): readonly { readonly pid: number; readonly command: string; readonly args: string }[] {
  return psOutput
    .split("\n")
    .map((line) => /^(\d+)\s+(\S+)(?:\s+(.*))?$/u.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
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
  const state: CommandLineTokenState = {
    tokens: [],
    current: "",
    quote: undefined,
    escaping: false,
  };

  for (let index = 0; index < commandLine.length; index += 1) {
    appendCommandLineCharacter(state, commandLine[index], commandLine[index + 1]);
  }

  if (state.escaping) {
    state.current += "\\";
  }
  if (state.current.length > 0) {
    state.tokens.push(state.current);
  }

  return state.tokens;
}

interface CommandLineTokenState {
  readonly tokens: string[];
  current: string;
  quote: "'" | '"' | undefined;
  escaping: boolean;
}

function appendCommandLineCharacter(state: CommandLineTokenState, char: string | undefined, next: string | undefined): void {
  if (char === undefined) {
    return;
  }
  if (state.escaping) {
    state.current += char;
    state.escaping = false;
    return;
  }
  if (char === "\\") {
    appendCommandLineBackslash(state, next);
    return;
  }
  if (state.quote !== undefined) {
    appendQuotedCommandLineCharacter(state, char);
    return;
  }
  if (char === "'" || char === '"') {
    state.quote = char;
    return;
  }
  if (/\s/u.test(char)) {
    flushCommandLineToken(state);
    return;
  }
  state.current += char;
}

function appendCommandLineBackslash(state: CommandLineTokenState, next: string | undefined): void {
  if (next !== undefined && (/\s/u.test(next) || next === "\\" || next === "'" || next === '"')) {
    state.escaping = true;
    return;
  }
  state.current += "\\";
}

function appendQuotedCommandLineCharacter(state: CommandLineTokenState, char: string): void {
  if (char === state.quote) {
    state.quote = undefined;
    return;
  }
  state.current += char;
}

function flushCommandLineToken(state: CommandLineTokenState): void {
  if (state.current.length === 0) {
    return;
  }
  state.tokens.push(state.current);
  state.current = "";
}
