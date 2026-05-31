import { describe, expect, it } from "vitest";
import { parsePayloadPositionalsAndOptions, parsePositionalsAndOptions } from "./parse.js";

describe("CLI argument parsing helpers", () => {
  it("keeps recognized options out of normal positionals", () => {
    expect(
      parsePositionalsAndOptions([
        "--window",
        "1",
        "--tab",
        "2",
        "--json",
        "--screenshot-format",
        "jpeg",
        "selector",
        "--unknown",
      ]),
    ).toEqual({
      positionals: ["selector"],
      optionArgs: ["--window", "1", "--tab", "2", "--json", "--screenshot-format", "jpeg"],
    });
  });

  it("can preserve unknown option-like payloads for command builders that own validation", () => {
    expect(parsePositionalsAndOptions(["--unknown", "payload"], { preserveUnknownOptions: true })).toEqual({
      positionals: ["--unknown", "payload"],
      optionArgs: [],
    });
  });

  it("switches option-like values into payload positionals after the command payload starts", () => {
    expect(
      parsePayloadPositionalsAndOptions(
        ["--timeout", "1000", "--json", "console.log('--literal')", "--max-output", "10"],
        {
          payloadStartPositionals: 1,
          minPositionals: 1,
          variadicAfterMin: true,
        },
      ),
    ).toEqual({
      positionals: ["console.log('--literal')", "--max-output", "10"],
      optionArgs: ["--timeout", "1000", "--json"],
    });
  });
});
