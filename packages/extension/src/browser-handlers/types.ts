import type { CommandHandlerMap, CommandId, RequestEnvelope, ResponseEnvelope } from "@firefox-cli/protocol";
import type { ExecuteBatchStep } from "../browser-command/batch.js";
import type { BrowserTargetContext } from "../browser-command/target-context.js";
import type { BackgroundBrowserAdapter } from "../browser-command/types.js";

export type BrowserHandlerContext = {
  readonly executeStep: ExecuteBatchStep;
  readonly targetContext: BrowserTargetContext;
};

export type BrowserCommandHandler<C extends CommandId = CommandId> = (
  request: RequestEnvelope<C>,
  adapter: BackgroundBrowserAdapter,
  context: BrowserHandlerContext,
) => Promise<ResponseEnvelope<C>> | ResponseEnvelope<C>;

export type BrowserHandlerMap<C extends CommandId> = CommandHandlerMap<
  C,
  [BackgroundBrowserAdapter, BrowserHandlerContext]
>;
