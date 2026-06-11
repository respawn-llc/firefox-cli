import { createErrorResponseForRequest, createOkResponse, createRequest } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { cliResponseFormatters, formatCliResponse } from "./format.js";

describe("CLI response formatting", () => {
  it("formats tab lists as text or JSON at the CLI edge", () => {
    const result = {
      tabs: [
        {
          id: 42,
          index: 0,
          windowId: 7,
          active: true,
          title: "Example",
          url: "https://example.test/",
        },
      ],
    };
    const response = createOkResponse(createRequest("tabs.list", {}, "tabs"), result);

    expect(formatCliResponse(cliResponseFormatters["tab-list"], response, false)).toEqual({
      exitCode: 0,
      stdout: "* w7 t42 [0] Example https://example.test/\n",
      stderr: "",
    });
    expect(formatCliResponse(cliResponseFormatters["tab-list"], response, true)).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify(result, null, 2)}\n`,
      stderr: "",
    });
  });

  it("maps protocol errors through the shared formatter", () => {
    const request = createRequest("tabs.list", {}, "tabs");
    const response = createErrorResponseForRequest(request, {
      code: "NATIVE_HOST_UNAVAILABLE",
      message: "Native host is offline.",
    });

    expect(formatCliResponse(cliResponseFormatters["tab-list"], response, false)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "Native host unavailable: Native host is offline. Open Firefox, run `firefox-cli setup` if setup is incomplete, then run `firefox-cli connect`.\n",
    });
  });
});
