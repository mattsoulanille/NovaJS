import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { evaluateNCBTest } from '../ncb/index.js';

/** One system that lists a spöb, with that system's Visibility test. */
interface ContainingSystem {
    id: string;
    visibility: string;
}

/** A sÿst Visibility test against the player's bits (blank = visible; a
 * malformed expression fails open, as on the star map). */
function systemVisible(visibility: string, bits: ReadonlySet<number>)
    : boolean {
    if (visibility.trim() === '') {
        return true;
    }
    try {
        return evaluateNCBTest(visibility, { getBit: bit => bits.has(bit) });
    } catch {
        return true;
    }
}

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
    /** spöb global id -> every system that lists it, in id order. */
    private spobToSystems = new Map<string, ContainingSystem[]>();
    /** Global ids of link-less wormholes (random-wormhole exits). */
    private randomWormholes: string[] = [];
    private buildPromise?: Promise<void>;

    constructor(private gameData: SimulationGameDataInterface) { }

    private async build(): Promise<void> {
        const ids = await this.gameData.ids;
        // Map every spöb to its containing systems. A gate is usually in
        // ONE system, but a system replaced by an NCB-swapped copy lists
        // the same gate in every copy: HG-Aurora (nova:1414) is in the
        // pre-coup Aurora nova:315 ("!b323") and the post-coup Aurora
        // nova:603 ("b323"), HG-Heraan (nova:1415) in nova:344 / 540 /
        // 604. systemOf picks among them with the player's bits.
        const systems = await Promise.all(
            ids.System.map(id => this.gameData.data.System.get(id)));
        for (const system of [...systems].sort(
            (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
            for (const spob of system.planets) {
                const all = this.spobToSystems.get(spob) ?? [];
                all.push({
                    id: system.id,
                    visibility: system.visibility ?? '',
                });
                this.spobToSystems.set(spob, all);
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

    /**
     * The system global id that contains the given spöb — THE COPY THE
     * PLAYER CAN SEE under `bits` when the spöb is listed by several
     * NCB-stacked copies of one system — or undefined.
     *
     * EVN Bible, sÿst Visibility: replacing a system with a copy "will work
     * fine as long as they have the exact same coordinates (that's how Nova
     * knows to update the hyper links, etc.)". The copies are not
     * interchangeable: post-coup Aurora (nova:603) holds the Heraan-ruled
     * Aurora (spöb nova:439) where the Auroran string continues, pre-coup
     * Aurora (nova:315) the old one (nova:338). Taking the first copy in id
     * order, as this did, dropped every hypergate traveller into the
     * pre-coup systems for good, where "Speak With Polaris" (mïsn nova:680,
     * AvailStel 439) can never be offered (playtest, 2026-11-27).
     *
     * The rule is MissionUniverse.systemIdOfPlanet's, and `bits` is
     * required for the same reason (#325): the first visible copy in id
     * order; when no copy is visible, the first with a blank Visibility,
     * else the first.
     */
    async systemOf(spob: string, bits: ReadonlySet<number>)
        : Promise<string | undefined> {
        await this.ensureBuilt();
        const all = this.spobToSystems.get(spob);
        if (!all || all.length === 0) {
            return undefined;
        }
        if (all.length === 1) {
            return all[0].id;
        }
        const visible = all.find(({ visibility }) =>
            systemVisible(visibility, bits));
        if (visible) {
            return visible.id;
        }
        return (all.find(({ visibility }) => visibility.trim() === '')
            ?? all[0]).id;
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
