import type { CliResult } from "./types.js";

export function ok(stdout: string): CliResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
  };
}

export function error(stderr: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr,
  };
}
