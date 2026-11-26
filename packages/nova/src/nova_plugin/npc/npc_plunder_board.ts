import * as t from 'io-ts';
import { Emit, Entities } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import {
    BoardedComponent, BoardedState, CargoComponent, cargoUsed, plunderSpent,
    ShipDataComponent, ShipPhysicsComponent,
} from '../ship/index.js';
import { DisabledComponent } from '../ship/index.js';
import { letGo } from './let_go.js';
import { NpcComponent, NpcState } from './npc_component.js';
import {
    npcBoardArrived, npcPlunderCargoPlan, npcPlunderCredits,
    NPC_PLUNDER_DOCK_MS,
} from './npc_plunder.js';
import { NpcSteeringSystem } from './npc_steering.js';
import { CreditsComponent } from '../player/index.js';

/**
 * The terminal of an NPC plunder run (gövt Flags 0x1000): the dock, the
 * claim on the hulk, the take from a disabled player, and the event that
 * tells him. The rules the run follows live in npc_plunder.ts.
 */

/**
 * Emitted (targeted at the PLUNDERED PLAYER's ship) when pirates board a
 * disabled player and rob him. The boarding happens with no dialog and
 * nothing negotiated, so this event is the only feedback there is; the
 * display turns it into the status line "<N> tons of cargo and <M>
 * credits stolen!" and the boarding beep (status_message_plugin).
 * Carries the tons and credits actually taken so the line can name them;
 * the sim never reads it back. Never mutates the simulation.
 */
export const PlayerPlunderedEvent =
    new EcsEvent<{ credits: number, tons: number }>('PlayerPlunderedEvent');
export const PlayerPlunderedEventType =
    t.type({ credits: t.number, tons: t.number });
registerSimulationBridgeEvent({ event: PlayerPlunderedEvent });

/** A board run is over, however it ended: back to ordinary business. */
function endBoardRun(npc: NpcState) {
    npc.mode = undefined;
    npc.boardTarget = undefined;
    delete npc.boardUntil;
}

/**
 * "SOME OTHER PIRATE GOT HERE FIRST": the terminal of an NPC plunder run
 * (gövt Flags 0x1000). A warship that has come alongside its hulk SITS ON
 * IT for NPC_PLUNDER_DOCK_MS (reference "Pirates and a disabled player
 * (A9), wave 38": about 5 s, the hulls overlapping, before the line), then
 * spends the hulk's ONE boarding — the same durable BoardedComponent
 * record a player writes (boarding_component.ts) — and the player who
 * turns up afterwards is refused with "You can't board this ship." (stock
 * STR# 2002 index 129). The converse falls out of the same record: an NPC
 * whose prize the player boarded first (even mid-dock) finds it already
 * spent and gives up its approach.
 *
 * FROM AN NPC HULK the boarder takes nothing material: there is nowhere
 * for an NPC's plunder to go and no way for the player to observe it, so
 * the point of the behavior is the denial alone.
 *
 * FROM A DISABLED PLAYER it takes cargo and credits, then lets him go —
 * the original, measured (A9, wave 38): the costliest cargo its own free
 * hold takes moves into its hold (npcPlunderCargoPlan), a drawn share of
 * the cash is deducted (npcPlunderCredits, one RandomResource draw), and
 * PlayerPlunderedEvent tells the victim. Then the pirate turns
 * non-hostile toward him and, when it can, leaves the system by the
 * ordinary jump-out (npc/let_go.ts, the paid bribe's path); the player
 * stays disabled and is not shot again. The durable `plundered` record
 * makes it EXACTLY-ONCE — the same record that stops a second pirate
 * queueing up behind the first — and it clears at the same life-segment
 * boundaries a hulk's does, so jumping out or landing and departing makes
 * the player plunderable again.
 *
 * WHY THIS IS ITS OWN SYSTEM RATHER THAN AN ARM OF NpcSteeringSystem.
 * The claim is a race between ships: two warships can reach the same hulk
 * on the same tick, and a per-entity system visits them in ENTITY-MAP
 * order, which differs between a peer that built its map by insertion and
 * one restored from a wire snapshot — so whichever of them "got there
 * first" would differ between peers, and the hulk's recorded `boarder` is
 * hashed shared state. Sweeping the map in UUID-SORTED order from a
 * single once-per-tick system (SingletonComponent) removes the race
 * outright: the lexicographically smallest claimant whose dock comes due
 * first wins, on every peer, always — and the PRNG draw for the credits is
 * taken in that same sorted order, so every peer draws alike.
 */
