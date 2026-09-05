/**
 * The rejection every data source uses for "no resource has this id":
 * NovaParse for an id absent from the id space, FilesystemData for an
 * absent object file, GameDataAggregator when no source defines it, and
 * the client's batch fetcher for a server entry marked not-found.
 *
 * It is its own module (rather than living in nova_data_interface.ts,
 * which re-exports it) so Gettable can recognise it without a circular
 * import: a not-found rejection is a property of the DATA SET, not of
 * one load's timing, so Gettable caches it and never re-fetches the id.
 */
export class NovaIDNotFoundError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = "NovaIDNotFoundError";
    }
}

/**
 * Whether `e` is a not-found rejection. Checks the name as well as the
 * class: an error that crossed a worker boundary (comlink rebuilds it
 * from {name, message, stack}) or a duplicated module instance is still
 * the same answer.
 */
export function isNovaIDNotFoundError(e: unknown): e is NovaIDNotFoundError {
    return e instanceof NovaIDNotFoundError
        || (e instanceof Error && e.name === "NovaIDNotFoundError");
}
