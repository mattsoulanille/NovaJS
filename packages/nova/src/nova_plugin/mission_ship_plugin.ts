import * as t from 'io-ts';
import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { BoardedComponent } from './boarding_component.js';
import { CloakActiveComponent, CloakComponent, isTargetable } from './cloak_plugin.js';
import { DeathEvent } from './death_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { CargoComponent, cargoUsed } from './cargo_plugin.js';
import { FuelComponent } from './health_plugin.js';
import { missionCargoKey } from './mission_logic.js';
import {
    ShipOfferSpentComponent, ShipOfferSpentType,
} from './mission_accept.js';
import { ShipPhysicsComponent } from './ship_plugin.js';
import { SystemHoldComponent } from './system_hold.js';
import {
    ActiveMission, CreditsComponent, Missions, MissionsComponent,
} from './player_state_plugin.js';
import { DeathAISystem } from './npc_plugin.js';
import {
    registerShip,
    shipDeparted,
    shipDied,
    shipDisabled,
    shipObserved,
    shipBoarded,
    GOAL_RESCUE,
    ShipObjective,
} from './mission_ship_state.js';

/**
 * ============================================================================
 * Mission special ships in the shared simulation
 * ============================================================================
 *
 * THE MULTIPLAYER DESIGN. A mission belongs to ONE player, but its
 * special ships live in the SHARED deterministic simulation that every
 * peer in the room computes. The split:
 *
 *  - SPAWNING is player-local intent, so it follows the established
 *    pattern for player-initiated sim mutations (hired escorts, the
 *    relaunched player ship): the OWNING player's client builds the
 *    fully-formed ship entities and inserts them through the
 *    input-record addEntity path when the trigger occurs — entering
 *    the mission's resolved ShipSyst (or lifting off into it). The
 *    entities are baked into the record, so the spawn is deterministic
 *    for every peer even though the owner rolled the dude table with
 *    plain randomness. See mission_ship_spawn.ts and browser.ts.
 *
 *  - Each mission ship is tagged with a MissionShipComponent
 *    { mission, owner } so every peer knows whose mission it serves.
 *
 *  - GOAL PROGRESS accrues from shared sim events (deaths, disables,
 *    proximity), evaluated by the systems below identically on every
 *    peer, into the ShipObjective inside the OWNER's MissionsComponent
 *    (which is serializer-registered per-player state riding on the
 *    owner's ship entity). No input records are needed for progress:
 *    determinism makes every peer agree on it.
 *
 *  - DESPAWN. Every mission-ending transition (complete / abort /
 *    fail) happens while the owner is docked — i.e. while the owner's
 *    entity is OUT of the simulation. So "delete mission ships whose
 *    owner is absent" subsumes despawn-on-mission-end, despawn when
 *    the owner jumps away (the ships are respawned by the owner's
 *    client in the next system when the mission calls for it), and
 *    despawn on disconnect. The owner's client clears the objective's
 *    `live` roster before re-inserting its ship (mission_ship_spawn),
 *    so stale uuids from a previous system are never mistaken for
 *    in-system departures.
 *
 * Ships that survive a completed goal linger until the mission ends
 * (see mission_ship_state.ts for the Bible reading).
 */

export const MissionShipType = t.intersection([t.type({
    /** The owning player's active mission id (e.g. 'nova:258'). */
    mission: t.string,
    /** Entity uuid of the owning player's ship. */
    owner: t.string,
}), t.partial({
    /** An AuxShip: mission atmosphere, not part of the goal. */
    aux: t.boolean,
    /**
     * Spawned by a mission that auto-aborted at accept (the Derelict
     * Decoy's ambush, mïsn 133): the mission never joins the owner's
     * MissionsComponent, so the ship is tethered to the OWNER's presence
     * only — never to the mission being active. Without this the cleanup
     * below deleted the ambush a few ticks after it jumped in.
     */
    untethered: t.boolean,
    /**
     * The name this special ship wears, copied from the owner's
     * ActiveMission.shipName at spawn (mïsn ShipNameID; see
     * mission_ship_spawn.ts). Carried on the COMPONENT rather than on
     * Entity.name — Entity.name is a debugging label that never crosses
     * the serializer into the display world, so the target pane and the
     * hail dialog could not see it. Read by status_bar's target pane and
     * hail_dialog_plugin, exactly as PersComponent.name is: a named
     * special ship shows its name in place of its ship class.
     *
     * Absent for aux ships (the Bible gives them no names) and for
     * missions whose ShipNameID is -1.
     */
    name: t.string,
    /** The ShipSubtitle sibling of `name`, shown in place of the ship
     * class's own subtitle. Absent when the mission sets none. */
    subtitle: t.string,
})]);
export type MissionShip = t.TypeOf<typeof MissionShipType>;
export const MissionShipComponent =
    new Component<MissionShip>('MissionShipComponent');

