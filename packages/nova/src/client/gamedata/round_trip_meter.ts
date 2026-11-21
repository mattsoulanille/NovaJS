/**
 * Measures how many SEQUENTIAL round trips a game-data client spends,
 * by wrapping the `fetch` a SimulationGameData uses (issue #368).
 *
 * Locally a round trip costs ~1 ms, so a staging waterfall — a loop
 * that awaits one get at a time, a dependency walk that awaits each
 * child before asking for its sibling — is invisible; on a deployed
 * server at ~100 ms it is the whole cost of entering a system. Request
 * COUNT is not that cost (concurrent requests overlap): DEPTH is. A
 * request's depth is one more than the deepest request that had
 * already completed when it was issued, so a chain of N dependent
 * fetches has depth N however the batching splits them, and N
 * independent fetches issued together have depth 1.
 *
 * `delayMs` holds every request that long before forwarding it, which
 * emulates the network's latency (and makes wall time a second,
 * independent read of the same depth).
 */
export interface RoundTripStats {
    /** Requests issued (batched data POSTs and JSON GETs alike). */
    requests: number;
    /** Of those, batched data POSTs. */
    batches: number;
    /** Ids carried by the batched POSTs. */
    ids: number;
    /** The longest chain of dependent round trips. */
    depth: number;
}

export interface RoundTripMeter {
    readonly fetch: typeof fetch;
    readonly stats: RoundTripStats;
    /** Zeroes the counters (in-flight requests still count when they land). */
    reset(): void;
}

export function meterRoundTrips(inner: typeof fetch, delayMs = 0):
    RoundTripMeter {
    const stats: RoundTripStats = { requests: 0, batches: 0, ids: 0, depth: 0 };
    let completedDepth = 0;
    const metered = (async (input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]) => {
        const depth = completedDepth + 1;
        stats.requests++;
        if (init?.method === 'POST' && typeof init.body === 'string') {
            stats.batches++;
            const body = JSON.parse(init.body) as Record<string, string[]>;
            for (const ids of Object.values(body)) {
                stats.ids += ids.length;
            }
        }
        if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        try {
            return await inner(input, init);
        } finally {
            completedDepth = Math.max(completedDepth, depth);
            stats.depth = Math.max(stats.depth, depth);
        }
    }) as typeof fetch;
    return {
        fetch: metered,
        stats,
        reset() {
            stats.requests = 0;
            stats.batches = 0;
            stats.ids = 0;
            stats.depth = 0;
            completedDepth = 0;
        },
    };
}
