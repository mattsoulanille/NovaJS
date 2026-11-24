import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { WeaponData } from 'novadatainterface/weapon_data';
import { chooseNearest } from './npc_targeting.js';

/**
 * ============================================================================
 * NPC mining (shïp Flags3 0x0001 / 0x0002)
 * ============================================================================
 *
 * EVN Bible, shïp Flags3: 0x0001 "Ship destroys asteroids"; 0x0002 "Ship
 * scoops asteroid debris (requires a mining scoop outfit in
 * DefaultItems)". The Bible says nothing about how a miner behaves; the
 * reference does (docs/reference_experiments.md, "N1: does the Asteroid
 * Miner mine?", wave 13, a copy of the stock Asteroid Miner shïp 379:
 * AI 1, Flags3 0x0003, the Asteroid Scoop and four Mining Blasters): two
 * miners CLOSE ON A ROCK, FIRE at it, it BREAKS into debris, a miner FLIES
 * OVER THE DEBRIS; the trails loop between rocks rather than flying the
 * trader's straight legs; and the miners LEAVE by jumping out like other
 * traffic.
 *
 * Here (docs/npc_behavior_gaps.md's definition of a miner):
 *  - A MINER is an AI 1 or AI 2 ship (a trader: the stock miner flies in
 *    Civvies trader düdes) whose hull has Flags3 0x0001 and that mounts a
 *    weapon with a bounded reach. It shoots rocks (mode 'mine').
 *  - It SCOOPS (mode 'scoop') when its hull also has Flags3 0x0002 and it
 *    carries a mining scoop (oütf ModType 31). The scooping itself is
 *    ScoopSystem's (combat/asteroid_plugin.ts), for any ship that runs over
 *    a box; the miner only steers there.
 *  - Debris first, then rocks: after a rock breaks, the miner flies over
 *    the boxes it left before picking the next rock.
 *  - It STAYS while it has rocks to work, whatever its departure roll
 *    (npc_decision.ts's rollDepartureTime is still drawn): the stock
 *    Asteroid Miner (shïp 379) never left Sol or Tau Ceti in 20+ minutes
 *    (reference "Stock Sol, wave 16", "Stock traffic, wave 17").
 *  - With nothing to mine (no field, no rock in range, or a scooping
 *    miner's hold full) it flies the ordinary trader loop: one stop, then
 *    out by jump.
 *
 * Why the wave-15 kit miners left after 3-4 minutes when the stock one
 * never did (GUESS): AI type, hull flags (Flags3 0x0003) and outfits (the
 * Asteroid Scoop, four Mining Blasters) were the same; what differed was
 * the work. The kit hull flew at 300 / accel 300 against the stock
 * 135 / 36, in a field of 16 rocks against Sol's 2 and Tau Ceti's 3, so
 * it could fill its 100-ton hold in minutes, and a full hold is what sends
 * a miner off here. Not measured: the kit miners' departure itself was
 * never seen (they went off screen and off the radar), nor their holds.
 *
 * Not miners: AI 3/4 hulls with Flags3 0x0001 (the stock Mu'Hari Zephyr
 * 375/376 in AI 4 düdes): the reference did not run that variant, so they
 * keep their warship/interceptor brains. A shuttle hull (Flags3 0x0002
 * without a scoop) is npc_shuttle.ts's.
 *
 * Every number below is a GUESS (fitted, not measured); see
 * docs/npc_behavior_gaps.md "Shuttles and miners: guesses to measure".
 * The choosers read synced state and staged caches only, break ties by
 * uuid (chooseNearest), and draw nothing from the PRNG.
 */

/** A miner looks for rocks within this distance of itself (the field is
 * 6000 px across: about half of it). GUESS. */
export const MINER_ROCK_SEEK_RANGE = 3000;
/** ...and for debris boxes to scoop within this distance. GUESS: boxes
 * spawn at the broken rock, beside the miner, and drift at 2.5-10 px/s
 * for their 15 s life. */
export const MINER_DEBRIS_SEEK_RANGE = 800;
/** A miner holds this fraction of its shortest weapon reach off the rock
 * it is shooting. GUESS. */
export const MINE_STANDOFF_FRACTION = 0.6;
/** ...arriving there below this speed (px/s), and keeps firing while it
 * is within reach and below twice it. GUESS. */
export const MINE_HOLD_SPEED = 30;
/** A fixed gun (or beam) fires at a rock only while the miner's nose is
 * within this angle (rad) of it. GUESS. */
export const MINE_AIM_TOLERANCE = 0.25;
/** A scooping miner aims to pass within this distance (px) of a box... */
export const SCOOP_ARRIVE_RADIUS = 10;
/** ...at no more than this speed (px/s). GUESS. */
export const SCOOP_ARRIVE_SPEED = 60;

