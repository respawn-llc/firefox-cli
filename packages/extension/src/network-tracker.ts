import type { NetworkResult } from "@firefox-cli/protocol";
import { createGlobMatcher } from "./glob.js";

export type NetworkRequestRecord = {
  readonly id: string;
  readonly tabId: number;
  readonly url: string;
  readonly method?: string;
  readonly type?: string;
  readonly statusCode?: number;
  readonly startedAt: number;
  readonly completedAt?: number;
};

export type NetworkRequestStart = {
  readonly requestId: string | number;
  readonly tabId?: number;
  readonly url?: string;
  readonly method?: string;
  readonly type?: string;
};

export type NetworkRequestEnd = {
  readonly requestId: string | number;
  readonly statusCode?: number;
};

export type NetworkTrackerOptions = {
  readonly maxCompletedRequestsPerTab?: number;
  readonly maxActiveRequestAgeMs?: number;
  readonly now?: () => number;
};

export class NetworkRequestTracker {
  readonly #maxCompletedRequestsPerTab: number;
  readonly #maxActiveRequestAgeMs: number;
  readonly #now: () => number;
  readonly #activeByRequestId = new Map<string, NetworkRequestRecord>();
  readonly #completedByTabId = new Map<number, NetworkRequestRecord[]>();
  readonly #lastActivityByTabId = new Map<number, number>();

  constructor(options: NetworkTrackerOptions = {}) {
    this.#maxCompletedRequestsPerTab = options.maxCompletedRequestsPerTab ?? 1_000;
    this.#maxActiveRequestAgeMs = options.maxActiveRequestAgeMs ?? 60_000;
    this.#now = options.now ?? (() => Date.now());
  }

  recordStart(details: NetworkRequestStart): NetworkRequestRecord | undefined {
    this.pruneStaleActiveRequests();
    if (!isTrackableTabId(details.tabId) || !isTrackableUrl(details.url)) {
      return undefined;
    }

    const now = this.#now();
    const record: NetworkRequestRecord = {
      id: String(details.requestId),
      tabId: details.tabId,
      url: details.url,
      ...(details.method === undefined ? {} : { method: details.method }),
      ...(details.type === undefined ? {} : { type: details.type }),
      startedAt: now,
    };
    this.#activeByRequestId.set(record.id, record);
    this.#lastActivityByTabId.set(record.tabId, now);
    return record;
  }

  recordEnd(details: NetworkRequestEnd): NetworkRequestRecord | undefined {
    this.pruneStaleActiveRequests();
    const id = String(details.requestId);
    const active = this.#activeByRequestId.get(id);
    if (active === undefined) {
      return undefined;
    }

    this.#activeByRequestId.delete(id);
    const now = this.#now();
    const completed = {
      ...active,
      ...(details.statusCode === undefined ? {} : { statusCode: details.statusCode }),
      completedAt: now,
    };
    this.#recordCompletedRequest(completed);
    return completed;
  }

  list(options: {
    readonly tabId: number;
    readonly urlGlob?: string;
  }): NonNullable<NetworkResult["requests"]> {
    this.pruneStaleActiveRequests();
    const matchesUrl = options.urlGlob === undefined ? undefined : createGlobMatcher(options.urlGlob);
    return this.#recordsForTab(options.tabId)
      .filter((request) => matchesUrl === undefined || matchesUrl(request.url))
      .sort((left, right) => left.startedAt - right.startedAt)
      .map(toNetworkRequestSummary);
  }

