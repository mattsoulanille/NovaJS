import * as t from 'io-ts';
import { Emit, Entities } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { registerSimulationBridgeEvent } from '../communication/simulation_bridge_events.js';
import {
    BoardedComponent, BoardedState, plunderSpent,
} from './boarding_component.js';
import { DisabledComponent } from './disabled_component.js';
import { NpcComponent } from './npc_component.js';
import { npcBoardArrived, npcPlunderCredits } from './npc_plunder.js';
import { NpcSteeringSystem } from './npc_steering.js';
import { CreditsComponent } from './player_state_plugin.js';

/**
 * The terminal of an NPC plunder run (gövt Flags 0x1000): the claim on the
 * hulk, and the event that tells a plundered player. The rules the run
 * follows live in npc_plunder.ts.
 */

/**
 * Emitted (targeted at the PLUNDERED PLAYER's ship) when pirates board a
 * disabled player and take a cut of their cash. The boarding is over in
 * the tick it happens — no dialog opens, nothing is negotiated — so this
 * event is the only feedback there is; the display turns it into a status
 * line and the boarding beep (status_message_plugin). Carries the credits
 * actually taken so the line can name the sum; the sim never reads it
 * back. Never mutates the simulation.
 */
export const PlayerPlunderedEvent =
    new EcsEvent<{ credits: number }>('PlayerPlunderedEvent');
export const PlayerPlunderedEventType = t.type({ credits: t.number });
registerSimulationBridgeEvent({ event: PlayerPlunderedEvent });

/**
 * "SOME OTHER PIRATE GOT HERE FIRST": the terminal of an NPC plunder run
 * (gövt Flags 0x1000). A warship that has reached its hulk spends the
 * hulk's ONE boarding — the same durable BoardedComponent record a player
 * writes (boarding_component.ts) — and the player who turns up afterwards
 * is refused with "You can't board this ship." (stock STR# 2002 index
 * 129). The converse falls out of the same record: an NPC whose prize the
 * player boarded first finds it already spent and gives up its approach.
 *
 * FROM AN NPC HULK the boarder takes nothing material: there is nowhere
 * for an NPC's plunder to go and no way for the player to observe it, so
 * the point of the behavior is the denial alone.
 *
 * FROM A DISABLED PLAYER it takes credits — Matthew's ruling, and the
 * corrected Bible's "(including the player)". The cut is npcPlunderCredits
 * (pegged above what bribing the same ship off would have cost), it is
 * deducted here in the shared sim off the synced CreditsComponent, and
 * PlayerPlunderedEvent tells the victim what happened: the boarding is
 * over in one tick, with no dialog, so the status line is the only
 * feedback there is. The durable `plundered` record makes it
 * EXACTLY-ONCE — the same record that stops a second pirate queueing up
 * behind the first — and it clears at the same life-segment boundaries a
 * hulk's does, so jumping out or landing and departing makes the player
 * plunderable again.
 *
 * WHY THIS IS ITS OWN SYSTEM RATHER THAN AN ARM OF NpcSteeringSystem.
 * The claim is a race between ships: two warships can reach the same hulk
 * on the same tick, and a per-entity system visits them in ENTITY-MAP
 * order, which differs between a peer that built its map by insertion and
 * one restored from a wire snapshot — so whichever of them "got there
 * first" would differ between peers, and the hulk's recorded `boarder` is
 * hashed shared state. Sweeping the map in UUID-SORTED order from a
 * single once-per-tick system (SingletonComponent) removes the race
 * outright: the lexicographically smallest arrived claimant wins, on
 * every peer, always. No PRNG is involved.
 */
export const NpcPlunderBoardSystem = new System({
    name: 'NpcPlunderBoardSystem',
    args: [SingletonComponent, Entities, Emit] as const,
    step(_singleton, entities, emit) {
        for (const uuid of [...entities.keys()].sort()) {
            const boarder = entities.get(uuid);
            const npc = boarder?.components.get(NpcComponent);
            if (!boarder || !npc || npc.mode !== 'board') {
                continue;
            }
            const giveUp = () => {
                npc.mode = undefined;
                npc.boardTarget = undefined;
            };
            const prize = npc.boardTarget
                ? entities.get(npc.boardTarget) : undefined;
            const prizeMovement =
                prize?.components.get(MovementStateComponent);
            const boarderMovement =
                boarder.components.get(MovementStateComponent);
            if (!prize || !prizeMovement || !boarderMovement
                || !prize.components.has(DisabledComponent)) {
                giveUp();
                continue;
            }
            const boarded: BoardedState | undefined =
                prize.components.get(BoardedComponent);
            if (plunderSpent(boarded)) {
                // Beaten to it — by the player, by a rival player, or by
                // a warship earlier in this very sweep.
                giveUp();
                continue;
            }
            if (!npcBoardArrived(boarderMovement, prizeMovement)) {
                continue; // Still on the way; NpcSteeringSystem flies it.
            }
            prize.components.set(BoardedComponent, {
                ...boarded, boarder: uuid, active: false, plundered: true,
            });
            // A DISABLED PLAYER is boarded exactly like a hulk, but there
            // is somewhere for the booty to go, so credits actually move.
            // Written after the record, so the deduction and the
            // exactly-once mark are the same event: any path that reaches
            // this line has just flipped `plundered` from unset.
            const credits = prize.components.get(CreditsComponent);
            if (credits) {
                const taken = npcPlunderCredits(credits.credits);
                credits.credits -= taken;
                emit(PlayerPlunderedEvent, { credits: taken },
                    [npc.boardTarget!]);
            }
            giveUp();
        }
    },
    after: [TimeSystem, NpcSteeringSystem],
});
