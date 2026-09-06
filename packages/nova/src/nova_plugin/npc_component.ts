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
    t.literal('board')]);
export type NpcMode = t.TypeOf<typeof NpcMode>;

export const NpcState = t.intersection([t.type({
    /** Effective AI type 1-4 (düde AIType, or the shïp InherentAI when
     * the düde says 0). */
    aiType: t.number,
}), t.partial({
    mode: NpcMode,
    /** Planet uuid: travel destination (traders) or home (interceptors). */
    destination: t.string,
    /** Current waypoint (patrol legs, orbit points, flee headings). */
    waypoint: t.tuple([t.number, t.number]),
    /** Sim time (ms) when the current dwell ends. */
    until: t.number,
    /** Sim time (ms) of the next decision re-evaluation. */
    nextDecision: t.number,
    /** Uuid of the ship that most recently damaged this NPC. */
    aggressor: t.string,
    /** Sim time (ms) after which the NPC heads for a jump-out. */
    departAt: t.number,
    /** Uuid of the disabled hulk this NPC is flying to plunder (mode
     * 'board'; gövt Flags 0x1000). Cleared the moment the approach ends,
     * however it ends. */
    boardTarget: t.string,
    /** Uuid of a ship this NPC has been bribed to leave alone (hail bribe /
     * beg-for-mercy). While `pacifiedUntil` has not lapsed, this ship is
     * skipped as a hostile and forgotten as an aggressor. */
    pacifiedFrom: t.string,
    /** Sim time (ms) until which `pacifiedFrom` is ignored. */
    pacifiedUntil: t.number,
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
