import * as t from 'io-ts';
import { FleetData } from 'novadatainterface/fleet_data';
import { GovtData } from 'novadatainterface/govt_data';
import { PersData } from 'novadatainterface/pers_data';
import { ShipData } from 'novadatainterface/ship_data';
import { SystemData } from 'novadatainterface/system_data';
import { GetWorld } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { loadShipGameData } from './entity_data_loader.js';
import { deriveEntityComponents } from './entity_factory.js';
import { DisabledComponent } from './disabled_component.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { GovtComponent } from './govt_component.js';
import { ArmorComponent, ShieldComponent } from './health_plugin.js';
import { IdFactory, IdFactoryResource } from './id_factory.js';
import { JUMP_ARRIVAL_MARGIN_S, JUMP_DISTANCE } from './jump_plugin.js';
import { loadWithRetries } from './load_retry.js';
import { evaluateNCBTest } from './ncb.js';
import { GOAL_RESCUE } from './mission_ship_state.js';
import { DeathAIComponent } from './npc_plugin.js';
import { FiringGroupComponent } from './firing_group.js';
import { FormationComponent, NpcComponent, formationSlotPosition } from './npc_ai_plugin.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { PersComponent } from './pers_plugin.js';
import { ShipComponent, ShipDataComponent, ShipPhysicsComponent } from './ship_plugin.js';
import { Stat } from './stat.js';
import { SystemHoldComponent } from './system_hold.js';
import { TargetComponent } from './target_component.js';

/**
 * ============================================================================
 * NPC population (sÿst DudeTypes + flët fleets)
 * ============================================================================
 *
 * Each system maintains a deterministic NPC population drawn from its
 * sÿst dude table: the population target is AvgShips +/- 50% (the
 * Bible's rule), rolled once at world genesis from the per-system
 * seeded Random, so every peer builds the same population. Ships jump
 * out when their AI decides to (npc_ai_plugin) and a respawn system
 * tops the population back up with ships "jumping in" at the system
 * edge — the same deterministic-spawner shape as the asteroid field.
 *
 * The spawn TABLE is computed once at genesis and stored on a spawner
 * entity, because computing it requires async game-data loads (dude,
 * fleet, ship, govt resources) that must never happen mid-simulation.
 * Every ship class the table can ever spawn — and its transitive
 * weapon/bay closure, and its govt — is staged at genesis, so the
 * respawn system's getCached reads behave identically on every world
 * (see entity_data_loader.ts's staging contract).
 *
 * Fleets come from two sources:
 *  - sÿst DudeTypes entries -128..-383 reference flët -id directly and
 *    inherit that entry's probability weight.
 *  - Roaming fleets: every flët whose LinkSyst matches this system
 *    (specific system / this govt's systems / an ally's / an enemy's /
 *    anyone else's — resolved through GovtData class numbers) is
 *    folded into the table under a shared ROAMING_FLEET_WEIGHT so
 *    fleets stay occasional rather than dominating the dude traffic.
 *
 * MULTIPLAYER DESIGN CONSTRAINT (AppearOn): a flët's AppearOn NCB test
 * is evaluated at genesis against an EMPTY control-bit set. Control
 * bits are per-player mission state, but fleet spawning is shared-sim
 * state that must be identical for every peer in a room — one player's
 * mission bits cannot make a fleet exist for everyone (or worse, only
 * on their own world: an instant desync). Until missions land and a
 * design for shared-vs-personal encounters exists, only fleets whose
 * AppearOn passes with no bits set (i.e. unconditional or negated-bit
 * expressions) can spawn. shïp AppearOn, which gates the ship classes a
 * düde may pick from, is read under exactly the same rule (see
 * buildNpcSpawnTable).
 *
 * përs unique characters ride the same machinery: the Bible's "When
 * ships are created, there is a 5% chance that a specific AI-person
 * will also be created" is a roll on each spawn draw against a genesis
 * përs table. WHICH people that table holds comes from the sÿst Person
 * fields when the system has any — the Bible: "Want to make a 'pers'
 * type ship always appear? Put its ID into one of the Person fields
 * that appear at the end of the syst resource." Sol (sÿst nova:130)
 * lists exactly four: Terrapin 12%, Valkyrie 1%, a Drifting Derelict
 * Heavy Shuttle 2%, Galadriel 15%.
 *
 * Composition (see maybeSpawnPers): the 5% is the whole window and each
 * listed person's percent is its share of it, so a person appears on
 * 5% x chance% of spawn draws (Sol's derelict: 0.1%, rare but real; a
 * përs Sol does not list: zero). A system whose listed chances sum to
 * 100 uses the full 5%; sums past 100 saturate it.
 *
 * LinkSyst ("Which systems the person can be created in") is NOT
 * ANDed with an authored list. Stock data forbids it: of the 228
 * Person entries in the 65 systems that have any, 160 name a person
 * whose own LinkSyst excludes the listing system (Sol's Valkyrie përs
 * nova:227 is bound to gövt nova:134's systems, yet Sol lists it at
 * 1% — a deliberate rare cameo). An authored list is the system's
 * cast, full stop.
 *
 * The other 480 stock systems list nobody, and there LinkSyst is the
 * only thing that speaks: those systems fall back to the pool of përs
 * whose LinkSyst admits them, spread evenly across the same 5% window.
 * The fallback is not optional — only 48 of the game's 516 përs are
 * named in any system's Person fields, so list-only selection would
 * strand 91% of the cast (përs nova:142, a Terrapin bound by LinkSyst
 * to sÿst nova:136 Fomalhaut and named by nobody, is typical). It
 * leaves 23 përs unreachable even so: those whose LinkSyst admits only
 * systems that DO have an authored list, e.g. përs nova:140, bound to
 * sÿst nova:134 Kerella, whose Person fields name three other people.
 * Nova itself must resolve that overlap somehow; nothing in the Bible
 * says how, and every alternative reading costs more (see above).
 *
 * ActiveOn is evaluated under the same empty-bit-set constraint as
 * flët AppearOn either way, and ship/govt are staged like everything
 * else. At most one living instance of a person exists in the system
 * at a time. See pers_plugin.ts for what of the përs resource is and
 * isn't applied.
 */

