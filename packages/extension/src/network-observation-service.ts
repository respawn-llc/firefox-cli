import { getExtensionPermissionRequirements } from "@firefox-cli/protocol";
import {
  NetworkRequestTracker,
  type NetworkRequestEnd,
  type NetworkRequestStart,
} from "./network-tracker.js";

export type NetworkObservationWebRequestDetails = NetworkRequestStart &
  NetworkRequestEnd & {
    readonly url: string;
    readonly tabId?: number;
  };

export type NetworkObservationWebRequestEvent = {
  addListener(
    listener: (details: NetworkObservationWebRequestDetails) => void,
    filter: { readonly urls: readonly string[]; readonly tabId?: number },
  ): void;
  removeListener(listener: (details: NetworkObservationWebRequestDetails) => void): void;
};

export type NetworkObservationBrowserApi = {
  readonly webRequest?: {
    readonly onBeforeRequest?: NetworkObservationWebRequestEvent;
    readonly onCompleted?: NetworkObservationWebRequestEvent;
    readonly onErrorOccurred?: NetworkObservationWebRequestEvent;
  };
};

export type NetworkObservationServiceOptions = {
  readonly browser: NetworkObservationBrowserApi;
  readonly tracker?: NetworkRequestTracker;
  readonly retentionMs?: number;
  readonly scheduleTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer?: (timer: TimerHandle) => void;
};

type TimerHandle = unknown;

type TabObservation = {
  activeCount: number;
  registrations: {
    readonly event: NetworkObservationWebRequestEvent;
    readonly listener: (details: NetworkObservationWebRequestDetails) => void;
  }[];
  retentionTimer?: TimerHandle;
};

const DEFAULT_RETENTION_MS = 30_000;

export class NetworkObservationService {
  readonly tracker: NetworkRequestTracker;
  readonly #browser: NetworkObservationBrowserApi;
  readonly #retentionMs: number;
  readonly #scheduleTimer: (callback: () => void, delayMs: number) => TimerHandle;
  readonly #clearTimer: (timer: TimerHandle) => void;
  readonly #observedTabs = new Map<number, TabObservation>();

  constructor(options: NetworkObservationServiceOptions) {
    this.#browser = options.browser;
    this.tracker = options.tracker ?? new NetworkRequestTracker();
    this.#retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.#scheduleTimer = options.scheduleTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer =
      options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  async observeTab<T>(
    tabId: number,
    operation: (tracker: NetworkRequestTracker) => Promise<T> | T,
    options: { readonly retainWhenEmpty?: boolean } = {},
  ): Promise<T> {
    const observation = this.#ensureObserved(tabId);
    observation.activeCount += 1;
    this.#clearRetentionTimer(observation);

    try {
      return await operation(this.tracker);
    } finally {
      observation.activeCount = Math.max(0, observation.activeCount - 1);
      if (options.retainWhenEmpty === false && !this.tracker.hasTabState(tabId)) {
        this.#stopObserving(tabId);
      } else {
        this.#scheduleRetention(tabId);
      }
    }
  }

  pruneTab(tabId: number): void {
    this.tracker.pruneTab(tabId);
    this.#stopObserving(tabId);
  }

  dispose(): void {
    for (const tabId of [...this.#observedTabs.keys()]) {
      this.#stopObserving(tabId);
    }
  }

  observedTabIds(): readonly number[] {
    return [...this.#observedTabs.keys()].sort((left, right) => left - right);
  }

  #ensureObserved(tabId: number): TabObservation {
    const existing = this.#observedTabs.get(tabId);
    if (existing !== undefined) {
      return existing;
    }

    const observation: TabObservation = {
      activeCount: 0,
      registrations: [],
    };
    this.#observedTabs.set(tabId, observation);
    this.#addListener(tabId, this.#browser.webRequest?.onBeforeRequest, (details) => {
      const record = this.tracker.recordStart(details);
      if (record !== undefined) {
        this.#scheduleRetention(record.tabId);
      }
    });
    const markComplete = (details: NetworkObservationWebRequestDetails) => {
      const record = this.tracker.recordEnd(details);
      if (record !== undefined) {
        this.#scheduleRetention(record.tabId);
      }
    };
    this.#addListener(tabId, this.#browser.webRequest?.onCompleted, markComplete);
    this.#addListener(tabId, this.#browser.webRequest?.onErrorOccurred, markComplete);
    return observation;
  }

  #addListener(
    tabId: number,
    event: NetworkObservationWebRequestEvent | undefined,
    listener: (details: NetworkObservationWebRequestDetails) => void,
  ): void {
    const observation = this.#observedTabs.get(tabId);
    if (event === undefined || observation === undefined) {
      return;
    }

    event.addListener(listener, {
      urls: getExtensionPermissionRequirements().webRequestListenerOrigins,
      tabId,
    });
    observation.registrations.push({ event, listener });
  }

  #scheduleRetention(tabId: number): void {
    const observation = this.#observedTabs.get(tabId);
    if (observation === undefined || observation.activeCount > 0) {
      return;
    }

    this.#clearRetentionTimer(observation);
    observation.retentionTimer = this.#scheduleTimer(() => {
      const current = this.#observedTabs.get(tabId);
      if (current === undefined || current.activeCount > 0) {
        return;
      }
      if (this.tracker.hasActiveRequests(tabId)) {
        this.#scheduleRetention(tabId);
        return;
      }
      this.tracker.pruneTab(tabId);
      this.#stopObserving(tabId);
    }, this.#retentionMs);
  }

  #clearRetentionTimer(observation: TabObservation): void {
    if (observation.retentionTimer === undefined) {
      return;
    }
    this.#clearTimer(observation.retentionTimer);
    delete observation.retentionTimer;
  }

  #stopObserving(tabId: number): void {
    const observation = this.#observedTabs.get(tabId);
    if (observation === undefined) {
      return;
    }

    this.#clearRetentionTimer(observation);
    for (const registration of observation.registrations) {
      registration.event.removeListener(registration.listener);
    }
    this.#observedTabs.delete(tabId);
  }
}
