import urlJoin from 'url-join';
import { NovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import { batchPath } from '../../common/game_data_paths.js';
import type { BatchRequest, BatchResponse } from '../../server/setup_routes.js';

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}

/**
 * Coalesces individual `(dataType, id)` metadata fetches into a single
 * batched POST to the server's `/gameData/data/batch` endpoint.
 *
 * On initial join the client asks for hundreds of ship/outfit/weapon/
 * planet/system datas one id at a time. Each `fetch(dataType, id)` here
 * is queued; all requests enqueued before the current flush window
 * closes are sent together as one HTTP request, and each caller's
 * promise is settled from that id's slice of the response.
 *
 * This layer sits *underneath* Gettable: Gettable still owns per-id
 * caching and dedup (its `data`/`gotten` maps), so a batched fetch only
 * ever runs for ids Gettable has not already resolved. Cache hits never
 * reach this class, and its external behavior — one promise per
 * (type, id), rejecting on that id's error — matches the single-fetch
 * path it replaces.
 */
export class BatchDataFetcher {
    // dataType -> id -> queued callers waiting on that id.
    private queue = new Map<string, Map<string, PendingRequest[]>>();
    private flushScheduled = false;

    /**
     * @param windowMs If 0 (default), flush on a microtask — lowest
     *   latency, coalesces only work queued in the same tick. A small
     *   positive value (e.g. 4) widens the window across the sequential
     *   `await`s of staging waterfalls, trading a little latency for
     *   markedly fewer requests.
     */
    constructor(
        private readonly baseUrl = '',
        private readonly windowMs = 0,
        private readonly doFetch: typeof fetch =
            (...args: Parameters<typeof fetch>) => fetch(...args),
    ) { }

    /**
     * Request one resource. Returns a promise resolved with the parsed
     * data for `(dataType, id)`, or rejected if that id could not be
     * loaded. Multiple calls for the same id within a flush window
     * share a single response entry.
     */
    fetch<T>(dataType: string, id: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let idMap = this.queue.get(dataType);
            if (!idMap) {
                idMap = new Map();
                this.queue.set(dataType, idMap);
            }
            let waiters = idMap.get(id);
            if (!waiters) {
                waiters = [];
                idMap.set(id, waiters);
            }
            waiters.push({
                resolve: resolve as (value: unknown) => void,
                reject,
            });
            this.scheduleFlush();
        });
    }

    private scheduleFlush() {
        if (this.flushScheduled) {
            return;
        }
        this.flushScheduled = true;
        if (this.windowMs > 0) {
            setTimeout(() => this.flush(), this.windowMs);
        } else {
            // Microtask window: everything queued synchronously (and by
            // promise continuations that run before the microtask
            // drains) coalesces into one request, with minimal latency.
            queueMicrotask(() => this.flush());
        }
    }

    private async flush() {
        this.flushScheduled = false;
        const batch = this.queue;
        if (batch.size === 0) {
            return;
        }
        this.queue = new Map();

        const request: BatchRequest = {};
        for (const [dataType, idMap] of batch) {
            request[dataType] = [...idMap.keys()];
        }

        const url = this.baseUrl ? urlJoin(this.baseUrl, batchPath) : batchPath;
        try {
            const response = await this.doFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });
            if (!response.ok) {
                throw new Error(`${url}: HTTP ${response.status}`);
            }
            const result = await response.json() as BatchResponse;
            this.settle(batch, result);
        } catch (e) {
            // A transport-level failure fails every id in this batch;
            // Gettable drops its cached promise for each so a retry can
            // succeed later.
            for (const idMap of batch.values()) {
                for (const waiters of idMap.values()) {
                    for (const w of waiters) {
                        w.reject(e);
                    }
                }
            }
        }
    }

    private settle(
        batch: Map<string, Map<string, PendingRequest[]>>,
        result: BatchResponse,
    ) {
        for (const [dataType, idMap] of batch) {
            const typeResult = result[dataType];
            for (const [id, waiters] of idMap) {
                const entry = typeResult?.[id];
                if (entry && 'data' in entry) {
                    for (const w of waiters) {
                        w.resolve(entry.data);
                    }
                } else {
                    const message = entry && 'error' in entry
                        ? entry.error
                        : `Missing '${dataType}' id '${id}' in batch response`;
                    // The server's "no data source defines this id" keeps
                    // its class, so Gettable caches the miss rather than
                    // re-fetching the id on every later read.
                    const error = entry && 'error' in entry && entry.notFound
                        ? new NovaIDNotFoundError(message)
                        : new Error(message);
                    for (const w of waiters) {
                        w.reject(error);
                    }
                }
            }
        }
    }
}