/** Hard cap on the NPC population. AvgShips reaches 20 in stock data
 * (and 50 in plugins); ships are far heavier than asteroids (outfits,
 * weapons, AI, per-frame snapshot encoding), so populations are capped
 * well below the asteroid cap. */
export const MAX_NPC_POPULATION = 12;
/** How often the system replaces a departed/destroyed NPC. */
export const NPC_RESPAWN_INTERVAL_MS = 15_000;
/** Initial spawns scatter within this half-size box (the region where
 * planets and gameplay live; matches the asteroid field). */
export const INITIAL_SPAWN_HALF_SIZE = 2000;
/** Total table weight given to all roaming (LinkSyst) fleets combined,
 * relative to dude weights that typically sum to ~100. */
const ROAMING_FLEET_WEIGHT = 15;

const WeightedShip = t.type({ id: t.string, weight: t.number });

const DudeSpawn = t.type({
    /** Düde AIType; 0 = each ship's InherentAI. */
    aiType: t.number,
    govt: t.union([t.string, t.null]),
    ships: t.array(WeightedShip),
});
type DudeSpawn = t.TypeOf<typeof DudeSpawn>;

const FleetSpawn = t.type({
    leadShip: t.string,
    escorts: t.array(t.type({
        id: t.string,
        min: t.number,
        max: t.number,
    })),
    govt: t.union([t.string, t.null]),
});
type FleetSpawn = t.TypeOf<typeof FleetSpawn>;

export const NpcSpawnEntry = t.intersection([t.type({
    weight: t.number,
}), t.partial({
    dude: DudeSpawn,
    fleet: FleetSpawn,
})]);
export type NpcSpawnEntry = t.TypeOf<typeof NpcSpawnEntry>;

/** One person eligible to appear in this system (the genesis-staged
 * projection of PersData the 5% roll draws from). */
export const PersSpawnEntry = t.intersection([t.type({
    /** PersData id. */
    id: t.string,
    name: t.string,
    subtitle: t.string,
    /** Global shïp id (staged at genesis). */
    ship: t.string,
    govt: t.union([t.string, t.null]),
    /** 1-4 (përs AIType). */
    aiType: t.number,
    /**
     * This person's percent share of the Bible's 5% AI-person window
     * (sÿst Person "% Prob"), so the per-spawn-draw chance of seeing
     * them is 5% x chance%. Systems with no authored Person list
     * spread 100% evenly over their LinkSyst pool, reproducing the
     * Bible's flat 5%.
     */
    chance: t.number,
}), t.partial({
    /**
     * This person's LinkMission is a RESCUE mission (mïsn ShipGoal 5,
     * "Rescue them") — the stock Refuel Traders, mïsn 141/650/651/652.
     * Such a person is stranded by definition, so they are spawned held
     * in the system until their offer is taken: see system_hold.ts for
     * the ruling and maybeSpawnPers for the stamp.
     *
     * Resolved at GENESIS, where the mïsn resource is already being
     * loaded off disk, rather than at spawn time — the simulation must
     * never depend on a getCached hit for a decision. Optional so
     * pre-hold snapshots still decode (absent means "no hold", which is
     * what every other person gets anyway).
     */
    holdsForOffer: t.boolean,
})]);
export type PersSpawnEntry = t.TypeOf<typeof PersSpawnEntry>;

/**
 * Per-system NPC spawner state, attached to a dedicated entity with
 * the deterministic uuid 'npc spawner' (like 'asteroid field').
 */
export const NpcSpawnerType = t.intersection([t.type({
    /** How many NPC ships the system wants alive. */
    targetCount: t.number,
    /** The weighted spawn table (see the module comment). */
    entries: t.array(NpcSpawnEntry),
    /** Sim time (ms) after which the spawner may add a ship. */
    nextSpawn: t.number,
}), t.partial({
    /** The people eligible to appear here (see the module comment).
     * Optional so pre-përs snapshots still decode. */
    persEntries: t.array(PersSpawnEntry),
})]);
export type NpcSpawnerType = t.TypeOf<typeof NpcSpawnerType>;
export const NpcSpawnerComponent = new Component<NpcSpawnerType>('NpcSpawner');

/**
 * Picks an entry from a weighted list with a single Random draw (so
 * the PRNG stream stays in lockstep no matter which entry wins).
 * Returns undefined only for an empty/zero-weight list. The random
 * source is structural so input-record-path callers (mission ships)
 * can pass plain randomness.
 */
export function pickWeighted<T extends { weight: number }>(
    entries: readonly T[], random: { next(): number }): T | undefined {
    const total = entries.reduce((sum, entry) =>
        sum + Math.max(0, entry.weight), 0);
    if (total <= 0) {
        return undefined;
    }
    let roll = random.next() * total;
    for (const entry of entries) {
        roll -= Math.max(0, entry.weight);
        if (roll < 0) {
            return entry;
        }
    }
    return entries[entries.length - 1];
}

