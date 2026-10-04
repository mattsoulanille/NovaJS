import * as t from 'io-ts';
import { isLeft } from 'fp-ts/lib/Either.js';
import { Emit, Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { EncodedEntity, Serializer, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { deImmerify } from '../../util/deimmerify.js';
import { deriveEntityComponents, SimulationGameDataResource } from '../core/index.js';
import {
    ActiveRanksComponent, AggressionSuppressGovtsComponent, ControlBitsComponent,
    ShipChangeMode,
} from '../ncb/index.js';
import {
    ControlledByComponent, CreditsComponent, CronStatesComponent,
    EscortPayrollComponent, GameDateComponent, MissionsComponent,
    PendingAutoAbortShipsComponent, PendingMissionNoticesComponent,
    PlayerShipSelector,
} from '../player/index.js';
import { CombatRatingComponent, LegalRecordsComponent } from '../reputation/index.js';
import {
    CargoComponent, OutfitsStateComponent, ShipComponent, TargetComponent,
} from '../ship/index.js';
import {
    GateArrivalComponent, JumpComponent, JumpRouteComponent,
    MultiJumpContinueComponent, PlanetTargetComponent,
} from '../travel/index.js';
import { sweepableEscorts, sweepJumpingEscort } from '../escorts/index.js';

/**
 * ============================================================================
 * Changing the player's ship (Cxxx / Exxx / Hxxx) and moving the player
 * (Mxxx / Nxxx) while the ship is IN THE SIMULATION
 * ============================================================================
 *
 * Docked, a set string's change of ship is an edit to an entity the client
 * owns outright (spaceport/landed_transaction.ts LandedTransaction.changeShip
 * -> shipyard_rules' buildChangedShip): the new hull is built, the working
 * copy is pointed at it, and it enters the world with the lift-off's
 * addEntity record. In flight there is no such entity — the player's ship
 * belongs to the simulation, on every peer — so the change has to enter the
 * simulation the way every other change to the player's ship does: as part
 * of an input record, applied identically on every peer at the same tick.
 *
 * THE RECORD CARRIES THE CLASS, NOT THE HULL. A set string that runs in
 * flight is resolved on the owning client against a detached copy of the
 * player (spaceport/ship_mission_accept.ts), exactly as the docked path
 * resolves it: the copy's hull is swapped with the landed path's own
 * buildChangedShip, so C / E / H treat the outfits exactly as they do in a
 * spaceport, and the rest of the string runs on the new hull. What crosses
 * the wire is what the diff of that copy says: the outfit, cargo, credit,
 * bit... DELTAS the in-flight records already carry
 * (mission_accept.ts), plus `shipChange.shipId` — the class the player
 * ended up in. The sim applies the deltas to the live ship and then
 * replaces it with a hull of that class ({@link applyShipChange}), carrying
 * everything that is the PLAYER's rather than the hull's. A delta composes
 * with whatever else the simulation did between the client computing it and
 * the sim applying it, which an encoded hull (absolute credits, cargo,
 * missions) would silently undo.
 *
 * SAME UUID, SAME PLACE IN THE WORLD. The replacement is written at the
 * player's own uuid, so everything keyed on it follows without a remap:
 * ControlledBy / PlayerShipSelector (the control link, the camera, the
 * display's local-player test), the targets other ships hold on the
 * player, escorts' formation leader and ownership chain, bay fighters'
 * carrier, mission ships' owner. nova_ecs gives a replaced uuid the
 * insertion order its key already had (entity_map.ts), so the query
 * caches still visit the player where a wire-restored world does.
 * deriveEntityComponents runs before the write, as for every insertion
 * (rule 11 of docs/rollback_multiplayer.md): the hull enters fully formed.
 *
 * DETERMINISM. Synchronous and free of randomness: the new class's game
 * data (its ShipData, sprite sheet, stock loadout and every weapon closure)
 * is STAGED before the record can apply (simulation_input.ts
 * loadInputRecordsGameData, the host's acceptMission / refuseMission), so
 * the getCached below is warm on every world that applies it. A class the
 * world could not stage is a miss on every world alike, and the change is
 * then skipped, with a warning, everywhere.
 *
 * What the new hull is, beyond the class: fresh armor, shields, fuel and
 * ionization (the stat providers rebuild them from the class — the landed
 * path's buildChangedShip likewise hands over a hull "fully repaired and
 * fuelled"), and the hold carried AS IT IS. The landed path keeps the
 * working cargo too (LandedTransaction.adoptChangedShip moves only the
 * target and the outfits, and the flush writes the working hold onto the
 * new hull), so a hold larger than the new class's is carried rather than
 * jettisoned on both paths.
 */

/**
 * The PLAYER-scoped components that follow the player onto a new hull:
 * the shipyard's purchase, a set string's change of ship docked
 * (spaceport/shipyard_rules' CARRIED_COMPONENTS, which adds the
 * spaceport-only PendingEscortsComponent to this list) and a change of
 * ship in flight ({@link rehullShip}). Everything ship-scoped or derived
 * (ShipData, physics, weapons, shield/armor/fuel/ionization, animation) is
 * deliberately absent so the providers rebuild it for the new ship --
 * which is also what makes the new hull arrive fully repaired and
 * fuelled.
 *
 * Values are shared by reference with the old entity, which the trade
 * leaves untouched; the purchase/change paths that edit any of these
 * replace the value rather than mutating it.
 */
export const PLAYER_STATE_COMPONENTS: readonly Component<any>[] = [
    ControlledByComponent,
    ControlBitsComponent,
    // The player's ränks. Not carrying them wiped every rank the pilot
    // held the moment they traded hulls (ensurePlayerStateComponents seeds
    // the new entity with an empty set), which is plot state, a shipyard
    // gate (rank Contribute) and a price discount (ränk PriceMod) all at
    // once — a second purchase in the same visit would have re-quoted at
    // full price against a grid that had just lost its rank-gated hulls.
    ActiveRanksComponent,
    // ... and the ränk privileges baked off them for the simulation
    // (ncb_plugin's AggressionSuppressGovtsComponent). Carried in the same
    // breath as the ranks: leaving it behind would hand the new hull a
    // pilot whose 0x0100 rank had silently stopped working.
    AggressionSuppressGovtsComponent,
    GameDateComponent,
    MissionsComponent,
    CronStatesComponent,
    PendingMissionNoticesComponent,
    LegalRecordsComponent,
    CombatRatingComponent,
    // The special ships of a mission that auto-aborted at accept THIS
    // landing (mïsn Flags 0x0001 immediate form — the stock enforcement
    // squads, nova:614-629), queued on the hull and spawned only at
    // lift-off (buildMissionShipSpawns). Accept the warning at the main
    // spaceport, buy a ship before lifting off, and the batch stayed on
    // the traded-in hull — the squad the popup promised never came. (PR
    // #142 review finding 1.)
    //
    // Safe to share by reference: a plain list, nothing in it scoped to
    // the hull, and every reader (MissionSession's seed/commit, the
    // lift-off drain) copies or replaces the array rather than mutating it.
    PendingAutoAbortShipsComponent,
    // The PAYROLL MIRROR: the ship-class ids of the escorts drawing a daily
    // wage (player_escort.ts's EscortPayrollComponent). It is the only
    // record of them that exists while the player is docked — the escorts
    // themselves are out of the world on the landed roster — so a hull
    // traded mid-visit arrived with an EMPTY payroll and every date advance
    // for the rest of that docked window charged no wages at all. It
    // re-mirrors itself at liftoff (EscortPayrollSystem), which is what
    // kept the undercharge to one window rather than making it permanent.
    //
    // SAFE TO SHARE BY REFERENCE, like every other entry here: the value is
    // a plain list of ship-class ids naming the ESCORTS, with nothing in it
    // scoped to the hull it sits on, and EscortPayrollSystem replaces the
    // array wholesale rather than mutating it.
    EscortPayrollComponent,
];

/**
 * What a ship IN FLIGHT carries that is the pilot's, not the hull's, on
 * top of {@link PLAYER_STATE_COMPONENTS}: where it is and how it moves
 * (position, velocity, heading and the control state the player is
 * holding), what it has targeted, the jump route it has plotted, and any
 * jump or gate arrival in progress. A docked hull has none of these (the
 * lift-off sets them); an in-flight change keeps them, so the player is
 * the same pilot in the same place, flying a different ship.
 */
export const FLIGHT_STATE_COMPONENTS: readonly Component<any>[] = [
    MovementStateComponent,
    TargetComponent,
    PlanetTargetComponent,
    JumpRouteComponent,
    JumpComponent,
    MultiJumpContinueComponent,
    GateArrivalComponent,
];

/**
 * A fresh hull of class `shipId` for the pilot of `old`: the player- and
 * flight-scoped state carried across ({@link PLAYER_STATE_COMPONENTS},
 * {@link FLIGHT_STATE_COMPONENTS}, credits, cargo, the multiplayer identity
 * and the local-player marker), the given outfits aboard, and nothing of
 * the old hull — every derived component is left for the providers to
 * rebuild against the new class. `old` is not modified.
 */
export function rehullShip(old: Entity, ship: Pick<ShipData, 'id' | 'name'>,
    outfits: ReadonlyMap<string, { count: number }>): Entity {
    const entity = new Entity(ship.name);
    entity.components.set(ShipComponent, { id: ship.id });
    if (old.components.has(PlayerShipSelector)) {
        entity.components.set(PlayerShipSelector, undefined);
    }
    for (const component of [MultiplayerData, ...PLAYER_STATE_COMPONENTS,
        CreditsComponent, CargoComponent, ...FLIGHT_STATE_COMPONENTS]) {
        const value = old.components.get(component as Component<unknown>);
        if (value !== undefined) {
            entity.components.set(component as Component<unknown>, value);
        }
    }
    // Set explicitly: ShipOutfitsProvider derives the stock loadout only
    // when the component is ABSENT, and the outfits are the change's to
    // decide (C / E / H — resolved on the client, see the module note).
    entity.components.set(OutfitsStateComponent, new Map(
        [...outfits].filter(([, { count }]) => count > 0)
            .map(([id, { count }]) => [id, { count }])));
    return entity;
}

/**
 * The outfits aboard after a Cxxx/Exxx/Hxxx ship change (see
 * ShipChangeMode), in OutfitsStateComponent's shape.
 *
 * "Nonpersistent" for Hxxx is oütf flag 0x0020 — "This item is persistent
 * in the case where the player's ship is changed by a mission set
 * operator. The item's normal persistence for when the player buys or
 * captures a new ship is still controlled by the 0x0004 bit" (Bible
 * ~:1968) — NOT the shipyard's 0x0004. Stock sets 0x0020 on the Vell-os
 * weapons (oütf 221-226) precisely so the plot's H-changes into and out
 * of Vell-os hulls keep them.
 */
export function outfitsAfterShipChange(newShip: ShipData,
    outfits: ReadonlyMap<string, number>,
    getOutfit: (id: string) => OutfitData | undefined,
    mode: ShipChangeMode): Map<string, { count: number }> {
    const merged = new Map<string, { count: number }>();
    if (mode !== 'keep') {
        for (const [id, count] of Object.entries(newShip.outfits)) {
            if (count > 0) {
                merged.set(id, { count });
            }
        }
    }
    for (const [id, count] of outfits) {
        if (count <= 0) {
            continue;
        }
        if (mode === 'dropAndGrantDefaults'
            && !getOutfit(id)?.persistentOnShipChange) {
            continue;
        }
        const existing = merged.get(id);
        merged.set(id, { count: (existing?.count ?? 0) + count });
    }
    return merged;
}

/** A change of ship, as an in-flight record carries it. */
export const ShipChangeType = t.type({
    /** The shïp class (global id) the player ends up in. */
    shipId: t.string,
});
export type ShipChange = t.TypeOf<typeof ShipChangeType>;

/**
 * `Mxxx` / `Nxxx`, as an in-flight record carries it: the system (global
 * id, resolved stock-first on the client like every sibling operator) and
 * whether the player keeps their x/y (N) or is put on the system's first
 * stellar (M).
 */
export const SystemMoveType = t.type({
    systemId: t.string,
    keepCoordinates: t.boolean,
});
export type SystemMove = t.TypeOf<typeof SystemMoveType>;

/**
 * Replaces the player's ship at `uuid` with a hull of `change.shipId`,
 * carrying the pilot (see {@link rehullShip}) and the outfits the live ship
 * holds NOW — the record's outfit deltas, which already say what C / E / H
 * did to them, are applied before this runs. Returns the entity the player
 * is in afterwards (the old one when the change could not be made).
 *
 * Synchronous, deterministic, idempotent under rollback: a pure function of
 * the synced entity and the record, and a resimulation restores the
 * pre-change entity before it reapplies. A replay of the same change onto a
 * hull that is already of that class is harmless (the outfits and the
 * pilot are kept; only the hull's derived state is rebuilt).
 */
export function applyShipChange(world: World, uuid: string, player: Entity,
    change: ShipChange): Entity {
    const gameData = world.resources.get(SimulationGameDataResource);
    // Staged before the record could apply (see the module note), so this
    // is warm on every world that applies it — or cold on every one.
    const ship = gameData?.data.Ship.getCached(change.shipId);
    if (!ship) {
        console.warn(`Change of ship to ${change.shipId} ignored: its `
            + 'game data was not staged');
        return player;
    }
    const outfits = player.components.get(OutfitsStateComponent) ?? new Map();
    const next = rehullShip(player, ship, outfits);
    deriveEntityComponents(world, next);
    world.entities.set(uuid, next);
    return next;
}

/**
 * "Move the player to system xxx" (Mxxx / Nxxx), targeted at the player's
 * ship. Emitted by an in-flight record's apply (mission_accept.ts
 * applySetStringEffects) — input application runs immediately before the
 * tick's step, so it is handled at the head of that very step, before any
 * per-tick system, on every peer alike (the queue is empty between steps,
 * which is where every snapshot is taken, so a rollback replays the apply
 * and the event together). Simulation-internal: not forwarded to the
 * display.
 */
export const MissionSystemMoveRequestEvent =
    new EcsEvent<SystemMove>('MissionSystemMoveRequest');

/** The player's ship leaving this system for a set string's Mxxx / Nxxx. */
export interface MissionSystemMove {
    entity: Entity;
    uuid: string;
    systemId: string;
    keepCoordinates: boolean;
}
export const MissionSystemMoveEvent =
    new EcsEvent<MissionSystemMove>('MissionSystemMoveEvent');

const EncodedMissionSystemMove = t.type({
    entity: EncodedEntity,
    uuid: t.string,
    systemId: t.string,
    keepCoordinates: t.boolean,
});

/** The event's bridge codec: the whole serialized entity rides it, as
 * FinishJumpEvent's and GateTransitEvent's do. */
export function MissionSystemMoveEventType(serializer: Serializer) {
    return new t.Type<MissionSystemMove,
        t.TypeOf<typeof EncodedMissionSystemMove>>(
        'MissionSystemMoveEventType',
        (_u): _u is MissionSystemMove => true,
        (input, context) => {
            const encoded = EncodedMissionSystemMove.validate(input, context);
            if (isLeft(encoded)) {
                return encoded;
            }
            const decoded = serializer.decode(encoded.right.entity);
            if (isLeft(decoded)) {
                return t.failure(encoded.right.entity, context,
                    serializer.describeDecodeFailure(
                        encoded.right.entity, decoded.left));
            }
            return t.success({ ...encoded.right, entity: decoded.right });
        },
        data => ({ ...data, entity: serializer.encode(data.entity) }),
    );
}

registerSimulationBridgeEvent({ event: MissionSystemMoveEvent });

/**
 * Carries out a pending Mxxx / Nxxx: the player's escorts are swept onto
 * the client's jump roster (they come along — the alternative strands
 * them in a system their player has left), then the player's ship leaves
 * the world and {@link MissionSystemMoveEvent} hands it to the owning
 * client, which follows it into the destination (client/transit.ts
 * followMissionSystemMove) exactly as it follows a hyperspace jump.
 *
 * What does not ride along: the targets and any jump in progress, which
 * name things in the system being left (the escorts' sweep drops theirs
 * the same way). Runs on every peer, like the jump and gate departures:
 * the removal is shared simulation state; only the owning client follows.
 */
export const MissionSystemMoveSystem = new System({
    name: 'MissionSystemMove',
    events: [MissionSystemMoveRequestEvent],
    args: [MissionSystemMoveRequestEvent, UUID, GetEntity, Entities,
        Emit] as const,
    step(move, uuid, entity, entities, emit) {
        if (!entities.has(uuid)) {
            return;
        }
        // The gate rule ("a gate carries anything"): the mission does the
        // moving, so no escort lacks a hyperdrive for it.
        for (const escortUuid of sweepableEscorts(entities, uuid, 'gate')) {
            const escort = entities.get(escortUuid);
            if (escort) {
                sweepJumpingEscort(escort, escortUuid, move.systemId, uuid,
                    entities, emit);
            }
        }
        entity.components.delete(JumpComponent);
        entity.components.delete(MultiJumpContinueComponent);
        entity.components.delete(TargetComponent);
        entity.components.delete(PlanetTargetComponent);
        entities.delete(uuid);
        deImmerify(entity);
        emit(MissionSystemMoveEvent, {
            entity, uuid,
            systemId: move.systemId,
            keepCoordinates: move.keepCoordinates,
        }, [uuid]);
    },
});

/** Registers the in-flight change-of-ship / move-of-system machinery. */
export const MissionShipChangePlugin: Plugin = {
    name: 'MissionShipChangePlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addEvent(MissionSystemMoveEvent,
            MissionSystemMoveEventType(serializer));
        world.addSystem(MissionSystemMoveSystem);
    },
};
