import { describe, expect, it } from "vitest";
import { FakeBrowserAdapter, tabSummary, windowSnapshot } from "../browser-commands-test-utils.js";
import { createBrowserTargetContext } from "./target-context.js";

describe("browser target context", () => {
  it("reuses one ordered window snapshot for repeated request-scoped resolutions", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);
    const context = createBrowserTargetContext(adapter);

    await expect(context.getWindows()).resolves.toHaveLength(1);
    await expect(context.resolveTarget({ tab: { kind: "id", id: 102 } })).resolves.toMatchObject({
      tab: { id: 102 },
    });
    await expect(context.resolveWindow({ kind: "active" })).resolves.toMatchObject({ id: 10 });

    expect(adapter.listWindowCalls).toBe(1);
  });

  it("requires explicit invalidation before observing post-mutation target state", async () => {
    const adapter = new FakeBrowserAdapter([windowSnapshot(10, true, [tabSummary(101, 0, true, 10), tabSummary(102, 1, false, 10)])]);
    const context = createBrowserTargetContext(adapter);

    await expect(context.resolveTarget({ tab: { kind: "active" } })).resolves.toMatchObject({ tab: { id: 101 } });
    await adapter.selectTab(102);
    await expect(context.resolveTarget({ tab: { kind: "active" } })).resolves.toMatchObject({ tab: { id: 101 } });

    context.invalidate();

    await expect(context.resolveTarget({ tab: { kind: "active" } })).resolves.toMatchObject({ tab: { id: 102 } });
    expect(adapter.listWindowCalls).toBe(2);
  });
});
