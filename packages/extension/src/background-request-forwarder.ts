import type { ProtocolSession, RequestEnvelope, ResponseEnvelope } from "@firefox-cli/protocol";
import type { BackgroundBrowserAdapter } from "./browser-commands.js";
import { handleRequest } from "./background-request-handler.js";

export class BackgroundRequestForwarder {
  readonly #browserAdapter: BackgroundBrowserAdapter;
  readonly #productVersion: string;
  readonly #intercept: ((request: RequestEnvelope, approved: boolean) => Promise<ResponseEnvelope> | ResponseEnvelope | undefined) | undefined;

  constructor(options: {
    readonly browserAdapter: BackgroundBrowserAdapter;
    readonly productVersion: string;
    readonly intercept?: (request: RequestEnvelope, approved: boolean) => Promise<ResponseEnvelope> | ResponseEnvelope | undefined;
  }) {
    this.#browserAdapter = options.browserAdapter;
    this.#productVersion = options.productVersion;
    this.#intercept = options.intercept;
  }

  forward(request: RequestEnvelope, approved: boolean, protocolSession: ProtocolSession): Promise<ResponseEnvelope> | ResponseEnvelope {
    const intercepted = this.#intercept?.(request, approved);
    if (intercepted !== undefined) {
      return intercepted;
    }
    return handleRequest({
      request,
      productVersion: this.#productVersion,
      approved,
      browserAdapter: this.#browserAdapter,
      protocolSession,
    });
  }
}
