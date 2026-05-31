import { createRequest, type RequestEnvelope } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { createUploadBudget } from "../upload.js";
import { buildBatchRequest } from "./batch.js";
import { InvalidBatchArgvCommandError, type CliDependencies, type CliRequestBuildContext } from "../types.js";

const dependencies: CliDependencies = {
  version: "0.0.0-test",
  platform: "darwin",
  arch: "arm64",
  homeDir: "/tmp/firefox-cli-test-home",
  packageRoot: "/tmp/firefox-cli-test-package",
};

describe("buildBatchRequest", () => {
  it("builds argv steps through injected request building", async () => {
    const request = await buildBatchRequest(["batch", JSON.stringify([["tab"]])], dependencies, {
      uploadBudget: createUploadBudget(),
      buildRequestForArgv: (argv) => {
        expect(argv).toEqual(["tab"]);
        return createRequest("tabs.list", {});
      },
    });

    expect(request.command).toBe("batch");
    expect(request.params).toMatchObject({
      steps: [
        {
          command: "tabs.list",
          params: {},
        },
      ],
    });
  });

  it("maps injected invalid argv commands to batch step errors", async () => {
    const context: CliRequestBuildContext = {
      uploadBudget: createUploadBudget(),
      buildRequestForArgv: (): RequestEnvelope => {
        throw new InvalidBatchArgvCommandError();
      },
    };

    await expect(
      buildBatchRequest(["batch", JSON.stringify([["setup"]])], dependencies, context),
    ).rejects.toThrow("Invalid batch argv command at step 0.");
  });
});
