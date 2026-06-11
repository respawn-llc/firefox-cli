import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  commandSchemas,
  type CommandId,
  type ContentCommandId,
  type GetParams,
  type RequestEnvelope,
  type ResponseEnvelope,
  type safeParseBatchStepCommandParams,
  type safeParseCommandResult,
  type safeParseStrictCommandParams,
  type ScreenshotResult,
} from "../index.js";
import { assembleCommandRegistry, defineCommandEntries } from "./define.js";

const expectedCommandIds = [
  "hello",
  "capabilities",
  "noop",
  "tabs.list",
  "tab.new",
  "tab.select",
  "tab.close",
  "windows.list",
  "window.new",
  "window.select",
  "window.close",
  "open",
  "back",
  "forward",
  "reload",
  "snapshot",
  "ref.resolve",
  "get",
  "is",
  "wait",
  "eval",
  "screenshot",
  "drag",
  "upload",
  "mouse",
  "keydown",
  "keyup",
  "find",
  "frame",
  "download",
  "dialog",
  "clipboard",
  "cookies",
  "storage",
  "network",
  "console",
  "errors",
  "highlight",
  "notify",
  "pdf",
  "set.viewport",
  "diff",
  "batch",
  "click",
  "dblclick",
  "focus",
  "hover",
  "fill",
  "type",
  "press",
  "keyboard.type",
  "keyboard.inserttext",
  "check",
  "uncheck",
  "select",
  "scroll",
  "scrollintoview",
  "swipe",
  "pair.approve",
  "pair.reset",
  "pair.requestApproval",
  "pair.openApproval",
] as const satisfies readonly CommandId[];

type Assert<T extends true> = T;
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type SuccessfulResult<C extends CommandId> = Extract<ResponseEnvelope<C>, { readonly ok: true }>["result"];
type SuccessfulSafeParseData<T> = Extract<T, { readonly success: true }> extends { readonly data: infer Data } ? Data : never;
type ProtocolTypeAssertions = [
  Assert<string extends CommandId ? false : true>,
  Assert<"noop" extends ContentCommandId ? false : true>,
  Assert<IsExact<RequestEnvelope<"get">["params"], GetParams>>,
  Assert<IsExact<SuccessfulResult<"screenshot">, ScreenshotResult>>,
  Assert<IsExact<SuccessfulSafeParseData<ReturnType<typeof safeParseStrictCommandParams<"get">>>, GetParams>>,
  Assert<IsExact<SuccessfulSafeParseData<ReturnType<typeof safeParseBatchStepCommandParams<"tab.close">>>, RequestEnvelope<"tab.close">["params"]>>,
  Assert<IsExact<SuccessfulSafeParseData<ReturnType<typeof safeParseCommandResult<"screenshot">>>, ScreenshotResult>>,
];

describe("command registry assembly", () => {
  it("keeps the exact command id snapshot", () => {
    expect(Object.keys(commandSchemas)).toEqual([...expectedCommandIds]);
  });

  it("rejects duplicate command ids", () => {
    const duplicate = defineCommandEntries({
      duplicate: {
        params: z.object({}).strict(),
        result: z.object({ ok: z.literal(true) }).strict(),
        status: "mvp",
        owner: "extension",
        target: "none",
        content: "never",
        action: false,
        timeout: "none",
        batch: { allowed: false },
        cliRoutes: [],
      },
    });

    expect(() => assembleCommandRegistry(duplicate, duplicate)).toThrow("Duplicate command id: duplicate");
  });

  it("preserves command-specific public protocol types", () => {
    const assertions: ProtocolTypeAssertions = [true, true, true, true, true, true, true];

    expect(assertions).toEqual([true, true, true, true, true, true, true]);
  });
});