/**
 * Whether a fleet's LinkSyst admits it into the given system.
 * `systemGovt` is the spawn system's owning government id (null for
 * independent). The relational ranges (an ally's / an enemy's systems)
 * resolve through govt class numbers, evaluated from the system govt's
 * side: it must list the LinkSyst govt's classes among its allies (or
 * enemies); `systemGovtData`/`linkGovtData` supply those class lists.
 */
export function fleetAllowedInSystem(link: FleetData['linkSyst'],
    systemId: string, systemGovt: string | null,
    systemGovtData: GovtData | undefined,
    linkGovtData: GovtData | undefined): boolean {
    switch (link.type) {
        case 'any':
            return true;
        case 'system':
            return link.id === systemId;
        case 'govtSystems':
            return systemGovt === link.govt;
        case 'notGovtSystems':
            return systemGovt !== link.govt;
        case 'allySystems':
        case 'enemySystems': {
            if (!systemGovtData || !linkGovtData) {
                return false;
            }
            if (systemGovtData.id === linkGovtData.id) {
                // A govt is its own ally and never its own enemy.
                return link.type === 'allySystems';
            }
            const lists = link.type === 'allySystems'
                ? systemGovtData.allies : systemGovtData.enemies;
            return linkGovtData.classes.some(c => lists.includes(c));
        }
    }
}

/**
 * Whether a përs's LinkSyst admits it into the given system. The
 * shared govt-relative cases delegate to fleetAllowedInSystem (the
 * ranges are identical); përs adds 9999 = independent systems.
 */
export function persAllowedInSystem(link: PersData['linkSyst'],
    systemId: string, systemGovt: string | null,
    systemGovtData: GovtData | undefined,
    linkGovtData: GovtData | undefined): boolean {
    if (link.type === 'independentSystems') {
        return systemGovt === null;
    }
    return fleetAllowedInSystem(link, systemId, systemGovt,
        systemGovtData, linkGovtData);
}

/**
 * Stages a ship class's full closure plus a govt, with retries; see
 * the staging contract note in the module comment. Also primes the
 * world's lazily-constructed WeaponEntries for every weapon in the
 * closure — WeaponsSystem gates firing on `weaponEntries.getCached`,
 * so an unprimed entry materializes at a load-timing-dependent tick
 * and each world starts firing that NPC's weapons at a different
 * time (the exact recorded desync class from the weapons work; the
 * live nova:141 pirate-system desync during this feature's bringup
 * was this line missing).
 */
async function stageShip(world: World, shipId: string, govt: string | null) {
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        throw new Error('Expected SimulationGameDataResource to exist');
    }
    const weaponIds = await loadWithRetries(
        () => loadShipGameData(gameData, shipId), `NPC ship ${shipId}`);
    const weaponEntries = world.resources.get(WeaponEntries);
    if (weaponEntries) {
        await Promise.all([...weaponIds].map(id => weaponEntries.get(id)));
    }
    if (govt) {
        await loadWithRetries(() => gameData.data.Govt.get(govt),
            `NPC govt ${govt}`);
    }
}

/**
 * Builds the system's NPC spawn table: resolves the sÿst dude/fleet
 * entries and the roaming LinkSyst fleets, evaluates flët AppearOn and
 * each düde ship class's shïp AppearOn against an empty bit set (see
 * the multiplayer constraint above), and stages every ship class and
 * govt the table can spawn. Reads only genesis-staged data — never a
 * player's bits — so every peer builds the same table.
 */