/** How close the owner must get to observe a cloak-capable ship
 * (GOAL_OBSERVE); roughly "visible onscreen". Ships that cannot cloak
 * are observed by mere co-presence in the system, per the Bible. */
export const OBSERVE_RANGE = 1500;

/** The owner's ShipObjective for a mission ship, if everything about
 * it still exists. */
function objectiveOf(missionShip: MissionShip,
    entities: EntityMap): ShipObjective | undefined {
    if (missionShip.aux) {
        return undefined;
    }
    const owner = entities.get(missionShip.owner);
    const missions = owner?.components.get(MissionsComponent);
    return missions?.get(missionShip.mission)?.shipObjective;
}

/**
 * mïsn PickupMode 2 — "Pick up when boarding special ship". Moves the
 * mission's cargo into the OWNER's hold the tick they board this ship.
 *
 * WHY IT IS AUTOMATIC AND NOT A DIALOG BUTTON. The Bible's PickupMode is
 * a property of the mission, not an action the player takes: the cargo is
 * picked up BY boarding. That also makes it robust against every way a
 * boarding can end early — the plunder dialog is never opened on a
 * one-shot capture, and a repelled capture closes it on the same tick —
 * because it keys off the same durable BoardedComponent record the goal
 * credit does, not off a button press.
 *
 * The stock reference is mïsn 832, "Recover Stolen Art": ShipGoal 2,
 * PickupMode 2, CargoType 76 x2, DropOffMode 1. Its QuickBrief is
 * "Disable and board the Leviathan ... pick up the stolen art and then
 * head to <RST> ...", and without this the cargo never loads, so
 * DropOffMode 1 never drops it and the mission cannot be completed.
 *
 * The hold must have room; if it does not, nothing happens and the next
 * tick tries again, so jettisoning something finishes the pickup. The key
 * is missionCargoKey — the single definition the landing path and the
 * player-info cargo list already use, so the tonnage the sim adds is the
 * tonnage the spaceport later drops off.
 *
 * Idempotent on `cargoLoaded`, which is serialized per-mission state, so
 * a re-boarding (impossible today under the one-plunder rule, but not
 * something to depend on) cannot duplicate the cargo.
 */
function pickUpOnBoarding(active: ActiveMission, owner: Entity): void {
    if (!active.pickupOnBoard || active.cargoLoaded || active.cargoQty <= 0) {
        return;
    }
    const cargo = owner.components.get(CargoComponent);
    const physics = owner.components.get(ShipPhysicsComponent);
    if (!cargo || !physics) {
        return;
    }
    if (active.cargoQty > physics.freeCargo - cargoUsed(cargo)) {
        return; // No room yet; try again next tick.
    }
    cargo.set(missionCargoKey(active.id), active.cargoQty);
    active.cargoLoaded = true;
}

