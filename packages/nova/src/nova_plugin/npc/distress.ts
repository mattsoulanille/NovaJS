import * as t from 'io-ts';
import { EcsEvent } from 'nova_ecs/events';
import { GovtData } from 'novadatainterface/govt_data';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';

/**
 * ============================================================================
 * Distress calls: "<ship name>: <STR# 5003 line>"
 * ============================================================================
 *
 * The Bible: ships "send distress messages" unless their gövt sets Flags2
 * 0x0008 (B:1095-1098); stock STR# 5003 "Ship Help Messages" holds the
 * lines (novadatainterface's DISTRESS_MESSAGES_STRING_TABLE). Measured on
 * the original (docs/reference_experiments.md, "P1 wave 14", the raid
 * watch: 527 s of raiders fighting traders around the port):
 *
 *  - the lines came from the TRADERS under attack (AI 1, gövt 343), always
 *    as "Kit Shipping: <a random line of the list>", on the status line;
 *  - often: several a minute during a fight;
 *  - never from the Flags2-0x0008 traders (Kit Shipping Quiet), who were
 *    attacked as well;
 *  - none in five runs where the PLAYER was the attacker (waves 12-13 and
 *    "P1 wave 15", which watched 310 s of a player beaming traders): the
 *    player's own victims never call.
 *
 * "P1 wave 16" settled the rest:
 *  - MISSION SHIPS NEVER CALL: seven mission victims (AI 1, anchored or
 *    mobile, 30000 or 300 shield, under a mission or a traffic raider)
 *    stayed silent, while TRAFFIC traders attacked by a mission raider
 *    called 9-10 times in 3.2 min;
 *  - each line stays 8.0-8.2 s on the status line and then clears at once
 *    (status_message_plugin), and the calls came in bursts, the next one
 *    often the moment the previous line cleared (lines at 32.5, 62.1, 70.1,
 *    99.6, 115.6, 147.3, 155.3, 186.0 and 194.0 s). Wave 14's "a line stays
 *    21-25 s" was two or three such lines back to back;
 *  - nobody answers a call: the help a victim gets comes from the
 *    alliance rule, call or no call (npc/allied_defenders.ts).
 *
 * So: a non-mission trader (AI 1 or 2) whose govt (or hull, ShipData's
 * inheritedNoGreetings: the class's InherentGovt sets 0x0008) does not
 * silence it, hit in an ATTACK (npc_targeting.ts's provoke rule) by an NPC
 * that is not on a player's side, sends one call, and no other for
 * DISTRESS_CALL_INTERVAL_MS.
 *
 * The simulation draws the line with the seeded PRNG and carries the draw
 * (`roll`) in the event; the display maps it onto the scenario's list, so
 * the simulation never needs the STR# (a display asset) and every peer
 * shows the same line for the same call.
 */

/**
 * The quiet time after a ship's call: it sends no other for this long.
 * The life of one line on the status line ("P1 wave 16": 8.0-8.2 s): in the
 * traffic run calls came 8.0 s apart within a burst (62.1 / 70.1, 147.3 /
 * 155.3, 186.0 / 194.0 s), each the moment the previous line cleared, with
 * quieter stretches of 30-48 s between bursts when the raider was not
 * hitting anyone. The callers could not be told apart (every line read
 * "Kit Shipping"), so ONE ship calling again each time its line clears
 * while it is still being hit is the reading, not a measured per-ship
 * rate. (The 20 s this replaced came from wave 14's "a line stays 21-25
 * s", which was two or three of these lines back to back.)
 */
export const DISTRESS_CALL_INTERVAL_MS = 8_000;

/** Who calls: traders (AI 1 wimpy, AI 2 brave). The raid watch saw calls
 * only from AI 1 traders; GUESS for AI 2, and warships (AI 3/4) never call
 * (none was seen from the police in the same melee, unseparated). */
export const DISTRESS_CALLER_AI_TYPES: readonly number[] = [1, 2];

/**
 * Emitted, untargeted, when a ship sends a distress call. The display puts
 * it on the status line of every player in the system
 * (status_message_plugin). The simulation never reads it back.
 */
export interface DistressCallEventData {
    /** The calling ship's uuid, for its name on the line. */
    ship: string;
    /** The PRNG draw in [0, 1) that picks the line (distressLine). */
    roll: number;
}
export const DistressCallEventType = t.type({
    ship: t.string,
    roll: t.number,
});
export const DistressCallEvent =
    new EcsEvent<DistressCallEventData>('DistressCallEvent');
registerSimulationBridgeEvent({
    event: DistressCallEvent,
    includeEntityUuids: false,
});

/**
 * Whether a ship of AI type `aiType` and govt `govt` sends distress calls
 * at all: a trader whose govt does not set Flags2 0x0008 and whose hull
 * does not inherit it (`inheritedNoGreetings`, ShipData), and that is not
 * a MISSION ship (`missionShip`: it carries MissionShipComponent; "P1 wave
 * 16", seven silent mission victims).
 */
export function sendsDistressCalls(aiType: number,
    govt: GovtData | undefined, inheritedNoGreetings: boolean | undefined,
    missionShip = false): boolean {
    return DISTRESS_CALLER_AI_TYPES.includes(aiType)
        && !missionShip
        && !govt?.flags2.noDistressMessages
        && !inheritedNoGreetings;
}

/** Whether a ship that last called at `lastCall` (sim ms; undefined:
 * never) may call again at `now`. */
export function distressCallDue(lastCall: number | undefined,
    now: number): boolean {
    return lastCall === undefined
        || now - lastCall >= DISTRESS_CALL_INTERVAL_MS;
}

/**
 * The line a call with draw `roll` sends, from the scenario's STR# 5003
 * `lines` (blank entries skipped). Undefined when there is none.
 */
export function distressLine(lines: readonly string[], roll: number)
    : string | undefined {
    const usable = lines.filter(line => line.trim() !== '');
    if (usable.length === 0) {
        return undefined;
    }
    const index = Math.min(usable.length - 1,
        Math.max(0, Math.floor(roll * usable.length)));
    return usable[index];
}

/** The status line for a call: "<ship name>: <line>", as the original
 * printed it ("Kit Shipping: We're being attacked! ..."). */
export function distressCallMessage(shipName: string, line: string): string {
    return `${shipName}: ${line}`;
}
