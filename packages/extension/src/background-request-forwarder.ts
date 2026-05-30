import type { ProtocolSession, RequestEnvelope, ResponseEnvelope } from "@firefox-cli/protocol";
import type { BackgroundBrowserAdapter } from "./browser-commands.js";
import { handleRequest } from "./background-request-handler.js";

export class BackgroundRequestForwarder {
  readonly #browserAdapter: BackgroundBrowserAdapter;
  readonly #productVersion: string;

  constructor(options: {
    readonly browserAdapter: BackgroundBrowserAdapter;
    readonly productVersion: string;
  }) {
    this.#browserAdapter = options.browserAdapter;
    this.#productVersion = options.productVersion;
  }

  forward(
    request: RequestEnvelope,
    approved: boolean,
    protocolSession: ProtocolSession,
  ): Promise<ResponseEnvelope> | ResponseEnvelope {
    return handleRequest(
      request,
      this.#productVersion,
      approved,
      this.#browserAdapter,
      protocolSession,
    );
  }
}