/**
 * Everything a BOARDING settles on the spot, the first time the mission's
 * owner boards one of its special ships.
 *
 * THE RESCUE ITSELF (mïsn ShipGoal 5, "they start out disabled and stay
 * that way until you board them"). Boarding is the rescue, so the hulk
 * state is lifted here and the ship flies off under its own AI — the only
 * thing that CAN lift it, since ShipDisableSystem refuses to re-enable a
 * `hulk` however healthy its armor is (see makeHulk). Deleting the
 * component is the documented external-repair route that file names.
 *
 * THE DEFERRED AUTO-ABORT (mïsn Flags 0x0001, verbatim): "If the mission
 * is one in which a special ship replaces a përs ship at mission start
 * (such as for a 'rescue disabled ship' mission) and the SpecialShipGoal
 * is 2 or 5 (board or rescue) the mission will auto-abort AFTER THE
 * SPECIAL SHIP IS BOARDED." An ordinary auto-abort mission never becomes
 * active at all (mission_logic's acceptOffer); this kind has to, because
 * its special ship must exist to be found and boarded. `autoAbortOnBoard`
 * is the frozen marker that it is the deferred kind.
 *
 * SPLIT BETWEEN SIM AND CLIENT, along the line every other mission
 * transition already uses. The parts that are pure arithmetic on synced
 * components happen HERE, immediately and visibly on every peer:
 *
 *  - mïsn Flags2 0x0002, "Apply mission Pay on auto-abort" — the Refuel
 *    Trader's 2000 credits, which the trader hands over as they undock;
 *  - mïsn Flags 0x0008, "Mission takes away 100 units of fuel upon
 *    auto-abort" — the fuel you just gave them. Clamped at the tank, and
 *    the mission is not offered below 100 units in the first place (the
 *    same Bible line says so), so the clamp is belt and braces.
 *
 * The parts that need the mission UNIVERSE — running the OnAbort set
 * string, dropping the mission from the list, showing its popup — cannot
 * happen in the sim, which never reads mission game data. They are marked
 * `autoAbortPending` and run at the owner's next date advance, exactly as
 * `shipDonePending` already does for OnShipDone (mission_session's
 * processInFlightMissions).
 *
 * Everything here is guarded on the FIRST boarding, so a re-board (which
 * the one-plunder rule makes impossible today, but which is not something
 * to depend on) cannot pay twice.
 */
function rescueBoarded(active: ActiveMission, owner: Entity,
    ship: Entity): void {
    if (active.shipObjective?.goal === GOAL_RESCUE) {
        // Rescued: it is no longer a hulk, so it flies off — and the
        // in-system hold that kept it here to BE rescued goes with the
        // disable (system_hold.ts). Both are dropped together on purpose:
        // "stays put until refuelled" and "adrift until boarded" are the
        // same fact, and a ship that could move but not leave would be
        // the worst of the two.
        ship.components.delete(DisabledComponent);
        ship.components.delete(SystemHoldComponent);
    }
    if (!active.autoAbortOnBoard || active.autoAbortPending) {
        return;
    }
    active.autoAbortPending = true;
    if (active.autoAbortPay) {
        const credits = owner.components.get(CreditsComponent);
        if (credits) {
            credits.credits += active.autoAbortPay;
        }
    }
    if (active.autoAbortFuel) {
        const fuel = owner.components.get(FuelComponent);
        if (fuel) {
            fuel.current = Math.max(0, fuel.current - active.autoAbortFuel);
        }
    }
}

/**
 * Tracks a mission ship in its owner's objective and evaluates the
 * per-ship conditions that come from co-existence in the sim:
 * registration, disabling, boarding, and observation.
 *
 * MISSION SHIPS ARE BOARDABLE, per the Bible, and two of its seven ship
 * goals are ABOUT boarding them: ShipGoal 2 is "Board them" and ShipGoal
 * 5 is "Rescue them (they start out disabled and stay that way until you
 * board them)". mïsn Flags 0x0001 confirms the mechanic from the other
 * side — "the mission will auto-abort after the special ship is boarded"
 * — and mïsn PickupMode 2 is "Pick up when boarding special ship". So
 * nothing here refuses a boarding; instead a boarding by the OWNER is
 * credited to the goal, closing the shipBoarded seam that
 * mission_ship_state.ts documents.
 *
 * `boarder === owner` is checked because the durable record names
 * whoever spent the hulk's one plunder, and that can be somebody else: a
 * rival player, or (in principle) an NPC pirate. Only the mission's own
 * player boarding it is progress. NPCs cannot in fact reach a mission
 * ship — gövt Flags 0x1000 plunders "non-mission" enemies only, and
 * npcPlunderEligible enforces that — but the goal must not depend on
 * that flag staying the way it is.
 *
 * GOAL_BOARD and GOAL_RESCUE are both OFFERED now (mission_ship_state's
 * goalSupported), on top of this evaluation: rescue targets spawn as
 * hulks and stay that way until boarded, and board targets stay in the
 * system until they have been (mission_ship_spawn's 'missionGoal' hold).
 */
