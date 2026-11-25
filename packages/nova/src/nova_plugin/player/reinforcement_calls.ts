import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';

/**
 * The days a pilot was in a system when its REINFORCEMENT FLEET was last
 * called (sÿst ReinfFleet / ReinfIntrval; spawn/reinforcements.ts): sÿst
 * global id -> the calendar day number (calendar.ts dayNumber) of the
 * pilot's own date at the call.
 *
 * Per-player state like the legal records: it lives on the player's ship,
 * follows the pilot across hull changes (missions/mission_ship_change.ts
 * PLAYER_STATE_COMPONENTS), and is saved with the pilot (pilot/
 * save_game.ts `reinforcementCalls`), so the cooldown survives a jump, a
 * landing and a save/load as the date does. A call stamps only the
 * CALLER (the pilot whose hit, or whose flock's hit, called it), with his
 * own date: the cooldown is private to each player (Matthew's ruling,
 * 2026-11-24), and the call reads only the calling pilot's entry.
 * Written inside the simulation (identically on every peer: synced state
 * in, synced state out), and delta-registered so the display's mirror,
 * which an in-flight save reads, carries it too.
 *
 * Absent (or no entry for a system) means the fleet was never called
 * there.
 */
export const ReinforcementCallsType = map(t.string, t.number);
export type ReinforcementCalls = t.TypeOf<typeof ReinforcementCallsType>;
export const ReinforcementCallsComponent =
    new Component<ReinforcementCalls>('ReinforcementCalls');
