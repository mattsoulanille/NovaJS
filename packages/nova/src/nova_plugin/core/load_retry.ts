import { isNovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';

/**
 * Retries a game-data load with backoff. Staging is the only thing
 * keeping the simulation's `getCached` reads deterministic (see the
 * warning on Gettable.getCached): a transient fetch failure on one
 * world must not silently leave its cache cold, or that world's
 * simulation behaves differently from every other's. Micro-blips are
 * absorbed here; longer outages are the caller's problem — insertion
 * staging retries the whole load and escalates to a resync, and a
 * genesis load failure should fail construction loudly rather than
 * build a world that quietly disagrees.
 */
export async function loadWithRetries<T>(load: () => Promise<T>,
    label: string, attempts = 3, baseDelayMs = 200): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await load();
        } catch (error) {
            // "Does not exist" is not transient: the data set will give
            // the same answer after every backoff, so give it now (and
            // keep its class, so callers can tell it from a failure).
            if (isNovaIDNotFoundError(error)) {
                throw error;
            }
            lastError = error;
            if (attempt < attempts) {
                await new Promise(resolve =>
                    setTimeout(resolve, baseDelayMs * attempt));
            }
        }
    }
    throw new Error(
        `Failed to load ${label} after ${attempts} attempts: ${lastError}`);
}
