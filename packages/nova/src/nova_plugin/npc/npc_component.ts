import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * The NPC AI's synced brain state (see npc_ai_plugin.ts for the AI
 * overview). Split out from the systems so that the display, the
 * hostility rule and the spawners can read the component without
 * importing the systems that drive it.
 */

export const NpcMode = t.union([
    t.literal('travel'), t.literal('dwell'), t.literal('flee'),
    t.literal('attack'), t.literal('patrol'), t.literal('depart'),
    /** Flying to a disabled hulk to plunder it (gövt Flags 0x1000). */
    t.literal('board'),
    /** An interceptor (AI 4) flying to a player ship to scan it for
     * contraband (npc/contraband_scan.ts). */
    t.literal('scan'),
    /** A miner (AI 1/2 hull with shïp Flags3 0x0001) shooting an asteroid
     * apart (npc/npc_mining.ts). */
    t.literal('mine'),
    /** A miner with a mining scoop (Flags3 0x0002 plus an oütf ModType
     * 31) flying over asteroid debris to scoop it (npc/npc_mining.ts). */
    t.literal('scoop')]);
export type NpcMode = t.TypeOf<typeof NpcMode>;

export const NpcState = t.intersection([t.type({
    /** Effective AI type 1-4 (düde AIType, or the shïp InherentAI when
     * the düde says 0). */
    aiType: t.number,
}), t.partial({
    mode: NpcMode,
    /** Planet uuid: travel destination (traders) or home (interceptors). */
    destination: t.string,
    /** A SHUTTLE's other lane stop (npc/npc_shuttle.ts): it flies
     * `destination` -> `laneEnd` and swaps the two at each stop. Set only
     * on shuttles; the steering turns a ship with one short of the stellar
     * (shuttleTurnPoint) and pauses it SHUTTLE_DWELL_MS. */
    laneEnd: t.string,
    /** Current waypoint (patrol legs, orbit points, flee headings). */
    waypoint: t.tuple([t.number, t.number]),
    /** Sim time (ms) when the current dwell ends. */
    until: t.number,
    /** Sim time (ms) of the next decision re-evaluation. */
    nextDecision: t.number,
    /** Uuid of the ship that most recently damaged this NPC. */
    aggressor: t.string,
    /** Sim time (ms) `aggressor` was first recorded, i.e. how long this
     * ship has been under its current attacker (set when the aggressor
     * CHANGES, npc_targeting.ts's provoke). Meaningful only while
     * `aggressor` is set; allied warships join the fight once it is
     * ALLIED_DEFENCE_DELAY_MS old (npc/allied_defenders.ts). */
    aggressorSince: t.number,
    /** Sim time (ms) after which the NPC heads for a jump-out. */
    departAt: t.number,
    /** Uuid of the disabled hulk this NPC is flying to plunder (mode
     * 'board'; gövt Flags 0x1000). Cleared the moment the approach ends,
     * however it ends. */
    boardTarget: t.string,
    /** Uuid of the player ship this interceptor is flying to scan for
     * contraband (mode 'scan'; npc/contraband_scan.ts). Cleared the
     * moment the approach ends, however it ends. */
    scanTarget: t.string,
    /** Uuid of the scanned ship this interceptor has COME UP TO and sits
     * on (set by ContrabandScanSystem once it is within
     * CONTRABAND_SCAN_RANGE of a ship scanned this visit). While it names
     * `scanTarget`, the interceptor holds its spot rather than chasing:
     * it creeps after the ship at CONTRABAND_SIT_SPEED at most and lets go
     * once the ship is CONTRABAND_SIT_LEASH away (reference "Contraband /
     * rescue / A14, wave 19": a cutter does not follow a clean ship that
     * flies off). Dropped with `scanTarget`. */
    scanSatOn: t.string,
    /** Uuid of the asteroid a miner is shooting (mode 'mine') or of the
     * debris box it is flying over to scoop (mode 'scoop'); see
     * npc/npc_mining.ts. Read only in those two modes, and dropped once
     * the miner's mining branch finds nothing to do. */
    mineTarget: t.string,
    /** Uuid of a ship this NPC has been bribed to leave alone (hail bribe /
     * beg-for-mercy). While `pacifiedUntil` has not lapsed, this ship is
     * skipped as a hostile and forgotten as an aggressor. */
    pacifiedFrom: t.string,
    /** Sim time (ms) until which `pacifiedFrom` is ignored. */
    pacifiedUntil: t.number,
    /** How hard this ship is being hit: a leaky bucket of recent damage,
     * in fractions of its max shield, as of `damageLoadAt` (npc_retreat.ts).
     * Kept only for warships of a gövt Flags 0x0010 government, and
     * dropped once it has drained to zero. */
    damageLoad: t.number,
    /** Sim time (ms) `damageLoad` was last brought up to date. */
    damageLoadAt: t.number,
    /** Sim time (ms) a gövt 0x0010 warship started losing its fight
     * (shield under 25% and losing, npc_retreat.ts). While set and in
     * 'attack' it STANDS OFF instead of closing; in 'flee' it is
     * committed to jumping out. Cleared the moment it stops losing. */
    retreatSince: t.number,
    /** A gövt 0x0010 warship's jump-or-stay decision: one PRNG draw made
     * the first time it is losing below 25% shield (true: flee and jump
     * out; false: stand off while losing, never jump for it). Kept while
     * the shield stays under 25% and dropped once it is back at or above,
     * so each crossing draws once (npc_retreat.ts). */
    retreatJump: t.boolean,
    /** A brave trader's (AI 2) current aggressor, once that aggressor has
     * been within the trader's longest weapon reach. If it is then beyond
     * that reach the trader runs (the Bible's "runs away when his attacker
     * is out of range"; npc_decision.ts). Dropped with the aggressor. */
    reachedAggressor: t.string,
    /** A mission special ship with no goal and AI 1 (mïsn ShipGoal -1,
     * ShipBehav -1; set at spawn by mission_ship_spawn.ts). It has no
     * business here: its departure roll uses the short PASS_THROUGH
     * window (npc_decision.ts) and it leaves the moment that comes due,
     * whatever it is doing (reference A-series wave 4). */
    passingThrough: t.boolean,
    /** Sim time (ms) of this trader's last distress call (npc/distress.ts):
     * it sends no other for DISTRESS_CALL_INTERVAL_MS. Set only on ships
     * that have called. */
    distressAt: t.number,
})]);
export type NpcState = t.TypeOf<typeof NpcState>;
export const NpcComponent = new Component<NpcState>('NpcComponent');

/**
 * Whether this NPC has been BOUGHT OFF by `uuid` and the reprieve is still
 * running at sim time `now` — the beg-for-mercy bribe (hail_plugin's
 * applyHail).
 *
 * Pure, total, and over synced state only (NpcComponent is
 * serializer-registered), so the simulation's own decision loop, the
 * hostility rule the target corners / 'r' key / point defense read
 * (hostility.ts), and the radar's IFF colouring all reach the same verdict on
 * every peer. NpcDecisionSystem's inline version of this test additionally
 * CLEARS the lapsed fields; this one only reads, so display callers cannot
 * mutate simulation state by asking.
 */
export function isPacifiedToward(npc: NpcState | undefined,
    uuid: string | undefined, now: number): boolean {
    return !!npc && uuid !== undefined && npc.pacifiedFrom === uuid
        && npc.pacifiedUntil !== undefined && now < npc.pacifiedUntil;
}
