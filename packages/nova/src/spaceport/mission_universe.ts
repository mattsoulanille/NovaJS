import { CronData } from 'novadatainterface/cron_data';
import { GovtData } from 'novadatainterface/govt_data';
import { MissionData } from 'novadatainterface/mission_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { RankData } from 'novadatainterface/rank_data';
import { SystemData } from 'novadatainterface/system_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { displayName } from '../nova_plugin/display_name.js';
import { evaluateNCBTest } from '../nova_plugin/ncb.js';
import { StellarInfo, stellarInfoOf } from '../nova_plugin/mission_logic.js';
import { SystemInfo } from '../nova_plugin/mission_ship_logic.js';

/** A system's Visibility test against the player's bits (blank = visible;
 * a malformed expression fails open, like stellarVisible). */
function systemVisible(visibility: string, bits: ReadonlySet<number>): boolean {
    if (visibility.trim() === '') {
        return true;
    }
    try {
        return evaluateNCBTest(visibility, { getBit: bit => bits.has(bit) });
    } catch {
        return true;
    }
}

/** Maps over `items` with at most `concurrency` calls in flight. */
async function pooledMap<T, R>(items: readonly T[],
    map: (item: T) => Promise<R>, concurrency = 12): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const index = next++;
            results[index] = await map(items[index]);
        }
    }
    await Promise.all(Array.from(
        { length: Math.min(concurrency, items.length) }, worker));
    return results;
}

/**
 * The static data the mission system needs, loaded once per session
 * and shared by the mission computer, the bar, and landing
 * processing: every mission (for offers and for Sxxx lookups), every
 * planet (for random/govt-ranged destinations and name expansion),
 * every system (for planet -> system mapping), and every govt (for
 * stellar matching).
 *
 * Player-local display-side data; the simulation never reads this.
 */
export class MissionUniverse {
    missions: MissionData[] = [];
    crons: CronData[] = [];
    /** Standard cargo display names (STR# 4000), parsed from any chär. */
    cargoNames: string[] = [];
    stellarCandidates: StellarInfo[] = [];
    /** Systems, for special/aux ship spawn-system resolution. */
    systemInfos: SystemInfo[] = [];
    private systemInfosById = new Map<string, SystemInfo>();
    private missionsById = new Map<string, MissionData>();
    private planetsById = new Map<string, PlanetData>();
    private govtsById = new Map<string, GovtData>();
    private ranksById = new Map<string, RankData>();
    private systemsById = new Map<string, SystemData>();
    /** The FIRST (id-sorted) system listing each placed planet. */
    private planetSystem = new Map<string, string>();
    /** EVERY system listing each placed planet, id-sorted, with its
     * Visibility expression — stacked duplicate systems (e.g. SPC-1421 as
     * nova:308 "!b995" and nova:765 "b995") share their stellars. */
    private planetSystems = new Map<string, { id: string, visibility: string }[]>();
    /** The Visibility expressions of every system a placed planet sits in. */
    private planetVisibilities = new Map<string, string[]>();
    /** Canonical "same stellar" key (name + map coords) per placed planet. */
    private stellarKeyById = new Map<string, string>();
    private loadPromise?: Promise<void>;

    private static instances =
        new WeakMap<SimulationGameDataInterface, MissionUniverse>();

    constructor(private gameData: SimulationGameDataInterface) { }

    /** One shared universe per game-data instance. */
    static shared(gameData: SimulationGameDataInterface): MissionUniverse {
        let universe = MissionUniverse.instances.get(gameData);
        if (!universe) {
            universe = new MissionUniverse(gameData);
            MissionUniverse.instances.set(gameData, universe);
        }
        return universe;
    }

    /** Idempotent; concurrent callers share one load. */
    load(): Promise<void> {
        this.loadPromise ??= this.doLoad();
        return this.loadPromise;
    }