export async function buildNpcSpawnTable(world: World, systemId: string,
    systemData: SystemData): Promise<NpcSpawnEntry[]> {
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        throw new Error('Expected SimulationGameDataResource to exist');
    }
    const entries: NpcSpawnEntry[] = [];

    // AppearOn: empty bit set (per-player bits cannot drive shared
    // spawns; see the module comment). `Exxx` ("has the player explored
    // system xxx") is left unwired for the same reason and reads false:
    // discovery is per-CLIENT, per-pilot state that lives in the browser
    // (discovery_store.ts), and this table is genesis state every peer
    // must compute identically. Threading the local pilot's record in
    // here would make one player's map knowledge decide what spawns for
    // everybody, and would desync a multiplayer system the moment two
    // pilots with different maps met in it. (Moot in practice: no flët
    // AppearOn in stock or in any installed plug-in uses `Exxx` — see
    // ncb.ts's hasExplored — but the ruling is what keeps it that way.)
    const emptyBits = { getBit: () => false };
    const appears = (fleet: FleetData) => {
        try {
            return evaluateNCBTest(fleet.appearOn, emptyBits);
        } catch (e) {
            console.warn(`Bad AppearOn for fleet ${fleet.id}: ${e}`);
            return false;
        }
    };
    // shïp AppearOn — "Ships of this type will not show up in dude
    // resources if this expression evaluates to false" (Bible ~:2594) —
    // is the same gate one level down, on each of a düde's ship classes,
    // and is read the same way: against the empty set, at genesis, from
    // the ShipData the staging below warms anyway. Under that reading the
    // stock story-beat variants (the Polaris cloaking hulls nova:257-273
    // `b1301`/`b323`..., the `b8888` pirate variants nova:398-404) never
    // spawn, and düde nova:182 — four nova:406 `b1307` — spawns nothing;
    // the negated-bit majority (every `!b333` Fed/Auroran capital ship)
    // spawns as before. A düde left with no ships is dropped like one
    // whose ships cannot load: its weight goes to the rest of the table.
    const shipAppears = (ship: ShipData) => {
        try {
            return evaluateNCBTest(ship.appearOn, emptyBits);
        } catch (e) {
            console.warn(`Bad AppearOn for ship ${ship.id}: ${e}`);
            return false;
        }
    };

    for (const { id, weight } of systemData.dudes) {
        try {
            const dude = await loadWithRetries(
                () => gameData.data.Dude.get(id), `düde ${id}`);
            const ships: Array<{ id: string, weight: number }> = [];
            for (const ship of dude.ships) {
                const shipData = await loadWithRetries(
                    () => gameData.data.Ship.get(ship.id),
                    `NPC ship ${ship.id}`);
                if (!shipAppears(shipData)) {
                    continue;
                }
                await stageShip(world, ship.id, dude.govt);
                ships.push({ id: ship.id, weight: ship.weight });
            }
            if (ships.length > 0) {
                entries.push({
                    weight,
                    dude: { aiType: dude.aiType, govt: dude.govt, ships },
                });
            }
        } catch (e) {
            // A dude that cannot load is dropped on EVERY world (the
            // table is genesis state computed identically everywhere).
            console.warn(`NPC spawn table: dropping düde ${id}: ${e}`);
        }
    }

    const stageFleet = async (fleet: FleetData) => {
        await stageShip(world, fleet.leadShip, fleet.govt);
        for (const escort of fleet.escorts) {
            await stageShip(world, escort.id, fleet.govt);
        }
        return {
            leadShip: fleet.leadShip,
            escorts: fleet.escorts.map(({ id, min, max }) =>
                ({ id, min, max })),
            govt: fleet.govt,
        };
    };

    // Fleets referenced directly by the sÿst DudeTypes table.
    for (const { id, weight } of systemData.fleets) {
        try {
            const fleet = await loadWithRetries(
                () => gameData.data.Fleet.get(id), `flët ${id}`);
            if (!appears(fleet)) {
                continue;
            }
            entries.push({ weight, fleet: await stageFleet(fleet) });
        } catch (e) {
            console.warn(`NPC spawn table: dropping flët ${id}: ${e}`);
        }
    }

    // Roaming fleets: scan every flët's LinkSyst against this system.
    // Sorted ids so the table is identical on every world.
    const systemGovtData = systemData.govt
        ? await gameData.data.Govt.get(systemData.govt).catch(() => undefined)
        : undefined;
    const roaming: FleetData[] = [];
    const fleetIds = [...(await gameData.ids).Fleet].sort();
    for (const fleetId of fleetIds) {
        let fleet: FleetData;
        try {
            fleet = await gameData.data.Fleet.get(fleetId);
        } catch {
            continue;
        }
        const link = fleet.linkSyst;
        const linkGovtData =
            (link.type === 'allySystems' || link.type === 'enemySystems')
                ? await gameData.data.Govt.get(link.govt)
                    .catch(() => undefined)
                : undefined;
        const allowed = fleetAllowedInSystem(link, systemId,
            systemData.govt, systemGovtData, linkGovtData);
        if (allowed && appears(fleet)) {
            roaming.push(fleet);
        }
    }
    for (const fleet of roaming) {
        try {
            entries.push({
                weight: ROAMING_FLEET_WEIGHT / roaming.length,
                fleet: await stageFleet(fleet),
            });
        } catch (e) {
            console.warn(`NPC spawn table: dropping flët ${fleet.id}: ${e}`);
        }
    }

    return entries;
}

/** Maps over `items` with at most `concurrency` calls in flight,
 * preserving order (genesis-time cache warming; see buildPersSpawnTable). */
async function pooledMap<T, R>(items: readonly T[],
    map: (item: T) => Promise<R>, concurrency = 8): Promise<R[]> {
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
 * Builds the system's përs table (see the module comment for where the
 * people come from and what the chances mean): the sÿst Person list
 * when the system has one, otherwise the LinkSyst pool spread evenly.
 * ActiveOn must pass with no bits set either way (the same shared-spawn
 * constraint as flët AppearOn), and every ship class and govt the table
 * can spawn is staged. Resource order (and sorted ids, and order-
 * preserving pooled loads) so the table is identical on every world;
 * the bounded concurrency and per-ship-class dedup keep the fallback
 * scan of several hundred përs resources off the genesis critical path.
 */
