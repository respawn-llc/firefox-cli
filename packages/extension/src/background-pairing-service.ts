import type { ResponseEnvelope } from "@firefox-cli/protocol";
import type { BackgroundStorageAdapter } from "./background-controller-types.js";

type HelloPairing = Extract<ResponseEnvelope<"hello">, { readonly ok: true }>["result"]["pairing"];

export class PairingStateService {
  readonly #storageAdapter: BackgroundStorageAdapter;
  #pairToken: string | null = null;
  #approved = false;
  #revision = 0;
  #latestHelloRequestId: string | undefined;

  constructor(storageAdapter: BackgroundStorageAdapter) {
    this.#storageAdapter = storageAdapter;
  }

  get approved(): boolean {
    return this.#approved;
  }

  get pairToken(): string | null {
    return this.#pairToken;
  }

  beginMutation(): void {
    this.#revision += 1;
  }

  async loadStoredPairToken(): Promise<{
    readonly applied: boolean;
    readonly pairToken: string | null;
  }> {
    const revision = this.#revision;
    const pairToken = await this.#storageAdapter.getPairToken();
    if (this.#revision !== revision) {
      return { applied: false, pairToken };
    }
    this.#pairToken = pairToken;
    this.#approved = pairToken !== null;
    return { applied: true, pairToken };
  }

  async approve(pairToken: string): Promise<void> {
    await this.#storageAdapter.setPairToken(pairToken);
    this.#pairToken = pairToken;
    this.#approved = true;
  }

  markRejected(): void {
    this.#approved = false;
  }

  async reset(): Promise<void> {
    this.#pairToken = null;
    this.#approved = false;
    await this.#storageAdapter.setPairToken(null);
  }

  recordHello(requestId: string): void {
    this.#latestHelloRequestId = requestId;
  }

  // On startup the first hello can leave before the stored pair token loads, and the bridge sends another hello
  // with the token once it loads. Only the latest hello reports the pair state of the token the bridge holds.
  async applyHelloPairing(requestId: string, pairing: HelloPairing): Promise<string | undefined> {
    if (pairing === undefined || requestId !== this.#latestHelloRequestId) {
      return undefined;
    }
    this.#approved = pairing.approved;
    if (!pairing.approved && pairing.status !== "invalid-pair-state" && this.#pairToken !== null) {
      this.#pairToken = null;
      await this.#storageAdapter.setPairToken(null);
    }
    return !pairing.approved && pairing.status === "invalid-pair-state" ? (pairing.message ?? "Native host pair state is invalid.") : undefined;
  }
}