    private async doLoad() {
        const ids = await this.gameData.ids;
        const data = this.gameData.data;

        // Bounded concurrency: firing thousands of parallel fetches
        // makes Chrome throw ERR_INSUFFICIENT_RESOURCES.
        const [missions, planets, systems, govts, crons, ranks] =
            await Promise.all([
            pooledMap(ids.Mission, async id =>
                [id, await data.Mission.get(id)] as const),
            pooledMap(ids.Planet, async id =>
                [id, await data.Planet.get(id)] as const),
            pooledMap(ids.System, async id =>
                [id, await data.System.get(id)] as const),
            pooledMap(ids.Govt, async id =>
                [id, await data.Govt.get(id)] as const),
            pooledMap(ids.Cron, id => data.Cron.get(id)),
            pooledMap(ids.Rank, async id =>
                [id, await data.Rank.get(id)] as const),
        ]);

        this.missionsById = new Map(missions);
        this.planetsById = new Map(planets);
        this.systemsById = new Map(systems);
        this.govtsById = new Map(govts);
        this.ranksById = new Map(ranks);
        this.crons = crons;

        this.missions = [...this.missionsById.values()];

        // Standard cargo names (STR# 4000) ride on every chär; read the
        // first available one, falling back to the built-in names.
        this.cargoNames = [];
        try {
            const playerStartId = ids.PlayerStart[0];
            if (playerStartId) {
                this.cargoNames = [...(await data.PlayerStart
                    .get(playerStartId)).cargoNames];
            }
        } catch (e) {
            console.warn('Failed to load standard cargo names:', e);
        }

        // Only planets that appear in some system are candidate
        // destinations (spöbs can exist without being placed). Track every
        // containing system's Visibility expression (a stellar can be listed
        // by several stacked systems) so hidden duplicates stay out of
        // random destination sampling, and a canonical name+coords key so a
        // frozen duplicate id still completes on landing at its visible copy.
        this.planetSystem.clear();
        this.planetSystems.clear();
        this.planetVisibilities.clear();
        this.stellarKeyById.clear();
        for (const [systemId, system] of [...this.systemsById]
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
            for (const planetId of system.planets) {
                if (!this.planetSystem.has(planetId)) {
                    this.planetSystem.set(planetId, systemId);
                }
                const all = this.planetSystems.get(planetId) ?? [];
                all.push({ id: systemId, visibility: system.visibility });
                this.planetSystems.set(planetId, all);
                const vis = this.planetVisibilities.get(planetId) ?? [];
                vis.push(system.visibility);
                this.planetVisibilities.set(planetId, vis);
                const planet = this.planetsById.get(planetId);
                if (planet && !this.stellarKeyById.has(planetId)) {
                    const [x, y] = system.position;
                    this.stellarKeyById.set(planetId,
                        `${planet.name}|${x}|${y}`);
                }
            }
        }
        this.stellarCandidates = [...this.planetsById.values()]
            .filter(planet => this.planetSystem.has(planet.id))
            .map(planet => ({
                ...stellarInfoOf(planet),
                systemVisibilities:
                    this.planetVisibilities.get(planet.id) ?? [],
            }));

        this.systemInfos = [...this.systemsById.values()].map(system => ({
            id: system.id,
            govt: system.govt,
            links: [...system.links],
        }));
        this.systemInfosById = new Map(
            this.systemInfos.map(info => [info.id, info]));
    }

    getSystemInfo(systemId: string): SystemInfo | undefined {
        return this.systemInfosById.get(systemId);
    }

    /** Whether two system ids are stacked duplicates of one system: same
     * name and map coordinates (see systemIdOfPlanet). */
    sameSystem(a: string, b: string): boolean {
        if (a === b) {
            return true;
        }
        const sa = this.systemsById.get(a);
        const sb = this.systemsById.get(b);
        return sa !== undefined && sb !== undefined
            && sa.name === sb.name
            && sa.position[0] === sb.position[0]
            && sa.position[1] === sb.position[1];
    }

    getMission(id: string): MissionData | undefined {
        return this.missionsById.get(id);
    }

    /**
     * The display name of a shïp type (its resource name, "; comment"
     * suffix hidden), for the <PST>/<PSN> identity wildcards. Undefined
     * when the ship can't be loaded — the wildcard falls back to its
     * generic default rather than breaking the dialog.
     */
    async shipTypeName(shipId: string): Promise<string | undefined> {
        try {
            return displayName((await this.gameData.data.Ship.get(shipId)).name);
        } catch {
            return undefined;
        }
    }

    getPlanet(id: string): PlanetData | undefined {
        return this.planetsById.get(id);
    }

