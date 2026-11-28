import { GovtData } from 'novadatainterface/govt_data';
import { ShipData } from 'novadatainterface/ship_data';
import { Position, wrapNearestDelta } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Random } from 'nova_ecs/plugins/random_plugin';
import { govtDisposition } from '../reputation/index.js';
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
 * 13, "Shuttles and T1 traders, wave 15" and "Shuttles wave 16"):
 *  - a shuttle ARRIVES like any traffic, by jump-in (wave 15: all five
 *    came in from the screen edge), and then NEVER LEAVES: it does not
 *    jump out (N2: 0 of 154 tracks) and it does not land (wave 15: five
 *    shuttles for 17 minutes, none vanished). So shuttles that a system's
 *    respawns draw stay for good and, as the other traffic comes and
 *    goes, end up holding every traffic slot (wave 15: avgShips 6, half
 *    the draws shuttles; no trader in the system after 2 minutes, none for
 *    the 17 minutes after). That is the original's behaviour and NovaJS
 *    keeps it. Wave 16 watched 19.5 more minutes: still none left. (In
 *    stock Sol the AI 4 interceptors stay too, npc_decision.ts, so the
 *    slots end up with shuttles AND interceptors: wave 16, "Stock Sol");
 *  - "never leaves" is for a shuttle with a lane of TWO stops. With only
 *    ONE stop it behaves like a short-stay trader: in, one pause of about
 *    6 s at the stop (SHUTTLE_ONE_STOP_DWELL_MS; wave 16: 5-7 s over 20
 *    tracks), and out by jump. With NONE (every stellar an enemy's) it
 *    never comes in (wave 16, radar only): here it jumps out at once;
 *  - its stops are the system's stellars that are not an ENEMY govt's:
 *    its own govt's, a neutral govt's and an uninhabited, non-landable
 *    marker (`shuttleStops`);
 *  - it keeps ONE LANE, back and forth between two stops, turning round
 *    about 70 px short of each stellar's centre, between the two sprites
 *    (SHUTTLE_TURN_DISTANCE; wave 16: 73-75 px), after a pause of about
 *    4 s (SHUTTLE_DWELL_MS; the measured median 3.7 s);
 *  - so a lane under about 2 x 70 px leaves no room between its two turn
 *    points, and the shuttle STANDS STILL between the stellars (wave 16:
 *    two of four shuttles, on lanes of 152 and 155 px, sat at the midpoint
 *    for 10-19 minutes). Here the two turn points of such a lane lie
 *    within SHUTTLE_ARRIVE_RADIUS of each other, so the shuttle "arrives"
 *    at the next one where it sits, and pauses again;
 *  - the lane is a stellar and its NEAREST neighbour (wave 16, an uneven
 *    rig with the player off the centre: every lane ran from a stellar to
 *    the stop nearest it; list order and the player's stellar play no
 *    part). The first stop is one draw among the stops, and the lane's
 *    other end is the stop nearest to it (`shuttleLaneEnd`; a tie is one
 *    more draw: GUESS, the rigs' ties were not followed one by one).
 *
 * In the AI 1/2 trader loop (npc_decision.ts) a shuttle hull flies
 * `destination` -> `laneEnd`, swapping the two at the end of each stop;
 * NpcSteeringSystem (npc_steering.ts) steers a ship with a `laneEnd` to
 * the turn point and pauses it SHUTTLE_DWELL_MS.
 */

/** How long a shuttle pauses at each end of its lane (wave 15: median 3.7 s
 * over 155 turns, 10-90% 1.1-6.2 s; "about 4 s"). */
export const SHUTTLE_DWELL_MS = 4_000;
/** How long a shuttle with ONE stop pauses there before it leaves
 * (reference "Shuttles wave 16", Kit Lane One: 20 tracks, a stop of 5-7 s,
 * median about 6 s). */
export const SHUTTLE_ONE_STOP_DWELL_MS = 6_000;
/** A shuttle turns this far short of a stop's centre, on the line to the
 * lane's other end (wave 15: "about 70 px short of each stellar's centre,
 * between the two sprites, never over a planet"). */
export const SHUTTLE_TURN_DISTANCE = 70;
/** A shuttle has reached its turn point within this distance (and below
 * the trader's arrival speed). Fitted: well inside the 70 px, so the turn
 * stays between the sprites. */
export const SHUTTLE_ARRIVE_RADIUS = 30;
/** A pausing shuttle brakes until it is slower than this (px/s): to a
 * standstill, so a shuttle on a lane too short to fly sits still between
 * the stellars (reference "Shuttles wave 16": 10-19 minutes in place).
 * A trader's park leaves up to 10 px/s of drift. */
export const SHUTTLE_REST_SPEED = 0.01;

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
 * The other end of a shuttle's lane whose first stop is `from`: the stop
 * nearest to it (exact squared distances over genesis positions), with a
 * tie broken by one draw among the tied stops in uuid order; `from`
 * itself, with no draw, when it is the only stop (a lane of one stop: one
 * visit, then the shuttle leaves). No draw at all unless there is a tie.
 * The nearest-neighbour rule is MEASURED (reference "Shuttles wave 16");
 * the tie's draw is a GUESS (see the header).
 */
export function shuttleLaneEnd(stops: readonly PlanetEntry[], from: string,
    random: Random): string {
    const start = stops.find(([uuid]) => uuid === from);
    if (!start) {
        return from;
    }
    const origin = start[1].position;
    let best = Infinity;
    let nearest: string[] = [];
    for (const [uuid, movement] of stops) {
        if (uuid === from) {
            continue;
        }
        const dx = wrapNearestDelta(movement.position.x - origin.x);
        const dy = wrapNearestDelta(movement.position.y - origin.y);
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
            best = d2;
            nearest = [uuid];
        } else if (d2 === best) {
            nearest.push(uuid);
        }
    }
    if (nearest.length === 0) {
        return from;
    }
    nearest.sort();
    return nearest.length === 1 ? nearest[0]!
        : nearest[random.below(nearest.length)]!;
}

/**
 * Where a shuttle bound for the stop at `stop` turns round: SHUTTLE_TURN_DISTANCE
 * short of its centre on the line to `laneEnd` (the lane's other end), or
 * on the line to the shuttle itself when there is no other end (a lane of
 * one stop, or the other end gone). Never more than half way to the other
 * end, so on a lane under 2 x SHUTTLE_TURN_DISTANCE the two turn points
 * close up near the midpoint, within SHUTTLE_ARRIVE_RADIUS of each other
 * from about 2 x 70 + 30 px down, and the shuttle stands still there
 * (reference "Shuttles wave 16"). Pure geometry.
 */
export function shuttleTurnPoint(stop: Position, laneEnd: Position | undefined,
    ship: Position): Position {
    const toward = (laneEnd !== undefined
        && laneEnd.subtract(stop).lengthSquared > 0)
        ? laneEnd : ship;
    const offset = Vector.fromVectorLike(toward.subtract(stop));
    const distance = offset.length;
    if (distance === 0) {
        return stop;
    }
    const laneLength = toward === laneEnd ? distance : Infinity;
    return stop.add(offset.normalize(
        Math.min(SHUTTLE_TURN_DISTANCE, laneLength / 2)));
}
