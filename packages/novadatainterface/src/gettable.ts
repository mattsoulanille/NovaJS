import { isNovaIDNotFoundError } from "./nova_id_not_found_error.js";

export type Builder<T> = (id: string, priority: number) => Promise<T>;

export type GettableData<G> = G extends Gettable<infer T> ? T : never;

export class Gettable<T> {
    protected data: { [key: string]: Promise<T> } = {};
    gotten: { [key: string]: T } = {};
    /**
     * Ids whose load rejected with NovaIDNotFoundError, and the rejection.
     * "Does not exist" is a property of the data set, not of this world's
     * load timing, so it is cached like a success: a later `get` rejects
     * immediately with the same error, and `getCached` answers undefined
     * WITHOUT starting another background load — a simulation-side read
     * of a dangling plug-in reference would otherwise re-fetch (and
     * re-warn) every frame. Other rejections (transport failures) are not
     * cached; a retry may succeed.
     */
    protected missing: { [key: string]: Error } = {};

    constructor(protected getFunction: Builder<T>,
        protected warn: (message: unknown) => void = console.warn) { }

    async get(id: string, priority: number = 0) {
        if (id in this.gotten) {
            return this.gotten[id];
        }
        if (id in this.missing) {
            throw this.missing[id];
        }

        if (!(id in this.data)) {
            this.data[id] = this.getFunction(id, priority);
        }

        try {
            const val = await this.data[id];
            this.gotten[id] = val;
            return val;
        } catch (e) {
            delete this.data[id];
            if (isNovaIDNotFoundError(e)) {
                this.missing[id] = e;
            }
            throw e;
        }
    }

    /**
     * The cached value, or undefined — in which case a *background
     * load starts* (unless the id is already known not to exist), so a
     * later call may succeed.
     *
     * DETERMINISM WARNING (rollback multiplayer): a getCached hit is a
     * property of *this world's* load timing, not of shared game
     * state. Simulation behavior or state creation gated on it
     * diverges peers whose caches warm at different ticks — two real
     * recorded desyncs came from exactly this. Sim code may only call
     * this for ids that staging (loadEntityGameData, spawnAsteroids)
     * provably loaded first, and a miss must never change what the
     * simulation does. See docs/rollback_multiplayer.md findings
     * (11) and (12).
     */
    getCached(id: string): T | undefined {
        const cached = this.gotten[id];
        if (cached) {
            return cached;
        }
        if (!(id in this.missing)) {
            this.get(id).catch(error => this.warn(error));
        }
        return undefined;
    }

    /** Whether a load of `id` has definitively failed as not-found. */
    isMissing(id: string): boolean {
        return id in this.missing;
    }
}