/** Whether a ship of effective AI `aiType` with hull `ship` mines. */
export function isMinerHull(aiType: number,
    ship: Pick<ShipData, 'aiFlags'>): boolean {
    return (aiType === 1 || aiType === 2) && ship.aiFlags.destroysAsteroids;
}

/**
 * The shortest reach among a ship's mounted weapons that have one (bays
 * have none), from its SYNCED weapon states: what a miner closes to. A
 * steering decision must never read weapon data through `getCached`
 * (weapons_state.ts), so the standoff comes from here.
 */
export function miningReach(
    weapons: Iterable<readonly [string, { count: number, reach?: number }]>):
    number | undefined {
    let shortest: number | undefined;
    for (const [, state] of weapons) {
        if (state.count > 0 && state.reach !== undefined
            && (shortest === undefined || state.reach < shortest)) {
            shortest = state.reach;
        }
    }
    return shortest;
}

/** Whether the outfits include a mining scoop (oütf ModType 31). */
export function carriesMiningScoop(
    outfits: Iterable<readonly [string, { count: number }]> | undefined,
    outfitOf: (id: string) => OutfitData | undefined): boolean {
    if (!outfits) {
        return false;
    }
    for (const [id, { count }] of outfits) {
        if (count > 0 && outfitOf(id)?.miningScoop) {
            return true;
        }
    }
    return false;
}

/** Whether a miner scoops debris: Flags3 0x0002 and a scoop aboard. */
export function scoopsDebris(ship: Pick<ShipData, 'aiFlags'>,
    outfits: Iterable<readonly [string, { count: number }]> | undefined,
    outfitOf: (id: string) => OutfitData | undefined): boolean {
    return ship.aiFlags.scoopsAsteroidDebris
        && carriesMiningScoop(outfits, outfitOf);
}

export interface MiningJob {
    mode: 'mine' | 'scoop';
    target: string;
}

/**
 * What a miner does next: scoop a box (when it scoops at all), else shoot
 * a rock, else nothing (undefined: the trader loop). `rocks` and `debris`
 * are [uuid, distance²] rows. STICKY, like the plunder run and the
 * contraband scan: the target it already has is kept while it is still a
 * candidate in range, so the miner is not re-aimed at whatever drifted
 * nearer this second; otherwise the nearest (uuid tie-break).
 */
export function chooseMiningJob(current: { mode?: string, mineTarget?: string },
    rocks: ReadonlyArray<readonly [string, number]>,
    debris: ReadonlyArray<readonly [string, number]>,
    scoops: boolean): MiningJob | undefined {
    const pick = (mode: 'mine' | 'scoop',
        rows: ReadonlyArray<readonly [string, number]>, range: number) => {
        const inRange = rows.filter(([, d2]) => d2 <= range * range);
        const keep = current.mode === mode && current.mineTarget !== undefined
            && inRange.some(([uuid]) => uuid === current.mineTarget);
        const target = keep ? current.mineTarget : chooseNearest(inRange);
        return target === undefined ? undefined : { mode, target };
    };
    return (scoops ? pick('scoop', debris, MINER_DEBRIS_SEEK_RANGE)
        : undefined) ?? pick('mine', rocks, MINER_ROCK_SEEK_RANGE);
}

/** The guidance kinds a miner shoots rocks with: fixed guns and beams
 * (which need the nose on the rock) and turrets. Not guided weapons,
 * rockets, bombs, rear turrets, point defence or bays. GUESS: the stock
 * miner mounts only Mining Blasters (unguided). */
const MINING_GUIDANCE = new Set(
    ['unguided', 'beam', 'turret', 'beamTurret', 'frontQuadrant']);
const AIMED_GUIDANCE = new Set(['unguided', 'beam']);

/** Whether a miner uses `weapon` on rocks at all. When it mounts any
 * "asteroid miner" weapon (wëap Flags2 0x8000) it uses only those. */
export function minesWith(weapon: WeaponData, minerWeaponsOnly: boolean):
    boolean {
    if (weapon.type === 'BayWeaponData' || !MINING_GUIDANCE.has(weapon.guidance)) {
        return false;
    }
    return !minerWeaponsOnly
        || ('asteroidMiner' in weapon && weapon.asteroidMiner === true);
}

/** Whether `weapon` must point at the rock to hit it (a fixed gun or
 * beam) rather than aim itself (a turret). */
export function aimsWithHull(weapon: WeaponData): boolean {
    return AIMED_GUIDANCE.has(weapon.guidance);
}