export const NpcPlunderBoardSystem = new System({
    name: 'NpcPlunderBoardSystem',
    args: [SingletonComponent, Entities, TimeResource, RandomResource,
        Emit] as const,
    step(_singleton, entities, time, random, emit) {
        for (const uuid of [...entities.keys()].sort()) {
            const boarder = entities.get(uuid);
            const npc = boarder?.components.get(NpcComponent);
            if (!boarder || !npc || npc.mode !== 'board') {
                continue;
            }
            const prizeUuid = npc.boardTarget;
            const prize = prizeUuid !== undefined
                ? entities.get(prizeUuid) : undefined;
            const prizeMovement =
                prize?.components.get(MovementStateComponent);
            const boarderMovement =
                boarder.components.get(MovementStateComponent);
            if (!prize || prizeUuid === undefined || !prizeMovement
                || !boarderMovement
                || !prize.components.has(DisabledComponent)) {
                endBoardRun(npc);
                continue;
            }
            const boarded: BoardedState | undefined =
                prize.components.get(BoardedComponent);
            if (plunderSpent(boarded)) {
                // Beaten to it — by the player, by a rival player, or by
                // a warship earlier in this very sweep.
                endBoardRun(npc);
                continue;
            }
            if (npc.boardUntil === undefined) {
                if (!npcBoardArrived(boarderMovement, prizeMovement)) {
                    continue; // Still on the way; NpcSteeringSystem flies it.
                }
                // Alongside: sit on it for the dock before the take. The
                // steering keeps it there (its 'board' arm still flies to
                // the prize), so the dock is a wait, not a gate re-checked
                // every tick.
                npc.boardUntil = time.time + NPC_PLUNDER_DOCK_MS;
                continue;
            }
            if (time.time < npc.boardUntil) {
                continue;
            }
            prize.components.set(BoardedComponent, {
                ...boarded, boarder: uuid, active: false, plundered: true,
            });
            // A DISABLED PLAYER is boarded exactly like a hulk, but there
            // is somewhere for the booty to go, so cargo and credits
            // actually move. Written after the record, so the take and
            // the exactly-once mark are the same event: any path that
            // reaches this line has just flipped `plundered` from unset.
            const credits = prize.components.get(CreditsComponent);
            if (credits) {
                const tons = takeCargo(boarder, prize);
                const taken = npcPlunderCredits(credits.credits,
                    random.next());
                credits.credits -= taken;
                emit(PlayerPlunderedEvent, { credits: taken, tons },
                    [prizeUuid]);
                endBoardRun(npc);
                // ...and lets him go: non-hostile toward him for the rest
                // of its visit, and off out of the system if it can leave.
                letGo(boarder, uuid, npc, prizeUuid,
                    id => entities.get(id));
                continue;
            }
            endBoardRun(npc);
        }
    },
    after: [TimeSystem, NpcSteeringSystem],
});

/**
 * Moves the plunder's cargo from the victim's hold into the boarder's, up
 * to the boarder's free hold (its effective cargo space less what it
 * already carries), costliest first. Returns the tons moved.
 */
function takeCargo(boarder: Entity, victim: Entity): number {
    const victimCargo = victim.components.get(CargoComponent);
    const boarderCargo = boarder.components.get(CargoComponent);
    const physics = boarder.components.get(ShipPhysicsComponent)
        ?? boarder.components.get(ShipDataComponent)?.physics;
    if (!victimCargo || !boarderCargo || !physics) {
        return 0;
    }
    const free = physics.freeCargo - cargoUsed(boarderCargo);
    let tons = 0;
    for (const [key, take] of npcPlunderCargoPlan(victimCargo, free)) {
        boarderCargo.set(key, (boarderCargo.get(key) ?? 0) + take);
        const left = (victimCargo.get(key) ?? 0) - take;
        if (left > 0) {
            victimCargo.set(key, left);
        } else {
            victimCargo.delete(key);
        }
        tons += take;
    }
    return tons;
}