export async function buildPersSpawnTable(world: World, systemId: string,
    systemData: SystemData): Promise<PersSpawnEntry[]> {
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        throw new Error('Expected SimulationGameDataResource to exist');
    }

    // ActiveOn under an empty bit set (per-player bits cannot drive
    // shared spawns; nor can `Exxx`, per-player map knowledge — see
    // buildFleetSpawnTable's emptyBits).
    const active = (pers: PersData) => {
        try {
            return !pers.activeOn || evaluateNCBTest(pers.activeOn,
                { getBit: () => false });
        } catch (e) {
            console.warn(`Bad ActiveOn for përs ${pers.id}: ${e}`);
            return false;
        }
    };

    let eligible: Array<{ pers: PersData, chance: number }>;
    if (systemData.persons.length > 0) {
        // The authored cast. LinkSyst is deliberately not consulted
        // (see the module comment: 160 of 228 stock entries would die).
        eligible = (await pooledMap(systemData.persons,
            async ({ id, chance }) => {
                let pers: PersData;
                try {
                    pers = await gameData.data.Pers.get(id);
                } catch (e) {
                    console.warn(`përs table: dropping ${id} listed by `
                        + `${systemId}: ${e}`);
                    return undefined;
                }
                return active(pers) ? { pers, chance } : undefined;
            })).filter((entry): entry is { pers: PersData, chance: number } =>
                entry !== undefined);
    } else {
        const systemGovtData = systemData.govt
            ? await gameData.data.Govt.get(systemData.govt)
                .catch(() => undefined)
            : undefined;
        const persIds = [...(await gameData.ids).Pers].sort();
        const pool = (await pooledMap(persIds, async persId => {
            let pers: PersData;
            try {
                pers = await gameData.data.Pers.get(persId);
            } catch {
                return undefined;
            }
            const link = pers.linkSyst;
            const linkGovtData =
                (link.type === 'allySystems' || link.type === 'enemySystems')
                    ? await gameData.data.Govt.get(link.govt)
                        .catch(() => undefined)
                    : undefined;
            if (!persAllowedInSystem(link, systemId, systemData.govt,
                systemGovtData, linkGovtData)) {
                return undefined;
            }
            return active(pers) ? pers : undefined;
        })).filter((pers): pers is PersData => pers !== undefined);
        // Evenly over the whole 5% window: the Bible's flat rate.
        eligible = pool.map(pers => ({ pers, chance: 100 / pool.length }));
    }

    // Stage each distinct ship-class/govt pair once.
    const staged = new Map<string, Promise<boolean>>();
    const stageOnce = (ship: string, govt: string | null) => {
        const key = `${ship}\0${govt ?? ''}`;
        let promise = staged.get(key);
        if (!promise) {
            promise = stageShip(world, ship, govt)
                .then(() => true, e => {
                    console.warn(`përs table: dropping ships of class `
                        + `${ship}: ${e}`);
                    return false;
                });
            staged.set(key, promise);
        }
        return promise;
    };
    const stagedOk = await pooledMap(eligible,
        ({ pers }) => stageOnce(pers.ship, pers.govt));

    // "Does this person's LinkMission ask to be rescued?" — resolved
    // HERE, where mïsn resources can be awaited, so the spawner never
    // has to consult mission game data (see PersSpawnEntry's
    // holdsForOffer). Deduped per mission id: 63 stock përs share the
    // four Refuel Trader missions.
    const missionIds = [...new Set(eligible
        .map(({ pers }) => pers.linkMission)
        .filter((id): id is string => !!id))].sort();
    const rescueMissions = new Set<string>();
    await pooledMap(missionIds, async missionId => {
        try {
            const mission = await gameData.data.Mission.get(missionId);
            if (mission.shipGoal === GOAL_RESCUE) {
                rescueMissions.add(missionId);
            }
        } catch {
            // Unreadable mïsn: no hold, exactly as for a person with no
            // LinkMission at all.
        }
    });

    return eligible.filter((_, index) => stagedOk[index])
        .map(({ pers, chance }) => ({
            id: pers.id,
            name: pers.name,
            subtitle: pers.subtitle,
            ship: pers.ship,
            govt: pers.govt,
            aiType: pers.aiType,
            chance,
            ...(pers.linkMission && rescueMissions.has(pers.linkMission)
                ? { holdsForOffer: true } : {}),
        }));
}

/** The Bible's chance that a spawn draw also creates a person. */
export const PERS_SPAWN_CHANCE = 0.05;

/**
 * Which person a spawn draw creates, from a single uniform roll in
 * [0, 1) — or undefined for the overwhelmingly common "nobody".
 *
 * The Bible's 5% is the whole AI-person window and each entry's percent
 * chance is its share of it: entry i owns the sub-interval of width
 * 5% x chance_i%, laid end to end in table order, so P(person i) =
 * 0.05 * chance_i / 100 and P(nobody) is whatever is left of the 5%.
 * Chances that sum past 100 (stock data reaches 600) would overflow the
 * window, so they saturate it instead — the window never exceeds 5%,
 * and the entries keep their relative shares.
 *
 * One roll decides both "does anyone appear" and "who", so a spawn
 * attempt consumes exactly one draw whatever the table holds.
 */
export function pickPersEntry<T extends { chance: number }>(
    entries: readonly T[], roll: number): T | undefined {
    const total = entries.reduce((sum, entry) =>
        sum + Math.max(0, entry.chance), 0);
    if (total <= 0) {
        return undefined;
    }
    const scale = PERS_SPAWN_CHANCE / Math.max(100, total);
    let remaining = roll;
    for (const entry of entries) {
        const width = Math.max(0, entry.chance) * scale;
        if (remaining < width) {
            return entry;
        }
        remaining -= width;
    }
    return undefined;
}

/**
 * The Bible's "When ships are created, there is a 5% chance that a
 * specific AI-person will also be created", weighted by the sÿst Person
 * chances (see pickPersEntry and the module comment): rolled on each
 * spawn draw. A person already alive in the system is not duplicated.
 *
 * Deterministic: seeded Random, staged getCached reads, ids from the
 * IdFactory — and structurally EXACTLY ONE draw per spawn attempt, no
 * matter whether the table is empty, the roll picks nobody, or the
 * person picked is already flying around. Only an actual spawn draws
 * further (for placement), exactly as the dude path does.
 */