    /**
     * A stellar to stand for `systemId` in a mission context that has no
     * landing of its own — the IN-FLIGHT offer a përs ship makes (mïsn
     * AvailLoc 2). The offer happens in open space, but the mission
     * machinery is written around "where is this being offered": AvailStel
     * is judged against it, ShipSyst -1 ("the system the mission was
     * offered in") is resolved through it, and the ActiveMission records
     * it as `acceptedAt`. Answering "somewhere in this system" is both
     * true and enough for all three.
     *
     * INHABITED FIRST, because AvailStel -1 — which every stock AvailLoc 2
     * mission uses — means "any inhabited stellar", and a system whose
     * first spöb happens to be a gas giant would silence the lot. Falls
     * back to any stellar, then to undefined for a system with none (the
     * caller then uses the neutral '<in-flight>' sentinel).
     *
     * IT MUST ROUND-TRIP, which is the subtle part: ShipSyst -1 is
     * resolved as systemIdOfStellar(the borrowed stellar), and spöbs are
     * shared between systems (the same rock listed by several sÿsts under
     * mutually-exclusive Visibility bits), so `planetSystem` — a
     * many-to-one map that keeps the LAST system to claim a spöb — can
     * map one straight back out to a different system. A stellar that
     * does not lead home is no use for standing in for home, so those are
     * skipped. The stock case that caught this: sÿst 1124's spöb 173,
     * which planetSystem attributes to sÿst 1126.
     *
     * Deterministic: the first match in the system's own spöb order, not
     * a random pick, so two evaluations of the same offer agree.
     */
    stellarInSystem(systemId: string): string | undefined {
        const planets = this.systemsById.get(systemId)?.planets ?? [];
        let fallback: string | undefined;
        for (const planetId of planets) {
            const planet = this.planetsById.get(planetId);
            if (!planet || this.planetSystem.get(planetId) !== systemId) {
                continue;
            }
            fallback ??= planetId;
            if (!stellarInfoOf(planet).uninhabited) {
                return planetId;
            }
        }
        return fallback;
    }

    getGovt(id: string): GovtData | undefined {
        return this.govtsById.get(id);
    }

    /** Every govt, sorted by id, for reputation ally/classmate scopes. */
    /** A rank's data by global id, for the Kxxx/Lxxx cascades. */
    getRank(id: string): RankData | undefined {
        return this.ranksById.get(id);
    }

    /** Every rank, for the player-info Honors page. */
    ranks(): Iterable<readonly [string, RankData]> {
        return this.ranksById;
    }

    govts(): Iterable<readonly [string, GovtData]> {
        return [...this.govtsById].sort(([a], [b]) => a < b ? -1 : 1);
    }

    planetName(id: string | null): string {
        if (!id) {
            return 'nowhere';
        }
        const name = this.planetsById.get(id)?.name;
        return name === undefined ? id : displayName(name);
    }

    /**
     * The system a stellar is in — the VISIBLE one, when the player's
     * control bits are known. Duplicate stellars are stacked in duplicate
     * systems under mutually exclusive Visibility expressions (mïsn 737's
     * return stellar Auroran LP I sits in both nova:308 "!b995" and
     * nova:765 "b995"); resolving ShipSyst -3/-4 or a map mark to the
     * copy the player cannot enter put the Moash fleet in a system the
     * player never sees. Without bits, the id-sorted first system with a
     * blank Visibility, else the first.
     */
    systemIdOfPlanet(planetId: string,
        bits?: ReadonlySet<number>): string | undefined {
        const all = this.planetSystems.get(planetId);
        if (!all || all.length === 0) {
            return undefined;
        }
        if (all.length === 1) {
            return all[0].id;
        }
        if (bits) {
            const visible = all.find(({ visibility }) =>
                systemVisible(visibility, bits));
            if (visible) {
                return visible.id;
            }
        }
        return (all.find(({ visibility }) => visibility.trim() === '')
            ?? all[0]).id;
    }

    /**
     * Whether two stellar ids are the "same stellar" — identical name and
     * map coordinates — so landing on one fulfils a mission objective set
     * to the other (EVN Bible, TravelStel/ReturnStel duplicate rule).
     * Duplicate stellars are stacked at one system position under
     * mutually-exclusive Visibility bits, so name + containing-system
     * coordinates uniquely identifies a stellar across its copies.
     */
    sameStellar(a: string, b: string): boolean {
        if (a === b) {
            return true;
        }
        const keyA = this.stellarKeyById.get(a);
        const keyB = this.stellarKeyById.get(b);
        return keyA !== undefined && keyA === keyB;
    }

    systemNameOfPlanet(planetId: string | null): string {
        if (!planetId) {
            return 'nowhere';
        }
        const systemId = this.planetSystem.get(planetId);
        if (!systemId) {
            return 'deep space';
        }
        const name = this.systemsById.get(systemId)?.name;
        return name === undefined ? systemId : displayName(name);
    }
}
