/**
 * Per-id fault isolation for the spaceport's warm-ups (#130).
 *
 * Every venue loads a whole resource family up front — the outfitter
 * every oütf (and the wëaps they name), the shipyard and the bar's hire
 * pool every shïp, the trade centre every jünk, the mission universe
 * every mïsn / spöb / sÿst / gövt / crön / ränk. The aggregator no longer
 * masks a resource it cannot produce with a placeholder (#47), so a
 * `Promise.all` over those ids rejects the WHOLE warm-up when any one of
 * them fails its parse: one bad plug-in resource blanked the shop.
 *
 * These helpers skip the failing id instead, and say so on the console
 * with the venue and the id, so the shop opens with everything else and
 * the broken resource is still findable.
 */

/** The one warning a skipped id logs: which venue, which resource. */
export function warnSkippedLoad(venue: string, kind: string, id: string,
    reason: unknown): void {
    console.warn(`${venue}: skipping ${kind} ${id}, which failed to load:`,
        reason);
}

/**
 * Loads one id, or warns (see {@link warnSkippedLoad}) and answers
 * undefined when the load rejects. For loops that bound their own
 * concurrency, or that fold results as they go.
 */
export async function loadOrSkip<T>(venue: string, kind: string, id: string,
    load: (id: string) => Promise<T>): Promise<T | undefined> {
    try {
        return await load(id);
    } catch (e) {
        warnSkippedLoad(venue, kind, id, e);
        return undefined;
    }
}

/**
 * Loads every id concurrently and settles them all: the results of the
 * loads that resolved, in `ids` order, with each rejected id warned about
 * and left out.
 */
export async function loadEachOrSkip<T>(venue: string, kind: string,
    ids: readonly string[], load: (id: string) => Promise<T>): Promise<T[]> {
    // async: a load that throws synchronously settles as a rejection too.
    const settled = await Promise.allSettled(ids.map(async id => load(id)));
    const loaded: T[] = [];
    settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            loaded.push(result.value);
        } else {
            warnSkippedLoad(venue, kind, ids[index], result.reason);
        }
    });
    return loaded;
}
