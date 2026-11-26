import * as t from 'io-ts';
import { SystemData } from 'novadatainterface/system_data';
import { Emit, Entities, GetWorld, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { IdFactoryResource, SimulationGameDataResource } from '../core/index.js';
import { NpcComponent, SystemHoldComponent } from '../npc/index.js';
import {
    ControlledByComponent, DominatedComponent, DominatedType, withDominated,
} from '../player/index.js';
import {
    ExplodingComponent, StellarDefenderComponent, StellarDefenderType,
} from '../ship/index.js';
import {
    DefenseFleet, DefenseFleetComponent, DefenseFleetType, defenseWaveCap,
    PlanetComponent, PlanetDataComponent, stellarTakesDemands,
} from '../travel/index.js';
import {
    DudeSpawn, insertNpc, makeNpcShip, NpcRespawnSystem, pickWeighted,
    stageDudeSpawn,
} from './npc_spawn_plugin.js';
import { ReinforcementArrivalSystem } from './reinforcements.js';

/**
 * ============================================================================
 * A stellar's DEFENCE FLEET in flight (#353 section 1)
 * ============================================================================
 *
 * The fleet a demand for tribute sends (encounters/tribute.ts has the
 * rules, the measurements and Matthew's ruling): staged at genesis
 * (stageDefenseFleets, from the spöb DefenseDude / DefCount), launched
 * from its stellar up to the cap, stood down when nobody demanding is left
 * in the system, and, once the whole DefCount total has been destroyed,
 * DOMINATED by every demander (StellarDominatedEvent). Its shared state is
 * travel/defense_fleet.ts's DefenseFleet on the stellar's entity; its ships
 * carry ship/stellar_defender.ts's marker and think with
 * npc/npc_decision.ts's defenderDecision.
 *
 * Here rather than beside the hail (encounters) because it spawns NPCs:
 * it runs in the traffic spawners' chain (after the reinforcement
 * arrival), which the mission-ship tracking orders itself after.
 *
 * Determinism: synced state, staged caches, the seeded Random (two draws a
 * launch: the ship class and the bearing), ids from the IdFactory, sorted
 * lists and uuid-ordered sweeps.
 */

/**
 * GUESS: the first defender comes up this long after the demand
 * (MEASURED, wave 39: "all six up 1.8 s after the channel closed", the
 * dialog pausing the game there; it does not pause here).
 */
export const DEFENSE_FIRST_LAUNCH_MS = 1_800;

/** GUESS: one defender takes off every this long while the fleet is
 * under its cap (the original launched a wave at once; this staggers them
 * so they do not overlap on the stellar's centre). */
export const DEFENSE_LAUNCH_INTERVAL_MS = 300;


/** A stellar's defence fleet, staged at genesis: its düde and its total. */
export interface StagedDefenseFleet {
    dude: DudeSpawn;
    /** PlanetData.defense.count: the ships to beat. */
    count: number;
}

/**
 * Every defence fleet of the system's stellars, by stellar ENTITY uuid
 * (`planet <spöb id>`). Static genesis data, identical on every peer,
 * never mutated.
 */
export const DefenseFleetsResource =
    new Resource<ReadonlyMap<string, StagedDefenseFleet>>('DefenseFleets');

/** The stellar entity uuid make_system gives a spöb. */
export function planetEntityUuid(planetId: string): string {
    return `planet ${planetId}`;
}

/**
 * Stages the defence fleet of every stellar in `systemData` that has one
 * and takes demands (spöb DefenseDude / DefCount: PlanetData.defense):
 * each düde's ship classes, their weapons and the düde's govt. Genesis
 * only; a düde with no ship class gives its stellar no fleet.
 */
export async function stageDefenseFleets(world: World,
    systemData: SystemData): Promise<Map<string, StagedDefenseFleet>> {
    const gameData = world.resources.get(SimulationGameDataResource);
    const fleets = new Map<string, StagedDefenseFleet>();
    if (!gameData) {
        return fleets;
    }
    const staged = await Promise.all(systemData.planets.map(async id => {
        const planet = await gameData.data.Planet.get(id);
        if (!planet.defense || !stellarTakesDemands(planet)) {
            return undefined;
        }
        const dude = await stageDudeSpawn(world, planet.defense.dude);
        return dude ? [planetEntityUuid(id),
            { dude, count: planet.defense.count }] as const : undefined;
    }));
    for (const entry of staged) {
        if (entry) {
            fleets.set(entry[0], entry[1]);
        }
    }
    return fleets;
}

// --- The fleet ---

/**
 * Emitted at a player ship when the defence fleet he was fighting has been
 * destroyed and the stellar is now his (Matthew's ruling: every demander
 * dominates at the defeat). The display prints the stellar's acceptance,
 * "All right, all right already!  The planet agrees to pay you tribute."
 * (STR# 3002 25; a station's 26), on his status line.
 */
export interface StellarDominatedEventData {
    planet: string;
    station: boolean;
}
export const StellarDominatedEventType = t.type({
    planet: t.string,
    station: t.boolean,
});
export const StellarDominatedEvent =
    new EcsEvent<StellarDominatedEventData>('StellarDominatedEvent');
registerSimulationBridgeEvent({ event: StellarDominatedEvent });

/** Every stellar with a fleet record. */
const FleetPlanetsQuery = new Query([UUID, PlanetComponent,
    PlanetDataComponent, DefenseFleetComponent,
    MovementStateComponent] as const);
/** Every defence ship. */
const DefendersQuery = new Query([UUID, StellarDefenderComponent,
    NpcComponent, Optional(ExplodingComponent)] as const);
/** Every player ship. */
const PlayerShipsQuery = new Query([UUID, ControlledByComponent] as const);

type DefenderRow = readonly [string, { planet: string, player?: string },
    { mode?: string }, unknown];

/**
 * The demander a newly launched (or orphaned) defender is assigned to:
 * the one with the fewest live defenders assigned, the lower uuid on a tie
 * (the ruling's "an equal (if possible) number of ships should prioritize
 * attacking each player"). `demanders` is sorted.
 */
export function leastDefended(demanders: readonly string[],
    assigned: ReadonlyMap<string, number>): string | undefined {
    let best: string | undefined;
    let bestCount = Infinity;
    for (const demander of demanders) {
        const count = assigned.get(demander) ?? 0;
        if (count < bestCount) {
            best = demander;
            bestCount = count;
        }
    }
    return best;
}

/**
 * Launches one defender of `staged` from the stellar at `at`, assigned to
 * `player`: a ship class drawn by weight, a bearing drawn, the ship placed
 * on the stellar's centre flying out along the bearing at half its top
 * speed (GUESS: the original's defenders appear at the stellar).
 * Two Random draws.
 */
function launchDefender(world: World, planetUuid: string,
    at: Position, staged: StagedDefenseFleet, player: string): boolean {
    const gameData = world.resources.get(SimulationGameDataResource);
    const random = world.resources.get(RandomResource);
    const ids = world.resources.get(IdFactoryResource);
    if (!gameData || !random || !ids) {
        return false;
    }
    const choice = pickWeighted(staged.dude.ships, random);
    const bearing = new Angle(random.next() * 2 * Math.PI);
    const shipData = choice ? gameData.data.Ship.getCached(choice.id)
        : undefined;
    if (!shipData) {
        // Staged at genesis, so a miss is the same on every world.
        return false;
    }
    const ship = makeNpcShip(shipData, staged.dude.aiType, staged.dude.govt,
        at, bearing, bearing.getUnitVector().scale(shipData.physics.speed / 2));
    ship.components.set(StellarDefenderComponent,
        { planet: planetUuid, player });
    ship.components.set(SystemHoldComponent, { reason: 'defense' });
    insertNpc(world, gameData, ids.next('npc'), ship);
    return true;
}

/**
 * THE DEFENCE FLEETS, every tick, for each stellar with a fleet record
 * (see the module comment and travel/defense_fleet.ts):
 *
 *  1. Demanders no longer in the system (jumped out, landed, gone) drop
 *     out.
 *  2. With nobody left demanding, the fleet STANDS DOWN ("jumping away
 *     stops the ships spawning and resets it"): its live ships lose their
 *     assignment and fly home (npc_decision.ts's defender branch), each
 *     removed as it reaches the stellar (GUESS: lands); the count resets
 *     to the ships still out, so a fresh demand faces the whole fleet.
 *  3. Otherwise every live defender without a current demander is
 *     reassigned; when the whole fleet has launched and none is left, the
 *     stellar is DOMINATED by every demander (StellarDominatedEvent each)
 *     and the record is cleared; else, under the cap and past
 *     `nextLaunch`, one more defender launches.
 *
 * Synced state, the seeded Random (launchDefender) and sorted lists only.
 */
export const DefenseFleetSystem = new System({
    name: 'DefenseFleetSystem',
    args: [FleetPlanetsQuery, DefendersQuery, PlayerShipsQuery, TimeResource,
        Optional(DefenseFleetsResource), Entities, GetWorld, Emit] as const,
    step(planets, defenders, players, time, staged, entities, world, emit) {
        const present = new Set(players.map(([uuid]) => uuid));
        for (const [planetUuid, planet, planetData, fleet, movement]
            of planets) {
            const mine = defenders.filter(([, marker]) =>
                marker.planet === planetUuid) as DefenderRow[];
            const alive = mine.filter(([, , , exploding]) =>
                exploding === undefined);
            const stillHere = fleet.demanders.filter(uuid => present.has(uuid));
            if (stillHere.length !== fleet.demanders.length) {
                fleet.demanders = stillHere;
            }
            if (fleet.demanders.length === 0) {
                standDown(fleet, alive, entities);
                if (fleet.launched === 0) {
                    // Nothing out and nobody demanding: no record at all.
                    entities.get(planetUuid)?.components
                        .delete(DefenseFleetComponent);
                }
                continue;
            }
            assignDefenders(fleet, alive);
            const fleetData = staged?.get(planetUuid);
            const total = fleetData?.count ?? 0;
            if (fleet.launched >= total && alive.length === 0) {
                for (const demander of fleet.demanders) {
                    const player = entities.get(demander);
                    if (player) {
                        player.components.set(DominatedComponent,
                            withDominated(player.components
                                .get(DominatedComponent), planet.id));
                        emit(StellarDominatedEvent, {
                            planet: planet.id,
                            station: planetData.flags.isStation,
                        }, [demander]);
                    }
                }
                fleet.demanders = [];
                fleet.launched = 0;
                continue;
            }
            if (!fleetData || fleet.launched >= total
                || alive.length >= defenseWaveCap(fleet.demanders.length)
                || time.time < fleet.nextLaunch) {
                continue;
            }
            const assigned = assignedCounts(alive);
            const player = leastDefended(fleet.demanders, assigned)!;
            if (launchDefender(world, planetUuid,
                Position.fromVectorLike(movement.position), fleetData,
                player)) {
                fleet.launched++;
            }
            fleet.nextLaunch = time.time + DEFENSE_LAUNCH_INTERVAL_MS;
        }
    },
    // Spawns and removes NPCs like the traffic's respawn and the
    // reinforcement arrival, and runs right after them (shared: *);
    // MissionShipTrackSystem follows all three.
    after: [TimeSystem, NpcRespawnSystem, ReinforcementArrivalSystem],
});

/** How many live defenders each demander has assigned. */
function assignedCounts(alive: readonly DefenderRow[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [, marker] of alive) {
        if (marker.player !== undefined) {
            counts.set(marker.player, (counts.get(marker.player) ?? 0) + 1);
        }
    }
    return counts;
}

/** Gives every live defender whose player is no longer demanding (or that
 * was flying home) the least-defended demander, in uuid order. */
function assignDefenders(fleet: DefenseFleet, alive: readonly DefenderRow[]) {
    const counts = assignedCounts(alive);
    for (const [, marker] of [...alive].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0)) {
        if (marker.player !== undefined
            && fleet.demanders.includes(marker.player)) {
            continue;
        }
        if (marker.player !== undefined) {
            counts.set(marker.player, (counts.get(marker.player) ?? 1) - 1);
        }
        const player = leastDefended(fleet.demanders, counts)!;
        marker.player = player;
        counts.set(player, (counts.get(player) ?? 0) + 1);
    }
}