function maybeSpawnPers(world: World,
    gameData: SimulationGameDataInterface, ids: IdFactory, random: Random,
    persEntries: readonly PersSpawnEntry[], atEdge: boolean): number {
    const pers = pickPersEntry(persEntries, random.next());
    if (!pers) {
        return 0;
    }
    for (const entity of world.entities.values()) {
        if (entity.components.get(PersComponent)?.id === pers.id) {
            // Only one of each person at a time.
            return 0;
        }
    }
    const shipData = gameData.data.Ship.getCached(pers.ship);
    if (!shipData) {
        // Staged at genesis, so a miss is identical on every world.
        return 0;
    }
    let state;
    if (atEdge) {
        state = jumpInState(shipData, random);
    } else {
        state = {
            position: new Position(
                (random.next() * 2 - 1) * INITIAL_SPAWN_HALF_SIZE,
                (random.next() * 2 - 1) * INITIAL_SPAWN_HALF_SIZE),
            rotation: new Angle(random.next() * 2 * Math.PI),
            velocity: new Vector(0, 0),
        };
    }
    const ship = makeNpcShip(shipData, pers.aiType, pers.govt,
        state.position, state.rotation, state.velocity);
    ship.name = pers.name;
    ship.components.set(PersComponent, {
        id: pers.id,
        name: pers.name,
        subtitle: pers.subtitle,
    });
    deriveEntityComponents(world, ship);
    // Drifting Derelict përs belong to the derelict govt (Flags1 0x0800),
    // so they spawn disabled — a hulk drifting in space (the origin of the
    // "; Only show hail quote when disabled" derelict përs flavour).
    applyStartsDisabled(ship, gameData);
    // A person whose LinkMission asks to be RESCUED (a Refuel Trader) is
    // stranded, and stays in this system until somebody takes the offer
    // off their hands — otherwise the radio call the player is flying
    // across the system to answer belongs to a ship that has warped out.
    // See system_hold.ts; released by applyAcceptMission.
    if (pers.holdsForOffer) {
        ship.components.set(SystemHoldComponent, { reason: 'shipOffer' });
    }
    // The 'npc' uuid prefix: a person IS an NPC (population counting,
    // system-furniture checks); the PersComponent is the tag.
    world.entities.set(ids.next('npc'), ship);
    return 1;
}

/** The Bible's "average +/- 50%" population roll. */
export function rollPopulationTarget(avgShips: number,
    random: Random): number {
    if (avgShips <= 0) {
        return 0;
    }
    return Math.min(MAX_NPC_POPULATION,
        Math.max(1, Math.round(avgShips * (0.5 + random.next()))));
}

/**
 * Creates one NPC ship entity. All game data must already be staged;
 * this is synchronous so the respawn system can call it mid-sim.
 */
export function makeNpcShip(shipData: ShipData, aiType: number,
    govt: string | null, position: Position, rotation: Angle,
    velocity: Vector): Entity {
    const npc = new Entity(shipData.name);
    npc.components
        .set(ShipComponent, { id: shipData.id })
        .set(MovementStateComponent, {
            accelerating: 0,
            position,
            rotation,
            turnBack: false,
            turning: 0,
            velocity,
        })
        .set(NpcComponent, {
            aiType: aiType > 0 ? aiType : shipData.inherentAI,
        })
        .set(TargetComponent, { target: undefined })
        .set(DeathAIComponent, undefined);
    if (govt) {
        npc.components.set(GovtComponent, { id: govt });
    }
    return npc;
}

/**
 * Ships of a government with the "start disabled (derelicts)" flag (gövt
 * Flags1 0x0800; the "Derelicts" govt nova:160 that owns the Drifting
 * Derelict përs) spawn as drifting hulks. The existing disable machinery
 * (disabled_plugin.ts) keeps a ship disabled only while its armor is at or
 * below the disable threshold, so this pins the fresh hull's armor to that
 * threshold and drops its shields, then attaches DisabledComponent so the
 * ship reads as disabled from tick 0 (gray target corners, drifting to
 * rest, no thrust/turn/fire, no recharge). repairAt is null — an NPC hulk
 * never self-repairs — so this consumes no Random and is pure genesis
 * state, identical on every peer (a late joiner receives the armor/shield
 * values and DisabledComponent through the wire snapshot). A no-op for
 * ordinary governments, and must run AFTER deriveEntityComponents has
 * provided the armor/shield/ship-data components.
 */
export function applyStartsDisabled(entity: Entity,
    gameData: SimulationGameDataInterface): void {
    const govt = entity.components.get(GovtComponent)?.id;
    if (!govt) {
        return;
    }
    const govtData = gameData.data.Govt.getCached(govt);
    if (govtData === undefined) {
        // The staged-at-genesis contract says every govt a spawn table can
        // produce is cached before spawning. A miss here would silently
        // spawn a would-be derelict ALIVE (the exact bug the hulk feature
        // fixes), so make the contract violation loud (review finding M2).
        console.warn(`applyStartsDisabled: govt ${govt} not cached; `
            + `a starts-disabled ship would spawn alive`);
    }
    const shipData = entity.components.get(ShipDataComponent);
    const physics = entity.components.get(ShipPhysicsComponent);
    if (!shipData || !physics) {
        return;
    }
    applyStartsDisabledData(entity, govtData, {
        disableArmorFraction: shipData.disableArmorFraction,
        armor: physics.armor,
        armorRecharge: physics.armorRecharge,
        shield: physics.shield,
        shieldRecharge: physics.shieldRecharge,
    });
}

/**
 * The data-driven core of {@link applyStartsDisabled}, for spawn paths
 * that hold the govt/ship data directly instead of derived entity
 * components — mission special ships are built client-side and inserted
 * through the input-record path BEFORE any provider system has run, so
 * there is no ShipPhysicsComponent to read yet (the Kontik-probe derelict
 * Aurora flew around happily because this never applied there).
 */
