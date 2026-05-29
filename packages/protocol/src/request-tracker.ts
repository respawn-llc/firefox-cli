export type PendingRequestKey<TCommand extends string> = {
  readonly id: string;
  readonly command: TCommand;
  readonly protocolVersion?: number;
};

type PendingRequestTimer = ReturnType<typeof setTimeout>;

export type PendingRequestTrackerOptions<TCommand extends string, TValue> = {
  readonly timeoutMs: number;
  onDuplicate(request: PendingRequestKey<TCommand>): TValue;
  onTimeout(request: PendingRequestKey<TCommand>): TValue;
  readonly setTimer?: (callback: () => void, delayMs: number) => PendingRequestTimer;
  readonly clearTimer?: (timer: PendingRequestTimer) => void;
};

export type PendingRequestRegistration<TValue> =
  | {
      readonly ok: true;
      readonly promise: Promise<TValue>;
    }
  | {
      readonly ok: false;
      readonly value: TValue;
    };

export type PendingRequestSettlement<TCommand extends string> =
  | {
      readonly ok: true;
      readonly command: TCommand;
    }
  | {
      readonly ok: false;
    };

type PendingRequestEntry<TCommand extends string, TValue> = {
  readonly request: PendingRequestKey<TCommand>;
  readonly resolve: (value: TValue) => void;
  timeout: PendingRequestTimer | undefined;
};

export class PendingRequestTracker<TCommand extends string, TValue> {
  readonly #pending = new Map<string, PendingRequestEntry<TCommand, TValue>>();
  readonly #timeoutMs: number;
  readonly #onDuplicate: PendingRequestTrackerOptions<TCommand, TValue>["onDuplicate"];
  readonly #onTimeout: PendingRequestTrackerOptions<TCommand, TValue>["onTimeout"];
  readonly #setTimer: NonNullable<PendingRequestTrackerOptions<TCommand, TValue>["setTimer"]>;
  readonly #clearTimer: NonNullable<PendingRequestTrackerOptions<TCommand, TValue>["clearTimer"]>;

  constructor(options: PendingRequestTrackerOptions<TCommand, TValue>) {
    this.#timeoutMs = options.timeoutMs;
    this.#onDuplicate = options.onDuplicate;
    this.#onTimeout = options.onTimeout;
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  get size(): number {
    return this.#pending.size;
  }

  track(request: PendingRequestKey<TCommand>): PendingRequestRegistration<TValue> {
    if (this.#pending.has(request.id)) {
      return {
        ok: false,
        value: this.#onDuplicate(request),
      };
    }

    let resolvePending: ((value: TValue) => void) | undefined;
    const promise = new Promise<TValue>((resolve) => {
      resolvePending = resolve;
    });
    const entry: PendingRequestEntry<TCommand, TValue> = {
      request,
      resolve: (value) => {
        resolvePending?.(value);
      },
      timeout: undefined,
    };
    this.#pending.set(request.id, entry);
    entry.timeout = this.#setTimer(() => {
      this.settle(request.id, this.#onTimeout(request));
    }, this.#timeoutMs);

    return { ok: true, promise };
  }

  getCommand(id: string): TCommand | undefined {
    return this.#pending.get(id)?.request.command;
  }

  settle(id: string, value: TValue): PendingRequestSettlement<TCommand> {
    const entry = this.#pending.get(id);
    if (entry === undefined) {
      return { ok: false };
    }

    this.#pending.delete(id);
    if (entry.timeout !== undefined) {
      this.#clearTimer(entry.timeout);
    }
    entry.resolve(value);

    return {
      ok: true,
      command: entry.request.command,
    };
  }

  cancel(id: string, value: TValue): PendingRequestSettlement<TCommand> {
    return this.settle(id, value);
  }

  drain(createValue: (request: PendingRequestKey<TCommand>) => TValue): number {
    const entries = [...this.#pending.values()];
    for (const entry of entries) {
      this.settle(entry.request.id, createValue(entry.request));
    }
    return entries.length;
  }
}
