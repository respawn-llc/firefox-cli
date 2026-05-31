import { createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import {
  type ContentScriptDeliveryError,
  deliverContentScriptRequest,
} from "./content-script-delivery.js";

describe("content script delivery", () => {
  it("injects and retries only when the content script is not loaded", async () => {
    const events: string[] = [];
    let sends = 0;
    const request = createRequest("snapshot", {}, "snapshot-1");

    const response = await deliverContentScriptRequest(
      {
        sendMessage: async () => {
          sends += 1;
          events.push(`send:${sends}`);
          if (sends === 1) {
            throw new Error("Could not establish connection. Receiving end does not exist.");
          }
          return { ok: true };
        },
        injectContentScript: async () => {
          events.push("inject");
        },
      },
      101,
      request,
    );

    expect(response).toEqual({ ok: true });
    expect(events).toEqual(["send:1", "inject", "send:2"]);
  });

  it("rejects restricted pages without injecting", async () => {
    const events: string[] = [];
    const request = createRequest("snapshot", {}, "snapshot-1");

    await expect(
      deliverContentScriptRequest(
        {
          sendMessage: async () => {
            events.push("send");
            throw new Error("Cannot access a restricted Firefox page");
          },
          injectContentScript: async () => {
            events.push("inject");
          },
        },
        101,
        request,
      ),
    ).rejects.toMatchObject({
      deliveryCause: "restricted-page",
      stage: "send",
      retried: false,
    } satisfies Partial<ContentScriptDeliveryError>);
    expect(events).toEqual(["send"]);
  });
});