export function applyStartsDisabledData(entity: Entity,
    govtData: GovtData | undefined,
    stats: {
        disableArmorFraction: number,
        armor: number, armorRecharge: number,
        shield: number, shieldRecharge: number,
    }): void {
    if (!govtData?.flags.startsDisabled) {
        return;
    }
    makeHulk(entity, stats);
}

/**
 * Makes a freshly built (not yet inserted) ship a HULK: disabled from
 * tick 0, with FULL shields and armor, and marked so nothing can lift the
 * disable except an external repair.
 *
 * Two callers, two different reasons for the same state:
 *  - gövt Flags1 0x0800, "ships of this govt start out disabled" — the
 *    Drifting Derelicts (applyStartsDisabledData above);
 *  - mïsn ShipGoal 5, "Rescue them (they start out disabled and stay that
 *    way until you board them)" — where it is the MISSION, not the
 *    government, that makes the ship a hulk (mission_ship_spawn).
 *
 * The Bible's "and stay that way" is exactly what the `hulk` flag buys:
 * ShipDisableSystem refuses to re-enable a hulk however healthy its armor
 * is, so only something that DELETES DisabledComponent — a boarding —
 * brings it back online.
 */
export function makeHulk(entity: Entity, stats: {
    armor: number, armorRecharge: number,
    shield: number, shieldRecharge: number,
}): void {
    // deriveEntityComponents provides ShipData/physics but NOT armor or
    // shields (those are provider systems that first run a tick later), so
    // seed proper Stats here to make the hull fully formed at insertion.
    // FULL armor and shields: the original's derelicts read "disabled" yet
    // take a whole hull's worth of shots to destroy (Matthew's playtest
    // observation vs the Kontik Aurora, 2026-08-14) — the disabled state
    // is the `hulk` flag, not a low armor value, and ShipDisableSystem
    // leaves a hulk disabled regardless of its armor. The provider systems
    // preserve `current` on the next tick (armor?.current ?? physics.armor);
    // recharge stays suspended while disabled.
    entity.components.set(ArmorComponent, new Stat({
        current: stats.armor,
        max: stats.armor,
        min: 0,
        recharge: stats.armorRecharge,
    }));
    entity.components.set(ShieldComponent, new Stat({
        current: stats.shield,
        max: stats.shield,
        min: -stats.shield * 0.05,
        recharge: stats.shieldRecharge,
    }));
    // Disabled from tick 0 (repairAt null: an NPC hulk never self-repairs,
    // so no Random is drawn — pure, peer-identical genesis state).
    entity.components.set(DisabledComponent, { repairAt: null, hulk: true });
}

/** Jump-in kinematics: where an arriving NPC appears and how it moves
 * (mirrors jump_plugin's arrival: outside the no-jump zone, coasting
 * inward at top speed). The random source is structural so callers on
 * the input-record path (mission ships) can pass plain randomness. */
export function jumpInState(shipData: ShipData,
    random: { next(): number }) {
    const bearing = new Angle(random.next() * 2 * Math.PI);
    const inward = bearing.getUnitVector().scale(-1);
    const arrivalDistance = JUMP_DISTANCE
        + shipData.physics.speed * JUMP_ARRIVAL_MARGIN_S;
    return {
        position: new Position(bearing.getUnitVector().x * arrivalDistance,
            bearing.getUnitVector().y * arrivalDistance),
        rotation: inward.angle,
        velocity: inward.scale(shipData.physics.speed),
    };
}

/**
 * Spawns one draw from the spawn table: a single dude ship, or a whole
 * fleet (lead + escorts in formation slots). `atEdge` selects jump-in
 * kinematics (respawns) vs. scattered in-system placement (genesis).
 * Deterministic: seeded Random only, ids from the IdFactory, and
 * getCached reads staged at genesis.
 *
 * NPCs are inserted FULLY FORMED (deriveEntityComponents, from the
 * staged caches) rather than left for the provider systems to fill in.
 * This is a determinism requirement, not an optimization: a bare ship
 * joins each system's query cache when its derived components attach
 * (a tick or two after insertion), so it iterates AFTER any
 * already-formed ship even if it sits earlier in the entity map. A
 * world restored from a wire snapshot rebuilds its caches in entity-
 * map order, so the two worlds would fire weapons (and consume Random)
 * in different orders — a divergence the wire-snapshot lockstep test
 * caught when genesis NPCs first landed.
 */
