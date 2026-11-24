import { GovtData } from 'novadatainterface/govt_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { govtDisposition } from '../reputation/index.js';
import { PlanetDataComponent } from '../travel/index.js';
import type { PlanetEntry } from './npc_decision.js';

/**
 * ============================================================================
 * In-system shuttles (shïp Flags3 0x0002 without a mining scoop)
 * ============================================================================
 *
 * EVN Bible, shïp Flags3 0x0002: "Ship scoops asteroid debris (requires a
 * mining scoop outfit in DefaultItems); if not, the ship will instead
 * shuttle back and forth between friendly stellars in the system". The
 * parser folds the two halves together (ShipAIFlags
 * `shuttlesBetweenStellars`: the bit set and no mining scoop among the
 * DefaultItems). Stock: shïp 391 Shuttle, 392 Heavy Shuttle, 393 Cargo
 * Drone, 394 Sprite, in AI 1 düdes 247-250.
 *
 * Measured (docs/reference_experiments.md, "N2: in-system shuttles", wave
 * 13: 584 s against a control run of the same hull without the flag):
 *  - a shuttle NEVER JUMPS, in or out (0 of 154 tracks; the control's
 *    traders: 54 out, 32 in);
 *  - it shuttles between the system's stellars, INCLUDING an uninhabited,
 *    non-landable marker;
 *  - it NEVER goes to a stellar of an enemy govt.
 *
 * So, in the AI 1/2 trader loop (npc_decision.ts), a shuttle hull:
 *  - picks its stops among `shuttleStops`, not the landing destinations;
 *  - when its stay is up, LANDS at the end of a stop (it is removed beside
 *    the stellar) instead of flying out to jump;
 *  - when it respawns it TAKES OFF from a stop (npc_spawn_plugin.ts's
 *    respawn places it on one) instead of jumping in.
 *
 * The landing is NOT measured. The reference only says no jump was seen
 * and that a landing could not be told apart from discs overlapping over
 * the port. It is here because a shuttle that never leaves would, in a
 * system with mixed traffic (stock Sol: 30% shuttles), slowly take every
 * traffic slot as the other ships come and go. To measure: whether, and
 * when, a shuttle lands for good (see docs/npc_behavior_gaps.md,
 * "Shuttles and miners: guesses to measure").
 */

/** Whether `ship` is an in-system shuttle (Flags3 0x0002, no scoop). */
export function isShuttle(ship: Pick<ShipData, 'aiFlags'>): boolean {
    return ship.aiFlags.shuttlesBetweenStellars;
}

/**
 * Whether a stellar owned by `stellarGovt` (null: independent) is a stop
 * for a shuttle of `shipGovt`: anything but an ENEMY's (govtDisposition,
 * the political rule; measured: the enemy govt's port was never visited).
 * Independent stellars, uninhabited ones included, are always stops.
 */
export function friendlyStellar(shipGovt: GovtData | undefined,
    stellarGovt: string | null,
    govtOf: (id: string) => GovtData | undefined): boolean {
    if (stellarGovt === null) {
        return true;
    }
    return govtDisposition(shipGovt, govtOf(stellarGovt)) !== 'enemy';
}

/**
 * The stellars a shuttle of `shipGovt` flies between: every stellar that
 * is not a hypergate or a wormhole (transit portals, not places; GUESS,
 * the rig had none) and not owned by an enemy govt. Unlike the traders'
 * landingDestinations, NOT limited to landable ports: the measured
 * shuttles stopped at the uninhabited marker too.
 *
 * Pure over genesis state (PlanetDataComponent) and the govt cache, which
 * make_system stages whole on every peer; no PRNG.
 */
export function shuttleStops(planets: readonly PlanetEntry[],
    shipGovt: GovtData | undefined,
    govtOf: (id: string) => GovtData | undefined): PlanetEntry[] {
    return planets.filter(([, , , data]) => !data.gate
        && friendlyStellar(shipGovt, data.govt, govtOf));
}

/**
 * The world's stellars as PlanetEntry rows, sorted by uuid, for callers
 * outside a system's query (the respawn path, npc_spawn_plugin.ts).
 */
export function stellarEntries(
    entities: Iterable<readonly [string, Entity]>): PlanetEntry[] {
    const out: Array<readonly [string, MovementState, unknown, PlanetData]> = [];
    for (const [uuid, entity] of entities) {
        const data = entity.components.get(PlanetDataComponent);
        const movement = entity.components.get(MovementStateComponent);
        if (data && movement) {
            out.push([uuid, movement, undefined, data] as const);
        }
    }
    return out.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}
