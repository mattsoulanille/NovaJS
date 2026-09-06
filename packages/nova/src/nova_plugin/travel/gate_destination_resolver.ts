import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';

/**
 * Resolves a hypergate/wormhole destination spöb to the system that contains
 * it, and resolves random-wormhole exits from the full set of link-less
 * wormholes.
 *
 * This runs on the browser main thread (in the FinishJumpEvent-style transit
 * handler), which — unlike the deterministic sim worker — can freely await the
 * whole game-data catalog. The sim already made the *choice* deterministically
 * (which spöb, or the random draw for a link-less wormhole); this only maps
 * that choice onto a concrete (system, gate) pair. The index is built once and
 * cached.
 */
export class GateDestinationResolver {
    /** spöb global id -> system global id that contains it. */
    private spobToSystem = new Map<string, string>();
    /** Global ids of link-less wormholes (random-wormhole exits). */
    private randomWormholes: string[] = [];
    private buildPromise?: Promise<void>;

    constructor(private gameData: SimulationGameDataInterface) { }

    private async build(): Promise<void> {
        const ids = await this.gameData.ids;
        // Map every spöb to its containing system.
        const systems = await Promise.all(
            ids.System.map(id => this.gameData.data.System.get(id)));
        for (const system of systems) {
            for (const spob of system.planets) {
                // First writer wins: a spöb should belong to one system, but
                // NCB-swapped duplicate systems can list the same gate. The
                // duplicates share coordinates, so either is a valid exit.
                if (!this.spobToSystem.has(spob)) {
                    this.spobToSystem.set(spob, system.id);
                }
            }
        }
        // Collect the link-less wormholes (a random wormhole exits at another
        // link-less wormhole — EVN Bible p. 61). Stable order (id order) so the
        // seeded draw resolves identically wherever it is computed.
        const planets = await Promise.all(
            ids.Planet.map(id => this.gameData.data.Planet.get(id)));
        for (const planet of planets) {
            if (planet.gate?.kind === 'wormhole'
                && planet.gate.destinations.length === 0) {
                this.randomWormholes.push(planet.id);
            }
        }
        this.randomWormholes.sort();
    }

    private ensureBuilt(): Promise<void> {
        if (!this.buildPromise) {
            this.buildPromise = this.build();
        }
        return this.buildPromise;
    }

    /** The system global id that contains the given spöb, or undefined. */
    async systemOf(spob: string): Promise<string | undefined> {
        await this.ensureBuilt();
        return this.spobToSystem.get(spob);
    }

    /**
     * Picks a random link-less wormhole exit for a random wormhole, using the
     * sim's replicated [0,1) draw so the choice is deterministic. `from` is the
     * departure wormhole, excluded so a random wormhole never dumps the ship
     * back where it started (unless it is the only one).
     */
    async randomWormholeExit(from: string, randomDraw: number):
        Promise<string | undefined> {
        await this.ensureBuilt();
        const candidates = this.randomWormholes.filter(w => w !== from);
        const pool = candidates.length > 0 ? candidates : this.randomWormholes;
        if (pool.length === 0) {
            return undefined;
        }
        return pool[Math.floor(randomDraw * pool.length)];
    }
}
