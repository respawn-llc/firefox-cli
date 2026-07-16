import { createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { handleBrowserRequest } from "./browser-commands.js";
import { FakeBrowserAdapter, tabSummary, windowSnapshot } from "./browser-commands-test-utils.js";

describe("browser batch target defaults", () => {
  it("does not resolve an omitted default when every target-dependent step has an explicit target", async () => {
    const adapter = new FakeBrowserAdapter([
      windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)]),
      windowSnapshot(20, false, [tabSummary(201, 0, true, 20)]),
    ]);

    const response = await handleBrowserRequest(
      createRequest(
        "batch",
        {
          steps: [
            {
              command: "snapshot",
              params: { target: { tab: { kind: "id", id: 201 } }, interactiveOnly: true },
            },
            {
              command: "window.select",
              params: { target: { window: { kind: "id", id: 10 } } },
            },
          ],
        },
        "batch-step-targets-only",
      ),
      adapter,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        steps: [
          { index: 0, command: "snapshot", ok: true },
          { index: 1, command: "window.select", ok: true, result: { window: { id: 10 } } },
        ],
      },
    });
    expect(adapter.contentRequests).toEqual([{ tabId: 201, command: "snapshot" }]);
  });
});