/** The fleet with nobody demanding: everything still out flies home and
 * lands; the count is what is still out. */
function standDown(fleet: DefenseFleet, alive: readonly DefenderRow[],
    entities: { delete(uuid: string): boolean }) {
    let out = 0;
    for (const [uuid, marker, npc] of alive) {
        if (marker.player !== undefined) {
            delete marker.player;
        }
        if (npc.mode === 'dwell') {
            // Home: it lands (GUESS), and is gone.
            entities.delete(uuid);
            continue;
        }
        out++;
    }
    if (fleet.launched !== out) {
        fleet.launched = out;
    }
}

export const DefenseFleetPlugin: Plugin = {
    name: 'DefenseFleetPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        // Synced state the display reads: the IFF (a defender's marker,
        // its stellar's demanders), the hail dialog (the demanders, the
        // pilot's dominated stellars) and the player-info Income line.
        deltaMaker.addComponent(StellarDefenderComponent, {
            componentType: StellarDefenderType,
        });
        deltaMaker.addComponent(DefenseFleetComponent, {
            componentType: DefenseFleetType,
        });
        deltaMaker.addComponent(DominatedComponent, {
            componentType: DominatedType,
        });
        world.resources.get(SerializerResource)?.addEvent(
            StellarDominatedEvent, StellarDominatedEventType);
        world.addSystem(DefenseFleetSystem);
    },
};