const MissionShipTrackSystem = new System({
    name: 'MissionShipTrackSystem',
    args: [MissionShipComponent, UUID, MovementStateComponent,
        Optional(DisabledComponent), Optional(CloakComponent),
        Optional(CloakActiveComponent), Optional(BoardedComponent),
        GetEntity, Entities] as const,
    step(missionShip, uuid, movement, disabled, cloak, cloakActive, boarded,
        shipEntity, entities) {
        const objective = objectiveOf(missionShip, entities);
        if (!objective) {
            return;
        }
        registerShip(objective, uuid);
        if (disabled) {
            shipDisabled(objective, uuid);
        }
        if (boarded?.plundered && boarded.boarder === missionShip.owner) {
            const first = !objective.live.get(uuid)?.boarded;
            shipBoarded(objective, uuid);
            const owner = entities.get(missionShip.owner);
            const active = owner?.components.get(MissionsComponent)
                ?.get(missionShip.mission);
            if (owner && active) {
                // mïsn PickupMode 2: boarding IS the pickup.
                pickUpOnBoarding(active, owner);
                if (first) {
                    rescueBoarded(active, owner, shipEntity);
                }
            }
        }
        // Observation: no cloak capability = observed by co-presence
        // (the owner inserted us into their own system); cloak-capable
        // ships must be seen up close while visible.
        if (!cloak) {
            shipObserved(objective, uuid);
        } else if (isTargetable(cloakActive)) {
            const owner = entities.get(missionShip.owner)?.components
                .get(MovementStateComponent);
            if (owner && owner.position.subtract(movement.position)
                .lengthSquared <= OBSERVE_RANGE * OBSERVE_RANGE) {
                shipObserved(objective, uuid);
            }
        }
        // OUTSTANDING business only. A special ship is pinned in the
        // system while its mission still wants something from it
        // (mission_ship_spawn's 'missionGoal' hold); the moment the
        // objective is settled — the sample is aboard, the bounty is
        // collected, the goal has become unachievable — it is an ordinary
        // ship again and may fly off. The other hold reasons are released
        // by their own owners ('rescue' by rescueBoarded above,
        // 'shipOffer' by ShipOfferHoldReleaseSystem), so only ours is
        // touched here. See system_hold.ts.
        if ((objective.complete || objective.failed)
            && shipEntity.components.get(SystemHoldComponent)?.reason
            === 'missionGoal') {
            shipEntity.components.delete(SystemHoldComponent);
        }
    },
    after: [TimeSystem],
});

/**
 * A mission ship died: goal bookkeeping (destroy/chase-off progress,
 * disable/escort failure). Must run before DeathAISystem deletes the
 * entity, or the departure sweep would misread the death as a
 * jump-out.
 */
const MissionShipDeathSystem = new System({
    name: 'MissionShipDeathSystem',
    events: [DeathEvent],
    args: [DeathEvent, MissionShipComponent, UUID, Entities] as const,
    step(_death, missionShip, uuid, entities) {
        const objective = objectiveOf(missionShip, entities);
        if (objective) {
            shipDied(objective, uuid);
        }
    },
    before: [DeathAISystem],
});

/**
 * Sweeps each owner's tracked rosters for ships that vanished without
 * a death — NPC jump-outs and flee-departures delete the entity — and
 * credits them as chased off where that's the goal.
 */
const MissionShipDepartureSystem = new System({
    name: 'MissionShipDepartureSystem',
    args: [MissionsComponent, Entities] as const,
    step(missions, entities) {
        for (const active of missions.values()) {
            const objective = active.shipObjective;
            if (!objective || objective.live.size === 0) {
                continue;
            }
            for (const uuid of [...objective.live.keys()]) {
                if (!entities.has(uuid)) {
                    shipDeparted(objective, uuid);
                }
            }
        }
    },
    after: [TimeSystem],
});