  clear(options: { readonly tabId: number; readonly urlGlob?: string }): void {
    this.pruneStaleActiveRequests();
    const completed = this.#completedByTabId.get(options.tabId);
    if (completed === undefined) {
      return;
    }

    const matchesUrl = options.urlGlob === undefined ? undefined : createGlobMatcher(options.urlGlob);
    this.#completedByTabId.set(
      options.tabId,
      completed.filter((request) => matchesUrl !== undefined && !matchesUrl(request.url)),
    );
    this.#deleteEmptyTabState(options.tabId);
  }

  isIdle(options: { readonly tabId: number; readonly idleMs: number }): boolean {
    this.pruneStaleActiveRequests();
    if ([...this.#activeByRequestId.values()].some((request) => request.tabId === options.tabId)) {
      return false;
    }

    const lastActivity = this.#lastActivityByTabId.get(options.tabId) ?? 0;
    return this.#now() - lastActivity >= options.idleMs;
  }

  pruneTab(tabId: number): void {
    if (!isTrackableTabId(tabId)) {
      return;
    }
    for (const [requestId, request] of this.#activeByRequestId) {
      if (request.tabId === tabId) {
        this.#activeByRequestId.delete(requestId);
      }
    }
    this.#completedByTabId.delete(tabId);
    this.#lastActivityByTabId.delete(tabId);
  }

  hasActiveRequests(tabId: number): boolean {
    this.pruneStaleActiveRequests();
    return this.#hasActiveRequestsForTab(tabId);
  }

  hasTabState(tabId: number): boolean {
    this.pruneStaleActiveRequests();
    return (
      this.hasActiveRequests(tabId) ||
      (this.#completedByTabId.get(tabId)?.length ?? 0) > 0 ||
      this.#lastActivityByTabId.has(tabId)
    );
  }

  pruneStaleActiveRequests(maxAgeMs: number = this.#maxActiveRequestAgeMs): number {
    const now = this.#now();
    let pruned = 0;
    for (const [requestId, request] of this.#activeByRequestId) {
      if (now - request.startedAt < maxAgeMs) {
        continue;
      }
      this.#activeByRequestId.delete(requestId);
      this.#recordCompletedRequest({ ...request, completedAt: now });
      pruned += 1;
    }
    return pruned;
  }

  #recordsForTab(tabId: number): readonly NetworkRequestRecord[] {
    return [
      ...(this.#completedByTabId.get(tabId) ?? []),
      ...[...this.#activeByRequestId.values()].filter((request) => request.tabId === tabId),
    ];
  }

  #recordCompletedRequest(request: NetworkRequestRecord): void {
    const completedForTab = [...(this.#completedByTabId.get(request.tabId) ?? []), request];
    this.#completedByTabId.set(
      request.tabId,
      pruneCompletedHistory(completedForTab, this.#maxCompletedRequestsPerTab),
    );
    this.#lastActivityByTabId.set(request.tabId, request.completedAt ?? this.#now());
  }

  #deleteEmptyTabState(tabId: number): void {
    if ((this.#completedByTabId.get(tabId)?.length ?? 0) === 0) {
      this.#completedByTabId.delete(tabId);
    }
    if (
      !this.#lastActivityByTabId.has(tabId) ||
      this.#hasActiveRequestsForTab(tabId) ||
      (this.#completedByTabId.get(tabId)?.length ?? 0) > 0
    ) {
      return;
    }
    this.#lastActivityByTabId.delete(tabId);
  }

  #hasActiveRequestsForTab(tabId: number): boolean {
    return [...this.#activeByRequestId.values()].some((request) => request.tabId === tabId);
  }
}

function pruneCompletedHistory(
  records: readonly NetworkRequestRecord[],
  maxCompletedRequestsPerTab: number,
): NetworkRequestRecord[] {
  const extraCount = records.length - maxCompletedRequestsPerTab;
  return extraCount <= 0 ? [...records] : records.slice(extraCount);
}

function isTrackableTabId(tabId: number | undefined): tabId is number {
  return typeof tabId === "number" && Number.isInteger(tabId) && tabId >= 0;
}

function isTrackableUrl(url: string | undefined): url is string {
  if (url === undefined) {
    return false;
  }

  const scheme = /^[a-z][a-z0-9+.-]*:/iu.exec(url)?.[0]?.toLowerCase();
  return (
    scheme !== undefined &&
    scheme !== "moz-extension:" &&
    scheme !== "about:" &&
    scheme !== "chrome:" &&
    scheme !== "resource:"
  );
}

function toNetworkRequestSummary(
  request: NetworkRequestRecord,
): NonNullable<NetworkResult["requests"]>[number] {
  return {
    id: request.id,
    url: request.url,
    ...(request.method === undefined ? {} : { method: request.method }),
    ...(request.type === undefined ? {} : { type: request.type }),
    ...(request.statusCode === undefined ? {} : { statusCode: request.statusCode }),
  };
}
