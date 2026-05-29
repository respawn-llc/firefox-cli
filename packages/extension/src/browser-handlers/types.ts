import type { CommandId, RequestEnvelope, ResponseEnvelope } from "@firefox-cli/protocol";
import type { ExecuteBatchStep } from "../browser-command/batch.js";
import type { BackgroundBrowserAdapter } from "../browser-command/types.js";

export type BrowserHandlerContext = {
  readonly executeStep: ExecuteBatchStep;
};

export type BrowserCommandHandler<C extends CommandId = CommandId> = (
  request: RequestEnvelope<C>,
  adapter: BackgroundBrowserAdapter,
  context: BrowserHandlerContext,
) => Promise<ResponseEnvelope<C> | ResponseEnvelope>;

export type BrowserHandlerMap = Partial<{
  readonly [C in CommandId]: BrowserCommandHandler<C>;
}>;