/**
 * Deletes mission ships whose owner is gone from the simulation or no
 * longer has the mission (see the despawn design in the module
 * comment).
 */
const MissionShipCleanupSystem = new System({
    name: 'MissionShipCleanupSystem',
    args: [MissionShipComponent, UUID, Entities] as const,
    step(missionShip, uuid, entities) {
        const owner = entities.get(missionShip.owner);
        if (!owner) {
            entities.delete(uuid);
            return;
        }
        if (missionShip.untethered) {
            return;
        }
        const missions = owner.components.get(MissionsComponent);
        if (!missions || !missions.has(missionShip.mission)) {
            entities.delete(uuid);
        }
    },
    after: [TimeSystem],
});

/**
 * Player-loss mission failure (mïsn Flags2 0x0004,
 * failIfPlayerDisabledOrDestroyed). The disabled and destroyed cases
 * are wired below off the shared DisabledComponent / DeathEvent. The
 * sibling mïsn Flags 0x0020 flag, failIfScanned, is NOT modeled: the
 * engine has no cargo-scan mechanic, so there is no scan event to fail
 * on. It stays a parsed-but-inert flag until scanning exists.
 *
 * Marks every active mission with the failIfPlayerDisabledOrDestroyed
 * flag as failed. The flag was frozen onto the ActiveMission at accept
 * time, so the sim never needs the mission game data. Returns whether
 * anything changed (so callers can avoid touching the component
 * needlessly). Idempotent: an already-failed mission stays failed.
 */
function failPlayerMissionsOnLoss(missions: Missions): boolean {
    let changed = false;
    for (const active of missions.values()) {
        if (active.failIfPlayerDisabledOrDestroyed && !active.failed) {
            active.failed = true;
            changed = true;
        }
    }
    return changed;
}

/**
 * Fails the owner's flagged missions when the owner's ship becomes
 * disabled (mïsn Flags2 0x0004). Runs on every peer identically off the
 * shared DisabledComponent; the actual OnFailure/notice happens at the
 * next landing (processLanding reads active.failed), matching how
 * special-ship goal failures surface.
 */
const MissionPlayerDisabledSystem = new System({
    name: 'MissionPlayerDisabledSystem',
    args: [MissionsComponent, DisabledComponent] as const,
    step(missions) {
        failPlayerMissionsOnLoss(missions);
    },
    after: [TimeSystem],
});

/**
 * Fails the owner's flagged missions when the owner's ship is destroyed
 * (mïsn Flags2 0x0004). Runs before DeathAISystem deletes the entity so
 * the mission state — which rides on that same entity — is still
 * mutable. (For players the ship isn't deleted; an escape pod respawns
 * it, carrying the now-failed missions to the next landing.)
 */
const MissionPlayerDeathSystem = new System({
    name: 'MissionPlayerDeathSystem',
    events: [DeathEvent],
    args: [DeathEvent, MissionsComponent] as const,
    step(_death, missions) {
        failPlayerMissionsOnLoss(missions);
    },
    before: [DeathAISystem],
});

export const MissionShipPlugin: Plugin = {
    name: 'MissionShipPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(MissionShipComponent, MissionShipType);
        // Registered here rather than in a plugin of its own: it is
        // written by applyAcceptMission and READ BY THE DISPLAY (the
        // hail / boarding offer plugins refuse to re-offer from a hull
        // whose offer is spent), and only a registered component crosses
        // the bridge into the display world at all.
        serializer?.addComponent(ShipOfferSpentComponent, ShipOfferSpentType);
        world.addSystem(MissionShipTrackSystem);
        world.addSystem(MissionShipDeathSystem);
        world.addSystem(MissionShipDepartureSystem);
        world.addSystem(MissionShipCleanupSystem);
        world.addSystem(MissionPlayerDisabledSystem);
        world.addSystem(MissionPlayerDeathSystem);
    },
};
