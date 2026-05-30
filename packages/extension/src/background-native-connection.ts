import { NATIVE_HOST_NAME } from "@firefox-cli/protocol";
import type { BackgroundRuntimeAdapter, NativePortLike } from "./background-controller-types.js";

export type NativeConnectionEvents = {
  onConnect(): void;
  onMessage(message: unknown): void;
  onDisconnect(message: string): void;
  onConnectError(message: string): void;
};

export class NativeConnectionManager {
  readonly #connectNative: BackgroundRuntimeAdapter["connectNative"];
  readonly #reconnectDelaysMs: readonly number[];
  readonly #scheduleTimer: (callback: () => void, delayMs: number) => void;
  readonly #events: NativeConnectionEvents;
  #port: NativePortLike | null = null;
  #connected = false;
  #reconnectAttempt = 0;
  #reconnectScheduled = false;
  #stopped = false;

  constructor(options: {
    readonly connectNative: BackgroundRuntimeAdapter["connectNative"];
    readonly reconnectDelaysMs: readonly number[];
    readonly scheduleTimer: (callback: () => void, delayMs: number) => void;
    readonly events: NativeConnectionEvents;
  }) {
    this.#connectNative = options.connectNative;
    this.#reconnectDelaysMs = options.reconnectDelaysMs;
    this.#scheduleTimer = options.scheduleTimer;
    this.#events = options.events;
  }

  get connected(): boolean {
    return this.#connected;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  start(): void {
    if (this.#stopped) {
      return;
    }
    this.#connect();
  }

  stop(): void {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#connected = false;
    this.#port = null;
    this.#reconnectScheduled = false;
  }

  postMessage(message: unknown): boolean {
    if (this.#port === null || !this.#connected) {
      return false;
    }
    try {
      this.#port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  #connect(): void {
    if (this.#stopped) {
      return;
    }
    try {
      const port = this.#connectNative(NATIVE_HOST_NAME);
      this.#port = port;
      this.#connected = true;
      this.#reconnectAttempt = 0;
      this.#reconnectScheduled = false;
      port.onMessage.addListener((message) => {
        if (!this.#stopped) {
          this.#events.onMessage(message);
        }
      });
      port.onDisconnect.addListener((error) => {
        if (this.#stopped) {
          return;
        }
        this.#connected = false;
        this.#port = null;
        this.#events.onDisconnect(error?.message ?? "Native host disconnected.");
        this.#scheduleReconnect();
      });
      this.#events.onConnect();
    } catch (error) {
      this.#connected = false;
      this.#port = null;
      this.#events.onConnectError(error instanceof Error ? error.message : String(error));
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectScheduled || this.#reconnectDelaysMs.length === 0) {
      return;
    }

    const delay =
      this.#reconnectDelaysMs[Math.min(this.#reconnectAttempt, this.#reconnectDelaysMs.length - 1)];
    this.#reconnectAttempt += 1;
    this.#reconnectScheduled = true;
    this.#scheduleTimer(() => {
      if (this.#stopped) {
        return;
      }
      this.#reconnectScheduled = false;
      this.#connect();
    }, delay ?? 0);
  }
}