export function spawnNpc(world: World,
    gameData: SimulationGameDataInterface, ids: IdFactory, random: Random,
    entries: NpcSpawnEntry[], atEdge: boolean,
    persEntries: readonly PersSpawnEntry[] = []): number {
    const entities = world.entities;
    // Each spawn draw may also create a unique person (see
    // maybeSpawnPers); rolled first so the draw count per spawn stays
    // fixed regardless of what the dude/fleet pick does.
    const spawnedPers = maybeSpawnPers(world, gameData, ids, random,
        persEntries, atEdge);
    const entry = pickWeighted(entries, random);
    if (!entry) {
        return spawnedPers;
    }
    const insert = (uuid: string, entity: Entity) => {
        deriveEntityComponents(world, entity);
        // Derelict-govt ships spawn disabled (gövt Flags1 0x0800).
        applyStartsDisabled(entity, gameData);
        entities.set(uuid, entity);
    };

    const scatter = () => new Position(
        (random.next() * 2 - 1) * INITIAL_SPAWN_HALF_SIZE,
        (random.next() * 2 - 1) * INITIAL_SPAWN_HALF_SIZE);

    if (entry.dude) {
        const choice = pickWeighted(entry.dude.ships, random);
        if (!choice) {
            return spawnedPers;
        }
        const shipData = gameData.data.Ship.getCached(choice.id);
        if (!shipData) {
            // Staged at genesis, so a miss is identical on every world.
            return spawnedPers;
        }
        let state;
        if (atEdge) {
            state = jumpInState(shipData, random);
        } else {
            state = {
                position: scatter(),
                rotation: new Angle(random.next() * 2 * Math.PI),
                velocity: new Vector(0, 0),
            };
        }
        insert(ids.next('npc'), makeNpcShip(shipData,
            entry.dude.aiType, entry.dude.govt,
            state.position, state.rotation, state.velocity));
        return spawnedPers + 1;
    }

    if (!entry.fleet) {
        return spawnedPers;
    }
    const fleet = entry.fleet;
    const leadData = gameData.data.Ship.getCached(fleet.leadShip);
    if (!leadData) {
        return spawnedPers;
    }
    let leadState;
    if (atEdge) {
        leadState = jumpInState(leadData, random);
    } else {
        leadState = {
            position: scatter(),
            rotation: new Angle(random.next() * 2 * Math.PI),
            velocity: new Vector(0, 0),
        };
    }
    const leadUuid = ids.next('npc');
    const leadShip = makeNpcShip(leadData, 0, fleet.govt,
        leadState.position, leadState.rotation, leadState.velocity);
    // The whole fleet shares one firing group so members' weapons pass
    // through each other (see firing_group.ts): in the original game an
    // NPC and its escorts simply cannot hit each other, so a stray
    // escort shot must never turn the leader hostile to its own fleet.
    leadShip.components.set(FiringGroupComponent, { group: leadUuid });
    insert(leadUuid, leadShip);
    let spawned = spawnedPers + 1;
    let slot = 0;
    for (const escort of fleet.escorts) {
        const count = escort.min
            + random.below(Math.max(1, escort.max - escort.min + 1));
        const escortData = gameData.data.Ship.getCached(escort.id);
        if (!escortData) {
            continue;
        }
        for (let i = 0; i < count; i++) {
            // Escorts materialize already sitting in their slots.
            const slotPosition = formationSlotPosition(
                leadState.position, leadState.rotation, slot);
            const escortEntity = makeNpcShip(escortData, 0, fleet.govt,
                slotPosition, leadState.rotation,
                Vector.fromVectorLike(leadState.velocity));
            escortEntity.components.set(FormationComponent, {
                leader: leadUuid,
                slot,
            });
            escortEntity.components.set(FiringGroupComponent,
                { group: leadUuid });
            insert(ids.next('npc'), escortEntity);
            slot++;
            spawned++;
        }
    }
    return spawned;
}

/**
 * Genesis entry point: rolls the population target, builds and stages
 * the spawn table, spawns the initial population scattered through the
 * system, and installs the spawner entity that keeps it topped up.
 * Call from makeSystem before the world steps.
 */
export async function spawnNpcs(world: World, systemId: string,
    systemData: SystemData) {
    const gameData = world.resources.get(SimulationGameDataResource);
    const random = world.resources.get(RandomResource);
    const ids = world.resources.get(IdFactoryResource);
    if (!gameData || !random || !ids) {
        throw new Error('Expected game data, random, and id factory resources');
    }

    const entries = await buildNpcSpawnTable(world, systemId, systemData);
    const persEntries = await buildPersSpawnTable(world, systemId, systemData);
    const targetCount = entries.length === 0 ? 0
        : rollPopulationTarget(systemData.avgShips, random);

    let population = 0;
    // Fleets can overshoot the target by their escort count; that's
    // the Bible's own behavior (a fleet arrives whole) and the excess
    // decays as ships depart.
    for (let guard = 0; population < targetCount && guard < 100; guard++) {
        population += spawnNpc(world, gameData, ids, random, entries,
            false, persEntries);
    }

    const spawner = new Entity('npc spawner')
        .addComponent(NpcSpawnerComponent, {
            targetCount,
            entries,
            nextSpawn: 0,
            persEntries,
        });
    world.entities.set('npc spawner', spawner);
}

const LiveNpcsQuery = new Query([NpcComponent] as const);

/**
 * Replaces departed/destroyed NPCs one at a time, jumping in at the
 * system edge, until the population is back at target. Mirrors
 * AsteroidRespawnSystem.
 */
const NpcRespawnSystem = new System({
    name: 'NpcRespawnSystem',
    args: [NpcSpawnerComponent, LiveNpcsQuery, TimeResource, GetWorld,
        RandomResource, IdFactoryResource,
        SimulationGameDataResource] as const,
    step(spawner, liveNpcs, time, world, random, ids, gameData) {
        if (time.time < spawner.nextSpawn
            || liveNpcs.length >= spawner.targetCount) {
            return;
        }
        spawner.nextSpawn = time.time + NPC_RESPAWN_INTERVAL_MS;
        spawnNpc(world, gameData, ids, random, spawner.entries, true,
            spawner.persEntries ?? []);
    },
    // After TimeSystem for the same late-join determinism reason as
    // AsteroidMotionSystem.
    after: [TimeSystem],
});

export const NpcSpawnPlugin: Plugin = {
    name: 'NpcSpawnPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(NpcSpawnerComponent, NpcSpawnerType);
        world.addSystem(NpcRespawnSystem);
    },
};
