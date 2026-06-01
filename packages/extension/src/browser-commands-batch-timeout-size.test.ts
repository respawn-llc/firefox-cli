import { MAX_BATCH_RESULT_BYTES, createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import { FakeBrowserAdapter, ONE_BY_ONE_PNG_BASE64, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";

describe("browser batch command handling", () => {
  it("applies remaining outer timeout to timeout-aware steps", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          timeoutMs: 10,
          steps: [{ command: "wait", params: { kind: "url", urlGlob: "https://never.test/*" } }],
        },
        "batch-timeout",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: false,
        firstFailedIndex: 0,
        steps: [{ index: 0, command: "wait", ok: false, error: { code: "TIMEOUT" } }],
      },
    });
  });

  it("applies remaining outer timeout to duration waits", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          timeoutMs: 50,
          steps: [{ command: "wait", params: { kind: "ms", durationMs: 100 } }],
        },
        "batch-duration-timeout",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: false,
        firstFailedIndex: 0,
        steps: [{ index: 0, command: "wait", ok: false, error: { code: "TIMEOUT" } }],
      },
    });
  });

  it("enforces batch public-result size limits", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          maxResultBytes: 1,
          steps: [{ command: "snapshot", params: {} }],
        },
        "batch-large",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "RESULT_TOO_LARGE",
      },
    });
  });

  it("returns screenshot step bytes internally while sizing the public batch result", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10)])]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          maxResultBytes: MAX_BATCH_RESULT_BYTES,
          steps: [{ command: "screenshot", params: { path: "/tmp/page.png", format: "png" } }],
        },
        "batch-screenshot",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        steps: [
          {
            index: 0,
            command: "screenshot",
            ok: true,
            result: {
              bytes: 68,
              imageBase64: ONE_BY_ONE_PNG_BASE64,
            },
          },
        ],
      },
    });
  });
});
