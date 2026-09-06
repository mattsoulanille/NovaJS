import * as t from 'io-ts';
import { GovtData } from 'novadatainterface/govt_data';
import { Emit, Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { System } from 'nova_ecs/system';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import {
    AmmoOutfitInfo, axesAligned, BoardBlockReason, BoardedComponent,
    BoardedState, boardingBlockedReason, BoardingComponent, BoardingState,
    capturable, captureChance, CaptureBayCandidate, chooseCaptureBay,
    clearPlunderRecord, creditBooty, fuelTransferAmount, planAmmoPlunder,
    planCargoPlunder, plunderSpent,
} from '../ship/index.js';
import { AggressionComponent } from '../combat/index.js';
import { LandEvent } from '../travel/index.js';
import { MissionShipComponent } from '../player/index.js';
import { CargoComponent, cargoUsed } from '../ship/index.js';
import { CollisionHitterComponent } from '../core/index.js';
import { HurtboxHullComponent } from '../core/index.js';
import { OutfitsState, OutfitsStateComponent } from '../ship/index.js';
import { WeaponsState, WeaponsStateComponent } from '../ship/index.js';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import {
    BayFighterComponent, CollectableEscortComponent, refundFighterToBay,
    ReturnComponent, ReturnWhenTargetRemovedComponent,
} from '../escorts/index.js';
import { DisabledComponent, isBelowDisableThreshold, repairedArmor } from '../ship/index.js';
import { EscortCommandComponent } from '../player/index.js';
import { cappedEscortCount, MAX_ESCORTS } from '../escorts/index.js';
import { OwnerComponent, SourceComponent } from '../ship/index.js';
import { FiringGroupComponent } from '../ship/index.js';
import { isInFlock } from '../combat/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { GovtComponent } from '../core/index.js';
import { ArmorComponent } from '../ship/index.js';
import { ShieldComponent } from '../ship/index.js';
import { FuelComponent } from '../ship/index.js';
import {
    formationsIn, FormationComponent, nextFormationSlot, NpcComponent,
    PlayerPlunderedEvent,
} from '../npc/index.js';
import {
    EscortLandingComponent, PlayerEscortComponent,
} from '../player/index.js';
import { CreditsComponent, MissionsComponent } from '../player/index.js';
import { LegalRecords } from '../reputation/index.js';
import { chargeCrime, GovtsResource, LegalRecordsComponent } from '../reputation/index.js';
import {
    ControlledByComponent, ShipControlEvent, ShipControlStateComponent,
} from '../player/index.js';
import {
    ShipComponent, ShipDataComponent, ShipPhysicsComponent,
} from '../ship/index.js';
import { PlayerSoundEvent } from '../core/index.js';
import { TargetComponent } from '../ship/index.js';
import { PersComponent } from '../spawn/index.js';
import { SystemHoldComponent } from '../npc/index.js';

/** Interface beep when a plunder session opens (snd nova:390), heard only
 * by the boarding player (emitted targeted at the boarder). */
export const BOARD_SOUND = 'nova:390';

/**
 * Player-initiated boarding and plundering of disabled ships. See
 * boarding_component.ts for the Bible reference, the components, the
 * tuning constants, and the pure helpers. This module owns the two sim
 * systems and the "boarding blocked" feedback event.
 *
 *  - BoardingGateSystem: the 'board' key. Validates the disabled /
 *    close / slow / axis-aligned gate against the selected target and
 *    either opens a plunder session (BoardingComponent on the boarder +
 *    BoardedComponent on the victim) or emits BoardingBlockedEvent for
 *    the status line.
 *  - BoardingActionSystem: the plunder-dialog actions (take cargo /
 *    credits / fuel, attempt capture, take the capture as an escort,
 *    done). Every action is a replayed control input, so all transfers
 *    and the seeded capture roll happen identically on every peer.
 *
 * The DIALOG is display-side (display/boarding_plugin.ts); it opens and
 * closes by watching the synced BoardingComponent, and its buttons emit
 * these plunder control actions back into the sim. Boarding by NPCs is
 * out of scope (player-initiated only); the gate is only ever reached
 * through the player's control events.
 */

/**
 * Emitted (targeted at the boarding ship) when a board attempt is
 * rejected — mirrors LandingBlockedEvent. Consumed display-side by the
 * status line (status_message_plugin.ts). Never mutates the simulation.
 */
export const BoardingBlockedEvent =
    new EcsEvent<{ reason: BoardBlockReason }>('BoardingBlockedEvent');
export const BoardingBlockedEventType = t.type({
    reason: t.union([
        t.literal('noTarget'), t.literal('notDisabled'), t.literal('noCrew'),
        t.literal('tooFar'), t.literal('tooFast'), t.literal('notAligned'),
        t.literal('alreadyBoarded')]),
});
registerSimulationBridgeEvent({ event: BoardingBlockedEvent });

/**
 * Emitted (targeted at the boarding ship) when the ONE capture attempt a
 * plunder session gets is repelled. The session is over on the same tick,
 * so the dialog is already gone by the time the display sees this — which
 * is exactly why the event exists: the status line is the only place the
 * player is told why (stock STR# 2002 index 124, "Your attempt to capture
 * this ship was unsuccessful."). Never mutates the simulation.
 */
export const BoardingRepelledEvent =
    new EcsEvent<Record<string, never>>('BoardingRepelledEvent');
export const BoardingRepelledEventType = t.type({});
registerSimulationBridgeEvent({ event: BoardingRepelledEvent });

/**
 * Emitted (targeted at the boarding ship) when boarding one of your OWN
 * disabled flock members repairs it in place instead of opening a
 * plunder session. Consumed display-side by the status line
 * (status_message_plugin.ts); never mutates the simulation.
 */
export const EscortRepairedEvent =
    new EcsEvent<Record<string, never>>('EscortRepairedEvent');
export const EscortRepairedEventType = t.type({});
registerSimulationBridgeEvent({ event: EscortRepairedEvent });

/**
 * Emitted (targeted at the boarding ship) when the bay-capture shortcut
 * takes a disabled ship straight into one of the boarder's fighter bays:
 * no plunder session, no capture contest, no dialog — so this event is
 * the ONLY feedback the player gets. Carries the captured ship's class id
 * so the display can name it ("Captured the Viper into your fighter
 * bay."); the sim never reads it back. Consumed display-side by the
 * status line (status_message_plugin.ts).
 */
export const BayCaptureEvent =
    new EcsEvent<{ shipId: string }>('BayCaptureEvent');
export const BayCaptureEventType = t.type({ shipId: t.string });
registerSimulationBridgeEvent({ event: BayCaptureEvent });

/**
 * Builds the planAmmoPlunder inputs from live entities + game data: the
 * victim's outfit counts, the boarder's ammo rounds keyed by weapon, and the
 * ammo-outfit resolver (weapon + capacity, gated on the boarder mounting a
 * launcher for that weapon). Shared by the gate (to freeze ammoAvailable) and
 * the plunder action (to move the rounds), so both agree on what is takeable.
 */
function ammoPlunderInputs(boarderOutfits: OutfitsState | undefined,
    boarderWeapons: WeaponsState | undefined,
    victimOutfits: OutfitsState | undefined,
    gameData: SimulationGameDataInterface) {
    const victim = new Map<string, number>();
    for (const [id, state] of victimOutfits ?? []) {
        victim.set(id, state.count);
    }
    const boarderRoundsByWeapon = new Map<string, number>();
    for (const [id, state] of boarderOutfits ?? []) {
        const weaponId = gameData.data.Outfit.getCached(id)?.ammoFor;
        if (weaponId) {
            boarderRoundsByWeapon.set(weaponId,
                (boarderRoundsByWeapon.get(weaponId) ?? 0) + state.count);
        }
    }
    const info = (outfitId: string): AmmoOutfitInfo | undefined => {
        const outfit = gameData.data.Outfit.getCached(outfitId);
        const weaponId = outfit?.ammoFor;
        if (!weaponId) {
            return undefined;
        }
        // The boarder must mount a launcher for this weapon to hold its ammo.
        const launcher = boarderWeapons?.get(weaponId);
        if (!launcher || launcher.count <= 0) {
            return undefined;
        }
        const weapon = gameData.data.Weapon.getCached(weaponId);
        const capacity = weapon && weapon.maxAmmo > 0
            ? weapon.maxAmmo * launcher.count
            : (outfit.max > 0 ? outfit.max : Infinity);
        return { ammoFor: weaponId, capacity };
    };
    return { victim, boarderRoundsByWeapon, info };
}

/**
 * Charges the BoardPenalty crime ("board") against the victim's
 * government. Shared by the plunder session's once-per-session charge and
 * by the bay-capture shortcut, so a capture carries exactly the same legal
 * consequence however it happened. A victim with no government (your own
 * escorts, and anything already stripped of its GovtComponent) is a no-op.
 */
function applyBoardCrime(boarder: Entity, records: LegalRecords | undefined,
    govtId: string | undefined, gameData: SimulationGameDataInterface,
    govts: ReadonlyMap<string, GovtData> | undefined): void {
    if (!records || !govtId) {
        return;
    }
    const govtData = gameData.data.Govt.getCached(govtId);
    if (govtData) {
        // Records AND the ränk 0x0040 revocation ("any crime against the
        // affiliated government"), through the one charge the kill and
        // disable credits use (reputation_plugin.ts).
        chargeCrime(boarder, govtData, 'board', gameData, govts);
    }
}

/**
 * Brings a disabled hulk back online: armor to just above its disable
 * threshold (`repairedArmor`, the established threshold + 10% margin used
 * by self-repair, the hail assist, and capture), shields to full, and
 * DisabledComponent dropped so DisabledMovementSystem stops braking it and
 * the formation/escort brains can steer it again.
 *
 * Matthew's spec words item 5 as "its minimum un-disabled armor value",
 * which taken literally is the threshold itself with no margin. The margin
 * is kept deliberately: a ship parked exactly AT the threshold satisfies
 * `isBelowDisableThreshold` (the comparison is <=), so it would be
 * re-disabled by ShipDisableSystem on the next tick, and every other
 * repair path in the game already uses the margin.
 */
function repairHulk(target: Entity): void {
    const shipData = target.components.get(ShipDataComponent);
    const armor = target.components.get(ArmorComponent);
    if (armor && shipData
        && isBelowDisableThreshold(armor, shipData.disableArmorFraction)) {
        armor.current = repairedArmor(armor.max, shipData.disableArmorFraction);
    }
    const shield = target.components.get(ShieldComponent);
    if (shield) {
        shield.current = shield.max;
    }
    target.components.delete(DisabledComponent);
}

/**
 * The boarder's mounted bay weapons, described for the bay-capture
 * shortcut (see CaptureBayCandidate). Everything here is read off synced
 * simulation state — the boarder's WeaponsState and magazine, and the live
 * entity map — plus static game data, so every peer builds the same list.
 *
 * Deployed fighters are counted straight from the entity map: a live
 * entity is one of this bay's deployed fighters when its
 * BayFighterComponent names this bay AND its SourceComponent is the
 * boarder. That is a count, so entity iteration order cannot change it.
 *
 * The `getCached` reads are legitimate under the determinism rule (a
 * getCached MISS must never change what the simulation does): entity
 * staging loads a ship's outfits, those outfits' weapons — bays included,
 * recursively with the fighter ship classes they launch — and the outfit
 * data itself before the entity is ever inserted (loadEntityGameData /
 * loadShipGameData), so on every peer a MOUNTED bay's wëap and its ammo
 * outfits are already cached. This is the same staging guarantee
 * ammoPlunderInputs relies on.
 */
function captureBayCandidates(boarderUuid: string,
    boarderWeapons: WeaponsState | undefined,
    boarderOutfits: OutfitsState | undefined,
    entities: EntityMap,
    gameData: SimulationGameDataInterface): CaptureBayCandidate[] {
    if (!boarderWeapons) {
        return [];
    }
    const candidates: CaptureBayCandidate[] = [];
    for (const [weaponId, state] of boarderWeapons) {
        if (state.count <= 0) {
            continue;
        }
        const weapon = gameData.data.Weapon.getCached(weaponId);
        if (weapon?.type !== 'BayWeaponData') {
            continue;
        }
        let held = 0;
        for (const [outfitId, outfitState] of boarderOutfits ?? []) {
            if (gameData.data.Outfit.getCached(outfitId)?.ammoFor
                === weaponId) {
                held += outfitState.count;
            }
        }
        let deployed = 0;
        for (const [, other] of entities) {
            if (other.components.get(BayFighterComponent)?.bayWeaponId
                === weaponId
                && other.components.get(SourceComponent) === boarderUuid) {
                deployed++;
            }
        }
        candidates.push({
            bayWeaponId: weaponId,
            shipId: weapon.shipID,
            maxAmmo: weapon.maxAmmo,
            mounted: state.count,
            held,
            deployed,
        });
    }
    return candidates;
}

/**
 * Who a repaired former escort should hold formation on: its own live
 * leader if it still has one, else the carrier it was last attached to
 * (PlayerEscort.parent — so a carrier escort's wing goes back to the
 * carrier rather than being promoted to a direct escort), else the boarder.
 * Every candidate must be a live ship that is the boarder or inside the
 * boarder's flock, so a stale link can never re-attach the ship to
 * somebody else's leader.
 */
function escortLeaderFor(target: Entity, targetUuid: string,
    boarderUuid: string, entities: EntityMap): string {
    const usable = (candidate: string | undefined): candidate is string =>
        candidate !== undefined && candidate !== targetUuid
        && entities.has(candidate)
        && (candidate === boarderUuid
            || isInFlock(candidate, boarderUuid, u => entities.get(u)));
    const leader = target.components.get(FormationComponent)?.leader;
    if (usable(leader)) {
        return leader;
    }
    const parent = target.components.get(PlayerEscortComponent)?.parent;
    if (usable(parent)) {
        return parent;
    }
    return boarderUuid;
}

/**
 * Puts a repaired escort back to work: formation link, the default
 * 'formation' command, and the player's firing group — the same stamps
 * EscortReattachSystem applies when a player returns to the world, and the
 * same set convertToEscort applies to a fresh capture.
 *
 * Needed because a FORMER escort's live chain can have lapsed in ways
 * EscortReattachSystem will not fix on its own: it only re-attaches an
 * escort whose `detached` flag is set (i.e. one whose player left the
 * world). A fighter orphaned by its carrier escort dying, with the player
 * present the whole time, keeps its durable PlayerEscortComponent but
 * never gets a new formation link.
 *
 * An existing link to the SAME leader keeps its slot (no free station
 * shuffle); anything else gets the next free slot.
 */
function reattachEscort(target: Entity, leaderUuid: string,
    playerUuid: string, entities: EntityMap): void {
    const formation = target.components.get(FormationComponent);
    target.components.set(FormationComponent, {
        leader: leaderUuid,
        slot: formation?.leader === leaderUuid ? formation.slot
            : nextFormationSlot(formationsIn(entities), leaderUuid),
    });
    target.components.set(EscortCommandComponent, { command: 'formation' });
    target.components.set(FiringGroupComponent, { group: playerUuid });
    // A landing order aimed at a stellar is meaningless now that the ship
    // is back in formation (EscortReattachSystem drops it for the same
    // reason).
    target.components.delete(EscortLandingComponent);
    const owned = target.components.get(PlayerEscortComponent);
    if (owned?.detached) {
        owned.detached = false;
    }
}

/**
 * The bay-capture shortcut's effect: the disabled hulk is STOWED in the
 * boarder's bay. One round is credited to the magazine — the same credit
 * refundFighterToBay gives a fighter that docks — and the hulk's entity is
 * removed from the world.
 *
 * WHY STOWED RATHER THAN DEPLOYED (Matthew's playtest ruling; the status
 * message has always said "Captured the X into your fighter bay"): the
 * shortcut used to mint the hulk into a DEPLOYED fighter flying formation
 * on its captor, which read to the player as "it just flies around" —
 * nothing was in the bay, and the ship the message named was still out
 * there. Stowing makes the message literally true, and it sidesteps the
 * stale-identity hazards a converted hulk carried (see convertToEscort).
 * Launching it again mints a fresh fighter from the bay's ship class, the
 * same as any other round in the magazine.
 *
 * WHAT IS LOST, inherently: the hulk's damage, outfits, cargo and name.
 * A bay round is not a ship — it is an ammo count — and a launched fighter
 * is built from the bay weapon's shipID with that class's stock loadout.
 * There is nowhere in the data model to keep a stowed ship's individual
 * state, so a captured fighter re-launches as a factory-fresh one.
 *
 * Returns false when the credit could not be made (the boarder holds no
 * ammo outfit that supplies this bay, so there is no magazine to credit).
 * The caller then leaves the hulk alone and falls through to the ordinary
 * boarding paths rather than deleting a ship for nothing. The gate's room
 * check (chooseCaptureBay) already guarantees the capacity half.
 */
function stowCaptureIntoBay(targetUuid: string, bayWeaponId: string,
    boarder: Entity, entities: EntityMap,
    gameData: SimulationGameDataInterface): boolean {
    if (!refundFighterToBay(boarder, bayWeaponId, gameData)) {
        return false;
    }
    entities.delete(targetUuid);
    return true;
}

/**
 * The 'board' key. With a disabled ship selected and the boarder pulled
 * alongside (close, matched speed, axis-aligned), one of three things
 * happens, in this precedence order:
 *
 *  1. BAY CAPTURE (Matthew's item 6). The hulk is a ship class one of the
 *     boarder's bays launches, and that bay has room: it is captured
 *     instantly into the bay as a deployed fighter — no session, no
 *     contest, no dialog, no PRNG draw. This deliberately OVERRIDES the
 *     repair path below, so a disabled fighter of your own that fits with
 *     room is re-adopted by the bay rather than merely patched up.
 *  2. OWN-ESCORT REPAIR (item 5). The hulk is in the boarder's live flock
 *     OR durably marked as the boarder's escort (PlayerEscortComponent —
 *     the "former escort" case, whose live chain lapsed while it was
 *     disabled, landed, or orphaned): it is repaired in place and put back
 *     to work in formation. No plunder session.
 *  3. PLUNDER. Anything else opens the normal plunder session.
 *
 * A session already open, or a target already being boarded, is left alone.
 */
const BoardingGateSystem = new System({
    name: 'BoardingGateSystem',
    events: [ShipControlEvent] as const,
    args: [ShipControlStateComponent, MovementStateComponent,
        ShipDataComponent, TargetComponent, Optional(BoardingComponent),
        Optional(OutfitsStateComponent), Optional(WeaponsStateComponent),
        Optional(LegalRecordsComponent), Optional(GovtsResource),
        GetEntity, UUID, Entities, SimulationGameDataResource, Emit] as const,
    step(controls, movement, _shipData, target, boarding, boarderOutfits,
        boarderWeapons, records, govts, entity, uuid, entities, gameData,
        emit) {
        if (controls.get('board') !== 'start') {
            return;
        }
        // One session at a time.
        if (boarding) {
            return;
        }

        const targetUuid = target.target;
        const targetEntity =
            targetUuid !== undefined && targetUuid !== uuid
                ? entities.get(targetUuid) : undefined;
        const targetShipData = targetEntity?.components.get(ShipDataComponent);
        const targetMovement =
            targetEntity?.components.get(MovementStateComponent);

        // A ship someone is plundering RIGHT NOW can't be boarded on top
        // of them. Treated as "nothing to board" for feedback purposes.
        // A hulk whose previous session has ended is boardable again —
        // that is what lets a repelled capture be retried (see
        // BoardedState); what it already gave up stays given up.
        //
        // The `active` flag is corroborated against the named boarder
        // rather than trusted on its own, so the lock is self-healing: a
        // boarder that was destroyed, jumped out, or landed mid-session
        // never runs its session-end path, and a bare flag would strand
        // the hulk unboardable for the rest of the game.
        const boarded = targetEntity?.components.get(BoardedComponent);
        const boarderStillAboard = boarded !== undefined
            && entities.get(boarded.boarder)?.components
                .get(BoardingComponent)?.target === targetUuid;
        if (boarded?.active && boarderStillAboard) {
            emit(BoardingBlockedEvent, { reason: 'notDisabled' }, [uuid]);
            return;
        }

        const distanceSquared = targetMovement
            ? targetMovement.position.subtract(movement.position).lengthSquared
            : Infinity;
        const relSpeedSquared = targetMovement
            ? targetMovement.velocity.subtract(movement.velocity).lengthSquared
            : Infinity;
        const aligned = !!targetMovement
            && axesAligned(movement.rotation, targetMovement.rotation);

        const reason = boardingBlockedReason({
            hasTarget: !!targetEntity && !!targetShipData && !!targetMovement,
            targetDisabled: !!targetEntity?.components.has(DisabledComponent),
            targetCrew: targetShipData?.crew ?? 0,
            distanceSquared,
            relSpeedSquared,
            aligned,
        });
        if (reason) {
            emit(BoardingBlockedEvent, { reason }, [uuid]);
            return;
        }

        // A ship somebody is FLYING is never captured, by either route
        // (see capturable). Its pilot keeps command of it; the plunder
        // session below is still open to a pirate.
        const capturableTarget = capturable(targetEntity!);

        // 1. BAY CAPTURE. A hulk of a ship class one of the boarder's bays
        // launches, with room for it, is STOWED straight into that bay: no
        // session, no contest, no dialog, and — note for the rollback/replay
        // discipline — no draw from the seeded RandomResource, so pressing
        // 'board' on a bay-capturable hulk never shifts the PRNG sequence
        // for anything else.
        const targetShipId =
            targetEntity!.components.get(ShipComponent)?.id;
        const captureBay = targetShipId === undefined || !capturableTarget
            ? undefined
            : chooseCaptureBay(targetShipId, captureBayCandidates(
                uuid, boarderWeapons, boarderOutfits, entities, gameData));
        // The crime is read BEFORE the hulk leaves the world, and charged
        // only once the stow actually happened.
        const targetGovtId = targetEntity!.components.get(GovtComponent)?.id;
        if (captureBay !== undefined && stowCaptureIntoBay(
            targetUuid!, captureBay, entity, entities, gameData)) {
            applyBoardCrime(entity, records, targetGovtId, gameData, govts);
            // Same memory sweep the plunder-dialog capture runs: the hull
            // is gone from the world, so nothing can shoot it any more,
            // but no NPC is left carrying an aggressor slot or a target
            // lock naming a uuid that no longer exists, and the two
            // capture routes leave identical state behind.
            clearHostilityToward(targetUuid!, entities);
            // The prize's wing does not come with it here either. The
            // dangling links would eventually be cleaned up by
            // FormationSystem's leader-gone rule (the prize has left the
            // world), but that scatters the wing instead of regrouping it,
            // and it would leave the fighters' bay identity pointing at a
            // hull the player has stowed.
            reassignCapturedWing(targetUuid!, entities);
            // The prize is gone from the world; leaving it selected would
            // point the HUD at an entity that no longer exists.
            target.target = undefined;
            emit(BayCaptureEvent, { shipId: targetShipId! }, [uuid]);
            return;
        }

        // 2. Boarding your OWN disabled escort (a hired or captured escort,
        // or one of your bay fighters) does NOT plunder it: it repairs it
        // in place and puts it back to work. The boarding gate above still
        // applies (close, slow, axis-aligned).
        //
        // Two ways to qualify, deliberately belt-and-braces: the live flock
        // chain reaches the boarder (isInFlock), or the durable ownership
        // marker names the boarder (PlayerEscortComponent — a FORMER
        // escort, whose live chain lapsed while it sat disabled through a
        // landing round trip, a jump it could not follow, or the death of
        // the carrier escort it flew from).
        //
        // A fighter boarding on the player's behalf is NOT covered: only
        // the boarder itself is compared against, never the boarder's flock
        // root. Boarding is player-initiated (this system only ever runs
        // off a player's control events), so the boarder IS the player
        // ship; widening it would need a flock-root walk for a case that
        // cannot arise today.
        const owned = targetEntity!.components.get(PlayerEscortComponent);
        if (isInFlock(targetUuid!, uuid, u => entities.get(u))
            || owned?.player === uuid) {
            repairHulk(targetEntity!);
            // It was an escort, so it goes back to being one: formation
            // link, default command, player's firing group. Cheap and
            // idempotent for a ship whose links never lapsed.
            reattachEscort(targetEntity!,
                escortLeaderFor(targetEntity!, targetUuid!, uuid, entities),
                uuid, entities);
            emit(EscortRepairedEvent, {}, [uuid]);
            return;
        }

        // Freeze the compatible ammo the boarder could take (same inputs the
        // plunderAmmo action uses), so the dialog can show/grey Ammo.
        const { victim, boarderRoundsByWeapon, info } = ammoPlunderInputs(
            boarderOutfits, boarderWeapons,
            targetEntity!.components.get(OutfitsStateComponent), gameData);
        const ammoAvailable = planAmmoPlunder(victim, boarderRoundsByWeapon, info)
            .reduce((sum, [, rounds]) => sum + rounds, 0);

        // 3. ONE PLUNDER PER LIFE SEGMENT (Matthew's ruling; see
        // BoardedState). The hulk's one boarding has already been spent —
        // by this player, by a rival, or by an NPC pirate that reached it
        // first — so no plunder session may open, however many times it is
        // repaired and disabled again. It resets only when the ship lands
        // and departs, or jumps (clearPlunderRecord).
        //
        // CHECKED HERE, past the bay-capture and own-escort branches, on
        // purpose: neither of those is plunder, and Matthew's ruling
        // exempts non-plunder boarding ("repairing/refuelling your own
        // disabled escort, fuel transfer") outright. So you can still
        // patch up your own hulk, and still scoop a fitting hull into a
        // bay, after somebody has stripped it.
        //
        // MISSION BOARDING IS THE SAME CHANNEL, NOT A SEPARATE ONE — the
        // rule chosen for mïsn ShipGoal 2 ("Board them"), where the
        // alternative was a parallel mission-only board that ignored the
        // record. One boarding does everything: it spends the ship's one
        // plunder, credits the goal (MissionShipTrackSystem), and loads
        // mïsn PickupMode 2 cargo. One channel is right because the Bible
        // describes no second one — the goal is literally "board them",
        // the same verb — and because two channels would mean the player
        // boarding a mission ship twice, taking its booty on the second
        // pass after the first was "only for the mission".
        //
        // That cannot lock a mission out. The refusal only ever fires for
        // a ship SOMEBODY ELSE spent, and the only somebody else who can
        // is a rival player: NPC pirates skip mission ships outright
        // (gövt Flags 0x1000 is "non-mission", enforced in
        // npcPlunderEligible). A ship a rival stole never incremented the
        // objective's `satisfied`, so the mission simply spawns its
        // replacement on the next system entry (shipsToSpawn is
        // total - satisfied) and the goal stays achievable.
        if (plunderSpent(boarded)) {
            emit(BoardingBlockedEvent, { reason: 'alreadyBoarded' }, [uuid]);
            return;
        }

        // BOARD-OFFERED MISSIONS (përs Flags 0x0200) ride this same
        // session. The sim cannot see them — përs/mïsn data is display-
        // side game data — so the session opens exactly as it does for
        // any other hulk, and the DISPLAY decides what the player sees:
        // it shows the offer in place of the plunder dialog and then
        // sends 'plunderOfferOnly', which ends the session and gives the
        // hulk its one plunder back (see endBoardingForOffer). Capture is
        // deliberately independent of the offer: a derelict whose mission
        // is already taken must still be plunderable and capturable,
        // which is what that hand-back guarantees.
        //
        // The session is seeded from whatever the hulk has already given
        // up. With the one-plunder rule above there is nothing left to
        // carry over in practice — the only way to reach here with a prior
        // record is a record whose `plundered` flag is somehow absent —
        // but the booty flags are kept as belt-and-braces, because the
        // credits booty is the one thing NOT physically removed from the
        // victim (creditBooty re-derives it from the ship price every
        // time) and so the only one a second session could duplicate.
        const priorBoarded = boarded;
        entity.components.set(BoardingComponent, {
            target: targetUuid!,
            creditsAvailable: creditBooty(targetShipData!.price),
            ammoAvailable,
            cargoTaken: priorBoarded?.cargoTaken ?? false,
            creditsTaken: priorBoarded?.creditsTaken ?? false,
            fuelTaken: priorBoarded?.fuelTaken ?? false,
            ammoTaken: priorBoarded?.ammoTaken ?? false,
            capture: 'none',
            // Piracy is charged per session: a fresh boarding that takes
            // booty or tries a capture earns the BoardPenalty again.
            crimeApplied: false,
        });
        // The durable record is stamped the moment the session OPENS, not
        // when booty is taken: a boarder who looks around and leaves has
        // still spent this hulk's one boarding, and an UNGRACEFUL end
        // (destroyed, jumped out, landed mid-session) must not hand the
        // hulk back for a second go.
        targetEntity!.components.set(BoardedComponent, {
            ...priorBoarded, boarder: uuid, active: true, plundered: true,
        });
        // Local boarding beep for the boarding player only.
        emit(PlayerSoundEvent, { id: BOARD_SOUND }, [uuid]);
    },
});

/**
 * Records a booty action on the HULK's durable BoardedComponent at the
 * moment that action applies, rather than when the session ends.
 *
 * WHY AT ACTION TIME. The durable flags are what stop a booty being taken
 * twice, and credits are the only booty that is not physically removed
 * from the victim (`creditsAvailable` is re-derived from the ship class
 * price by creditBooty on every board). Accumulating the flags only in
 * `endBoardingSession` meant every UNGRACEFUL end — the boarder is
 * destroyed, jumps out, or lands mid-session — left the hulk's
 * `creditsTaken` false while the credits were already banked. The stale-
 * boarder corroboration in BoardingGateSystem then re-opens boarding on
 * that hulk, and the money booty comes back: an unbounded credit farm of
 * "take credits, die/jump/land, board again". Writing the flag as the
 * transfer happens closes that for all four booties.
 *
 * The boarder's session-side flag is still set by the caller: it drives
 * the dialog's greying and the per-action idempotency under replayed
 * inputs. This is the DURABLE half.
 *
 * A hulk with no BoardedComponent (it should always have one — the gate
 * sets it when the session opens) gets a fresh one rather than silently
 * dropping the record.
 */
function markBootyTaken(target: Entity, boarderUuid: string,
    flag: 'cargoTaken' | 'creditsTaken' | 'fuelTaken' | 'ammoTaken'): void {
    const boarded = target.components.get(BoardedComponent);
    if (boarded) {
        boarded[flag] = true;
        return;
    }
    target.components.set(BoardedComponent,
        { boarder: boarderUuid, active: true, [flag]: true });
}

/**
 * ============================================================================
 * A BOARDING THAT ONLY OFFERED A MISSION DOES NOT SPEND THE HULK'S PLUNDER
 * ============================================================================
 * (Matthew's ruling, authoritative)
 *
 * A përs with Flags 0x0200 offers "the ship's LinkMission when boarding it
 * instead of when hailing it" (EVN Bible), and the original shows the
 * mission text and NOTHING ELSE for that boarding — no plunder dialog, no
 * capture dialog. The display enforces the screen half (see
 * boardingDialogPhase) and then sends this action, which is the SIM half:
 *
 *  1. the session ends, exactly as 'plunderDone' would; and
 *  2. the hulk's durable `plundered` record is put BACK the way it was.
 *
 * WHY (2). BoardingGateSystem stamps `plundered: true` the instant a
 * session opens, so that a boarder who merely looks around has still spent
 * the hulk's one boarding (see BoardedState). But a boarding that only
 * produced an offer is not a plunder at all — the player never saw a
 * plunder screen — so charging it the one-per-life-segment plunder would
 * mean a mission derelict could NEVER be robbed. Restoring the flag leaves
 * the derelict plunderable by a later boarding, once its offer is spent
 * (accepted) and there is no mission left to show. That is the "leave the
 * plundered flag untouched" half of the ruling: the gate refuses to open a
 * session at all while `plunderSpent`, so the value being restored is
 * provably `false`.
 *
 * The rest of the record is left alone: `boarder` and the four booty flags
 * are untouched (nothing was taken — the plunder dialog never opened), and
 * `active` is cleared by endBoardingSession like any other session end.
 *
 * NOT A MISSION-GOAL HAZARD. mïsn ShipGoal 2/5 credit a boarding by
 * reading this same `plundered` record (MissionShipTrackSystem), so
 * clearing it would un-credit a goal — except that this action can only
 * ever be sent for a hull carrying a PersComponent (presentShipOffer
 * refuses without one) and mission special ships never carry one
 * (mission_ship_spawn stamps MissionShipComponent, never PersComponent).
 * The two populations are disjoint.
 */
function endBoardingForOffer(entity: Entity,
    target: Entity | undefined): void {
    const boarded = target?.components.get(BoardedComponent);
    // The sim enforces the "përs only" population itself rather than
    // trusting the sender: a stray or forged 'plunderOfferOnly' for an
    // ordinary hulk (or a mission special ship) must not hand back a
    // spent plunder — that would be a credit farm, and for a mission
    // ship would un-credit a ShipGoal 2/5 boarding (review r13 MEDIUM).
    // For a non-përs target this is just an ordinary session end.
    if (boarded && target?.components.has(PersComponent)) {
        boarded.plundered = false;
    }
    endBoardingSession(entity, target);
}

/**
 * Closes a plunder session without capturing: the boarder drops its
 * BoardingComponent and the hulk's BoardedComponent goes INACTIVE.
 *
 * The booty record is NOT written here — `markBootyTaken` has already
 * stamped each booty on the hulk as it was taken, so an ungraceful end
 * (boarder destroyed, jumped, or landed) loses nothing. All this path
 * still owns is releasing the mutual-exclusion lock.
 *
 * The hulk stays MARKED as boarded — the mission-goal seam
 * (mission_ship_state.ts shipBoarded) reads presence, not activity — but
 * it becomes boardable again, which is what makes a repelled capture
 * retryable. See BoardedState for why the booty flags must survive and
 * the capture state must not.
 */
function endBoardingSession(entity: Entity,
    target: Entity | undefined): void {
    entity.components.delete(BoardingComponent);
    const boarded = target?.components.get(BoardedComponent);
    if (!target || !boarded) {
        return;
    }
    target.components.set(BoardedComponent, { ...boarded, active: false });
}

/**
 * ============================================================================
 * CAPTURE RESETS HOSTILITY (Matthew's ruling, authoritative)
 * ============================================================================
 *
 * A prize must come out of a capture standing exactly where a freshly
 * HIRED escort of the same player stands: hostile only to whoever is
 * hostile to the player. Shedding the hull's government (convertToEscort)
 * is only half of that — it fixes what the prize IS, and leaves untouched
 * what every other ship in the system REMEMBERS about it. Those memories
 * are what kept a fresh prize under fire from the fleet it had just left.
 *
 * THE AUDIT, of every synced thing that can make an NPC keep shooting at
 * a particular ship:
 *
 *  CLEARED HERE
 *   - `TargetComponent.target` of any NPC pointing at the prize, with the
 *     attack posture it is flying (`NpcComponent.mode === 'attack'`) —
 *     this is the live lock. The think timer is zeroed too, so the ship
 *     re-plans on the very next tick instead of orbiting an ex-enemy for
 *     up to a full decision interval.
 *   - `NpcComponent.aggressor`, the "who hit me last" memory. This is the
 *     durable half: NpcDecisionSystem feeds the aggressor straight back
 *     into `engageable` for warships and interceptors and makes traders
 *     fight or flee, so leaving it set re-acquires the prize on the next
 *     think even after the target slot is cleared.
 *   - `AggressionComponent` entries keyed by the prize, on every ship
 *     that has one. That component only lives on player-controlled ships
 *     (aggression.ts), so this is the PvP half of the same idea: without
 *     it, a rival player whose shields the prize dented ten seconds ago
 *     goes on seeing red corners on their fellow player's new escort, and
 *     'r' goes on picking it.
 *
 *  DELIBERATELY NOT TOUCHED, with reasons:
 *   - `NpcComponent.pacifiedFrom` naming the prize: that is a bribe to
 *     LEAVE IT ALONE. Clearing it would restore hostility, not remove it.
 *   - The prize's own outbound state — its target, mode and aggressor —
 *     is cleared by convertToEscort itself, which owns the prize.
 *   - Any ship holding FORMATION on the prize (its old fleet's wing, or
 *     its own bay fighters). Formation membership is not a reason to
 *     shoot the prize — it is the opposite — so it is not hostility, and
 *     re-parenting somebody else's fleet is a much larger question than
 *     this one. SEE THE REPORT: a captured fleet LEADER drags its former
 *     wing into the player's flock (they keep formation on it, so
 *     flock.ts walks them up to the player), and those followers keep
 *     their old government and their own aggressor memories — including,
 *     often, the player. That is a real inconsistency, it predates this
 *     change, and it needs a ruling of its own.
 *   - `PersComponent`: a name tag and the "one of each person alive"
 *     spawn guard, not a hostility input. A captured përs escort keeping
 *     the character's name is a feature.
 *   - `GovtsResource` / anything cache-shaped: there is none. Hostility
 *     is recomputed from live components every time it is asked for
 *     (hostility.ts, govt_disposition.ts), so dropping GovtComponent is
 *     immediately visible to every reader with nothing to invalidate.
 *
 * DETERMINISM. The sweep visits the entity map in UUID-SORTED order.
 * Nothing it writes actually depends on visit order (each entity's edit
 * is a function of that entity alone), but the sort is kept because it
 * makes that independence checkable rather than merely true today, and it
 * is the house rule for cross-entity work. No PRNG is drawn.
 *
 * Called for BOTH capture routes. The bay-capture shortcut deletes the
 * hulk outright, so its hostility is moot on the next think — but the
 * memories are cleaned there too, so a stale aggressor slot is never left
 * pointing at a uuid that no longer exists, and the two routes leave the
 * world in the same shape.
 */
export function clearHostilityToward(prizeUuid: string,
    entities: EntityMap): void {
    for (const uuid of [...entities.keys()].sort()) {
        if (uuid === prizeUuid) {
            continue;
        }
        const other = entities.get(uuid);
        if (!other) {
            continue;
        }
        const npc = other.components.get(NpcComponent);
        if (npc) {
            if (npc.aggressor === prizeUuid) {
                npc.aggressor = undefined;
            }
            const otherTarget = other.components.get(TargetComponent);
            if (otherTarget?.target === prizeUuid) {
                otherTarget.target = undefined;
                if (npc.mode === 'attack') {
                    npc.mode = undefined;
                }
                // Re-plan on the next tick rather than at the end of the
                // current decision interval.
                npc.nextDecision = 0;
            }
        }
        other.components.get(AggressionComponent)?.delete(prizeUuid);
    }
}

/**
 * ============================================================================
 * THE CAPTURED LEADER'S WING (Matthew's ruling)
 * ============================================================================
 *
 * Capturing a fleet LEADER used to hand you its whole wing by accident.
 * An NPC fleet shares two links, both naming the leader's uuid
 * (npc_spawn_plugin): every escort holds FormationComponent.leader on it
 * AND FiringGroupComponent.group on it, so that fleetmates' shots pass
 * through each other. flock.ts walks exactly those two edges, so the
 * moment convertToEscort re-parented the leader onto the player, every
 * follower's chain ran leader -> player: they painted FRIENDLY, dropped
 * out of the tab/r cycle, and the player's shots passed through them —
 * while they kept their own government, their own aggressor memories, and
 * their own reasons to kill the player. "Says it's mine, shoots at me,
 * and I can't shoot back."
 *
 * MATTHEW'S RULING: the wing keeps its original government and
 * allegiance — it is not part of the prize — and it ELECTS A NEW LEADER
 * from among itself.
 *
 * THE ELECTION RULE (his exact rule was open; this is the deterministic
 * one, documented so it can be changed in one place): the surviving wing
 * member with the highest shïp Strength takes command, ties broken by the
 * lexicographically smallest uuid. Strength is the Bible's own measure of
 * how much ship a ship is (gövt MaxOdds is computed from it), so "the
 * biggest one left" is both the intuitive answer and one every peer
 * computes identically from synced state. The new leader sheds its own
 * formation link and becomes its own firing-group root; the rest re-form
 * on it in uuid order, so slot assignment cannot depend on entity-map
 * iteration order.
 *
 * BAY FIGHTERS ARE DIFFERENT, and Matthew called this out separately: a
 * captured CARRIER's launched fighters are not a fleet that can elect
 * anybody, they are ordnance whose hangar just changed hands. They take
 * the existing orphaned-fighter path (bay_plugin's
 * OrphanedBayFighterSystem): an aiType-3 brain in 'depart' mode, so they
 * fly out of the system. That system cannot do it itself here, because it
 * only fires when the carrier is GONE from the world — after a
 * plunder-dialog capture the carrier is very much still there, flying for
 * the other side. The bay identity is shed in full for the same reason it
 * is shed from the prize (see convertToEscort): a live launch link back
 * to a hull the player now owns is what makes a ship half-owned.
 *
 * AFTERWARDS NOTHING IN THE WING REACHES THE PLAYER. Each follower's
 * chain now ends at the new leader, and the new leader's own firing group
 * names itself, so flock.ts's walk terminates there (`parent === current`
 * is its stop condition) rather than climbing to the captor.
 *
 * Ships already marked as the captor's own (PlayerEscortComponent) are
 * left alone: they are genuinely the player's. The wing cannot be
 * mislabelled that way in the meantime, because this sweep runs inside
 * the capture itself, before MarkPlayerEscortsSystem's next pass.
 *
 * DETERMINISM: one uuid-sorted sweep, no PRNG, and every decision is a
 * function of synced components alone.
 */
export function reassignCapturedWing(prizeUuid: string,
    entities: EntityMap): void {
    const wing: string[] = [];
    const fighters: string[] = [];
    for (const uuid of [...entities.keys()].sort()) {
        if (uuid === prizeUuid) {
            continue;
        }
        const other = entities.get(uuid);
        if (!other || other.components.has(PlayerEscortComponent)) {
            continue;
        }
        const follows =
            other.components.get(FormationComponent)?.leader === prizeUuid
            || other.components.get(FiringGroupComponent)?.group === prizeUuid
            || other.components.get(OwnerComponent)?.owner === prizeUuid;
        if (!follows) {
            continue;
        }
        if (other.components.has(BayFighterComponent)
            || other.components.get(SourceComponent) === prizeUuid) {
            fighters.push(uuid);
        } else {
            wing.push(uuid);
        }
    }

    for (const uuid of fighters) {
        const fighter = entities.get(uuid)!;
        // The launch link, in full — the same set convertToEscort sheds
        // from the prize, and for the same reason.
        fighter.components.delete(BayFighterComponent);
        fighter.components.delete(SourceComponent);
        fighter.components.delete(OwnerComponent);
        fighter.components.delete(ReturnWhenTargetRemovedComponent);
        fighter.components.delete(ReturnComponent);
        fighter.components.delete(CollectableEscortComponent);
        fighter.components.delete(CollisionHitterComponent);
        fighter.components.delete(HurtboxHullComponent);
        // ...and the orphan treatment itself (OrphanedBayFighterSystem).
        fighter.components.delete(EscortCommandComponent);
        fighter.components.delete(FormationComponent);
        fighter.components.delete(EscortLandingComponent);
        fighter.components.set(FiringGroupComponent, { group: uuid });
        fighter.components.set(NpcComponent, { aiType: 3, mode: 'depart' });
    }

    if (wing.length === 0) {
        return;
    }
    // The election: most ship, then smallest uuid. `wing` is already in
    // uuid order, so a strict `>` keeps the first (smallest) of a tie.
    let leader = wing[0];
    let best = entities.get(leader)?.components
        .get(ShipDataComponent)?.strength ?? 0;
    for (const uuid of wing) {
        const strength = entities.get(uuid)?.components
            .get(ShipDataComponent)?.strength ?? 0;
        if (strength > best) {
            leader = uuid;
            best = strength;
        }
    }
    let slot = 0;
    for (const uuid of wing) {
        const ship = entities.get(uuid)!;
        // The whole wing regroups under the new leader, keeping its
        // government, its NPC brain and every grudge it was holding.
        ship.components.set(FiringGroupComponent, { group: leader });
        if (uuid === leader) {
            ship.components.delete(FormationComponent);
            ship.components.set(FiringGroupComponent, { group: leader });
            continue;
        }
        ship.components.set(FormationComponent, { leader, slot: slot++ });
    }
}

/**
 * Turns a captured disabled hulk into the boarder's escort: it joins
 * the formation flock, hands its brain to the escort-command framework
 * (which suppresses its native hostile AI), shares the boarder's
 * firing group, sheds its government (so it reads as a neutral friendly
 * like a hired escort), and is patched back above its disable threshold
 * so it can fly. Mirrors the component set spawnHiredEscorts stamps
 * (browser.ts), applied to a live entity rather than a fresh one.
 *
 * IT MUST ALSO SHED THE HULL'S PREVIOUS IDENTITY, which is what the
 * playtest caught. Capture a ship that was itself somebody's BAY FIGHTER
 * — an NPC carrier's wing, the very class a player with a bay is likely
 * to be boarding — and the stamps above land on top of a live set of bay
 * components pointing at the OLD carrier. The result was a ship that was
 * an escort by some predicates and not by others:
 *
 *  - the returnToBay escort command believed the ship was bay-launched
 *    (stale ReturnWhenTargetRemovedComponent) and so DELETED its
 *    FormationComponent and flew it home to its old carrier
 *    (escort_command_plugin's returnToBay case, via startReturnHome);
 *  - with the formation link gone, both one-hop parent lookups fell
 *    through to the stale OwnerComponent — the old carrier — so the
 *    player could no longer command it (escortParent) and the target
 *    cycle stopped hiding it (flock.ts's flockParent, where
 *    OwnerComponent SHADOWS the firing group);
 *  - meanwhile FiringGroupComponent still named the player, so the
 *    player's own shots kept passing through it, and the durable
 *    PlayerEscort marker still labelled it an escort in the target pane.
 *    Exactly the "says it is my escort, but I can't command it and my
 *    weapons can't hit it" report.
 *  - a captured wing whose old carrier was already dead could also be
 *    retired out from under the player by OrphanedBayFighterSystem
 *    (bay_plugin), which deletes EscortCommandComponent and
 *    FormationComponent and sets the ship departing — it exempts ships
 *    marked PlayerEscortComponent, which is why that marker is now
 *    stamped HERE rather than a tick later by MarkPlayerEscortsSystem.
 *
 * So the bay identity is removed wholesale: the launch link
 * (BayFighterComponent / SourceComponent / OwnerComponent /
 * ReturnWhenTargetRemovedComponent) and any in-progress return home
 * (ReturnComponent / CollectableEscortComponent, which would otherwise
 * fly the prize back to its old carrier and let it be scooped up,
 * together with the CollisionHitter / HurtboxHull docking plumbing that
 * makes the scoop-up contact happen).
 * captureIntoBay's sibling path always overwrote these; this one used to
 * leave them.
 */
function convertToEscort(target: Entity, targetUuid: string,
    leaderUuid: string, leaderOwner: string | undefined,
    leaderControlled: boolean, entities: EntityMap): void {
    const slot = nextFormationSlot(formationsIn(entities), leaderUuid);
    target.components.set(FormationComponent, { leader: leaderUuid, slot });
    target.components.set(EscortCommandComponent, { command: 'formation' });
    target.components.set(FiringGroupComponent, { group: leaderUuid });
    target.components.delete(GovtComponent);
    target.components.delete(BoardedComponent);
    // The old owner's bay identity, in full.
    target.components.delete(BayFighterComponent);
    target.components.delete(SourceComponent);
    target.components.delete(OwnerComponent);
    target.components.delete(ReturnWhenTargetRemovedComponent);
    target.components.delete(ReturnComponent);
    target.components.delete(CollectableEscortComponent);
    // ...including the DOCKING PLUMBING startReturnHome stamps alongside
    // those two. A returning fighter is made to physically hit its carrier
    // (CollisionHitter `return_escorts`, plus a Hurtbox hull copied from
    // its hitbox) so that the contact fires CollectableEscortAI. Neither
    // belongs on a captured prize.
    //
    // SAFE TO SHED WHOLESALE on a ship: an ordinary ship is the VICTIM
    // side of a collision, carrying HitboxHull + CollisionVulnerability
    // (ship_plugin/collisions_plugin provide those and will re-provide
    // them). The hitter side is for things that DO the hitting —
    // projectiles, beams, asteroids, and a fighter flying home — and on a
    // ship hull startReturnHome is the only thing that stamps it. Note
    // this is the returning-fighter role only: a captured CARRIER's own
    // CollisionVulnerability may legitimately list `return_escorts` (its
    // own wing has to be able to dock), and that is left alone.
    target.components.delete(CollisionHitterComponent);
    target.components.delete(HurtboxHullComponent);
    // A landing order aimed at its old owner's stellar is meaningless now.
    target.components.delete(EscortLandingComponent);
    if (leaderOwner !== undefined) {
        target.components.set(MultiplayerData, { owner: leaderOwner });
    }
    // Durable ownership, stamped immediately (as captureIntoBay always
    // did) rather than waiting for MarkPlayerEscortsSystem's next pass:
    // the one-tick window where the prize carried no marker is the window
    // OrphanedBayFighterSystem used to retire it in. Only a
    // player-controlled captor can name a player; for anything else the
    // marking system decides.
    if (leaderControlled) {
        // PROVENANCE 'captured' is stamped here, at the one moment the fact
        // is known: this hull was TAKEN, not hired. It is what makes the
        // comm dialog offer "Sell Escort" for it and charge it no daily
        // wage (player_escort.ts's provenance; spaceport/escort_fees.ts).
        target.components.set(PlayerEscortComponent,
            { player: leaderUuid, parent: leaderUuid,
                provenance: 'captured' });
    }
    // Clear leftover hostility so a reverted-to-NPC escort (leader lost)
    // isn't still gunning for the ex-owner. The MODE goes with it: a
    // prize whose old carrier died was already retired to 'depart' by
    // OrphanedBayFighterSystem, and an escort that inherited that mode
    // would fly itself out of the system the moment its escort command
    // ever lapsed. Cleared (rather than set to some other mode) is the
    // resting value a freshly spawned NPC has; nothing rolls a new one
    // while the ship holds an EscortCommandComponent, so this consumes no
    // randomness.
    const npc = target.components.get(NpcComponent);
    if (npc) {
        npc.aggressor = undefined;
        npc.mode = undefined;
    }
    const targetTarget = target.components.get(TargetComponent);
    if (targetTarget) {
        targetTarget.target = undefined;
    }
    // MISSION-SPECIAL IDENTITY IS SHED (Matthew's ruling; the Bible is
    // silent on capturing a mission ship — it only ever excludes mission
    // ships from NPC plunder, gövt Flags 0x1000 "non-mission"). A prize is
    // the player's escort now, not the mission's prop:
    //
    //  - MissionShipCleanupSystem deletes any mission ship whose owner has
    //    lost the mission, which would otherwise VAPORISE the escort the
    //    moment the mission ended (mission_ship_plugin.ts);
    //  - MissionShipTrackSystem would go on registering it in the
    //    objective's live roster and crediting disable/observe progress
    //    for a ship the player now owns;
    //  - the respawn path counts `total - satisfied` (shipsToSpawn), so
    //    with the prize no longer tracked the mission simply spawns its
    //    replacement on the next system entry and the prize is left alone
    //    — which is exactly the outcome asked for.
    target.components.delete(MissionShipComponent);
    // ...and with the identity goes the UNFINISHED BUSINESS that pinned it
    // to this system (system_hold.ts): the mission goal it was a target of,
    // the rescue it was waiting for, the offer it was standing by to make.
    // None of that survives the capture — the ship belongs to the player
    // now, and a prize that could never leave the system it was taken in
    // would be a strange thing to own. (The escort sweep would carry it
    // anyway; this is about the day its escort command lapses and NPC AI
    // takes the wheel again.)
    target.components.delete(SystemHoldComponent);
    // Every other ship's MEMORY of this hull, so the fleet it just left
    // stops shooting at it (see clearHostilityToward)...
    clearHostilityToward(targetUuid, entities);
    // ...and its WING, which does not come with it: the followers keep
    // their government and elect one of their own (see
    // reassignCapturedWing).
    reassignCapturedWing(targetUuid, entities);
    // Bring it back online: restore armor above the disable threshold
    // and drop DisabledComponent so DisabledMovementSystem stops braking
    // it and the escort/formation systems can steer it.
    const shipData = target.components.get(ShipDataComponent);
    const armor = target.components.get(ArmorComponent);
    if (armor && shipData
        && isBelowDisableThreshold(armor, shipData.disableArmorFraction)) {
        armor.current = repairedArmor(armor.max, shipData.disableArmorFraction);
    }
    target.components.delete(DisabledComponent);
}

/**
 * The plunder-dialog actions. Each is idempotent (a per-action flag or
 * the capture state guards a repeated control edge), so a replayed input
 * never double-applies. All arithmetic is deterministic; the capture
 * roll draws once from the seeded RandomResource.
 */
const BoardingActionSystem = new System({
    name: 'BoardingActionSystem',
    events: [ShipControlEvent] as const,
    args: [ShipControlStateComponent, BoardingComponent, ShipDataComponent,
        CargoComponent, ShipPhysicsComponent, CreditsComponent, FuelComponent,
        Optional(LegalRecordsComponent), Optional(OutfitsStateComponent),
        Optional(WeaponsStateComponent), GetEntity, UUID, Entities,
        RandomResource, Optional(GovtsResource), SimulationGameDataResource,
        Emit] as const,
    step(controls, boarding, shipData, cargo, physics, credits, fuel, records,
        boarderOutfits, boarderWeapons, entity, uuid, entities, random, govts,
        gameData, emit) {
        const target = entities.get(boarding.target);

        // Charges the BoardPenalty crime once per session, the first
        // time the player takes booty or attempts capture ("pirating").
        const chargeCrime = () => {
            if (boarding.crimeApplied) {
                return;
            }
            boarding.crimeApplied = true;
            applyBoardCrime(entity, records,
                target?.components.get(GovtComponent)?.id, gameData, govts);
        };

        // The boarding produced a MISSION OFFER and nothing else (përs
        // Flags 0x0200): end the session and hand the hulk's one plunder
        // back. Checked before 'plunderDone' so the two can never be read
        // in the wrong order if both edges land on one tick.
        if (controls.get('plunderOfferOnly') === 'start') {
            endBoardingForOffer(entity, target);
            return;
        }

        // Done, or the target vanished: end the session.
        if (controls.get('plunderDone') === 'start' || !target) {
            endBoardingSession(entity, target);
            return;
        }

        // Take the captured ship as an escort (capture-assignment
        // dialog). Ends the session. The `capturable` re-check is
        // belt-and-braces: capture can never REACH 'succeeded' against a
        // flown ship, but a hull that somehow became controlled between
        // the roll and the assignment must not be converted either — that
        // half-owned chimera is the whole bug.
        if (controls.get('plunderCaptureEscort') === 'start'
            && boarding.capture === 'succeeded' && capturable(target)) {
            // THE ESCORT CAP (ruling #161): a captured prize is an escort
            // the player keeps, so it is counted like a hire — and refused
            // like one, with the same STR# 2002 #123 message, when the
            // player already has MAX_ESCORTS hired-or-captured escorts.
            // Mission escorts and bay fighters do not count. The count is
            // escort_cap.ts's one counting function, the same one the bar
            // uses; here it is given the world only, because that is all
            // synced state the simulation may read (the client's carried
            // rosters are not — see cappedEscortCount for the window that
            // leaves).
            //
            // A REFUSAL CHARGES NOTHING: nothing happened to the hulk. The
            // piracy crime for this session was charged at the capture
            // ATTEMPT (the 'plunderCapture' roll below, "either way"), and
            // that charge stands; this press adds no second one, and
            // chargeCrime is once-per-session in any case.
            //
            // THE SESSION STAYS OPEN, AND THE HULK STAYS PLUNDERABLE. This
            // is a ruling-adjacent choice, not part of #161's text: the
            // maintainer ruled the number and what counts, not what the
            // plunder dialog does when a keep is refused, and it is
            // unverified against the original. Chosen because the refusal
            // is about the player's fleet, not the prize — the boarders
            // have already won the hulk, its cargo, credits, fuel and ammo
            // are still on offer, and Done releases it exactly as if the
            // player had declined to keep it. The dialog shows the message
            // and greys Capture (display/boarding_plugin.ts).
            if (cappedEscortCount(uuid, { world: entities }) >= MAX_ESCORTS) {
                boarding.capture = 'refused';
                return;
            }
            const owner = entity.components.get(MultiplayerData)?.owner;
            convertToEscort(target, boarding.target, uuid, owner,
                entity.components.has(ControlledByComponent), entities);
            boarding.capture = 'assigned';
            entity.components.delete(BoardingComponent);
            return;
        }

        // The remaining actions need the victim to still be a boardable
        // hulk; a repair or a stray killing blow ends the session.
        if (!target.components.has(DisabledComponent)) {
            endBoardingSession(entity, target);
            return;
        }

        if (controls.get('plunderCargo') === 'start' && !boarding.cargoTaken) {
            boarding.cargoTaken = true;
            markBootyTaken(target, uuid, 'cargoTaken');
            const targetCargo = target.components.get(CargoComponent);
            if (targetCargo) {
                const free = physics.freeCargo - cargoUsed(cargo);
                for (const [key, tons] of planCargoPlunder(targetCargo, free)) {
                    cargo.set(key, (cargo.get(key) ?? 0) + tons);
                    const left = (targetCargo.get(key) ?? 0) - tons;
                    if (left > 0) {
                        targetCargo.set(key, left);
                    } else {
                        targetCargo.delete(key);
                    }
                }
            }
            chargeCrime();
        }

        if (controls.get('plunderCredits') === 'start'
            && !boarding.creditsTaken) {
            boarding.creditsTaken = true;
            markBootyTaken(target, uuid, 'creditsTaken');
            credits.credits += boarding.creditsAvailable;
            chargeCrime();
        }

        if (controls.get('plunderFuel') === 'start' && !boarding.fuelTaken) {
            boarding.fuelTaken = true;
            markBootyTaken(target, uuid, 'fuelTaken');
            const targetFuel = target.components.get(FuelComponent);
            if (targetFuel) {
                const moved = fuelTransferAmount(
                    targetFuel.current, fuel.current, fuel.max);
                fuel.current += moved;
                targetFuel.current -= moved;
            }
            chargeCrime();
        }

        if (controls.get('plunderAmmo') === 'start' && !boarding.ammoTaken) {
            boarding.ammoTaken = true;
            markBootyTaken(target, uuid, 'ammoTaken');
            const targetOutfits = target.components.get(OutfitsStateComponent);
            if (boarderOutfits && targetOutfits) {
                const { victim, boarderRoundsByWeapon, info } = ammoPlunderInputs(
                    boarderOutfits, boarderWeapons, targetOutfits, gameData);
                for (const [outfitId, rounds] of
                    planAmmoPlunder(victim, boarderRoundsByWeapon, info)) {
                    // Move rounds of the SAME ammo outfit: remove from the
                    // victim, add to the boarder's stock (in-place count
                    // edits, like weapon_plugin's consumeAmmo).
                    const victimState = targetOutfits.get(outfitId);
                    if (victimState) {
                        victimState.count -= rounds;
                        if (victimState.count <= 0) {
                            targetOutfits.delete(outfitId);
                        }
                    }
                    const boarderState = boarderOutfits.get(outfitId);
                    if (boarderState) {
                        boarderState.count += rounds;
                    } else {
                        boarderOutfits.set(outfitId, { count: rounds });
                    }
                }
            }
            chargeCrime();
        }

        // The capture contest — ONE ATTEMPT PER SESSION (Matthew's
        // ruling), and since a session is itself once per life segment
        // (see BoardedState) that is one attempt per hulk, full stop.
        //
        // `capture === 'none'` is the whole gate: the attempt is the
        // transition out of 'none', and there is no path back into it.
        // This is the deliberate REMOVAL of the old retry, which re-opened
        // a session at 'none' on every re-board and let a player grind a
        // 5%-odds derelict by pressing 'b' until it fell.
        //
        // A ship somebody is flying is never capturable (see `capturable`),
        // and the roll is skipped ENTIRELY for one — no draw from the
        // seeded RandomResource, so the draw count stays identical on every
        // peer and across resimulation (the predicate is synced state, so
        // every peer skips together). The dialog greys the button off the
        // same predicates, so pressing it is only reachable by a hand-sent
        // control input.
        if (controls.get('plunderCapture') === 'start'
            && boarding.capture === 'none' && capturable(target)) {
            const targetCrew =
                target.components.get(ShipDataComponent)?.crew ?? 0;
            // Bible: a 0-crew boarder can't capture. Marines (ModType 25)
            // would add to the boarder's effective crew here — a
            // documented seam (unparsed), so the raw shïp Crew is used.
            const chance = captureChance(shipData.crew, targetCrew);
            const won = random.next() < chance;
            boarding.capture = won ? 'succeeded' : 'failed';
            // Piracy is charged for the attempt either way, before the
            // session can end under us.
            chargeCrime();
            if (!won) {
                // REPELLED. The boarders are thrown off the hulk: the
                // dialog closes on the spot and nothing further can be
                // taken from this ship — the durable record (stamped when
                // the session opened) already marks it fully spent, so
                // even a fresh approach is refused. The status line is the
                // only feedback left, hence the event.
                endBoardingSession(entity, target);
                emit(BoardingRepelledEvent, {}, [uuid]);
                return;
            }
        }
    },
});

/**
 * A ship LANDED, so its plunder life segment is over: the durable
 * boarding record is dropped and the ship may be plundered once again
 * when it comes back up (Matthew's ruling; see clearPlunderRecord).
 *
 * LandEvent is targeted at the landing ship and covers both routes a
 * player leaves a system's world by while still coming back — an ordinary
 * stellar and a hypergate/wormhole transit (gate_transit_plugin fires the
 * same event). It runs on every peer, so the record clears in lockstep,
 * and it runs BEFORE the client tears the world down, so the cleared
 * component is what gets serialized and carried.
 *
 * The escort half of the same boundary is in player_escort_plugin (an
 * escort lands or is swept along by a jump or a gate transit), and the
 * jumping ship's own half is in jump_plugin's JumpFromSystem.
 */
const BoardingLandingResetSystem = new System({
    name: 'BoardingLandingResetSystem',
    events: [LandEvent] as const,
    args: [GetEntity] as const,
    step(entity) {
        clearPlunderRecord(entity);
    },
});

export const BoardingPlugin: Plugin = {
    name: 'BoardingPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        world.addComponent(BoardingComponent);
        world.addComponent(BoardedComponent);
        // Delta registration also registers the serializer, so both ride
        // wire snapshots, rollback snapshots, and the display sync.
        deltaMaker.addComponent(BoardingComponent, {
            componentType: BoardingState,
        });
        deltaMaker.addComponent(BoardedComponent, {
            componentType: BoardedState,
        });
        world.resources.get(SerializerResource)?.addEvent(
            BoardingBlockedEvent, BoardingBlockedEventType);
        world.resources.get(SerializerResource)?.addEvent(
            EscortRepairedEvent, EscortRepairedEventType);
        world.resources.get(SerializerResource)?.addEvent(
            BayCaptureEvent, BayCaptureEventType);
        world.resources.get(SerializerResource)?.addEvent(
            BoardingRepelledEvent, BoardingRepelledEventType);

        world.addSystem(BoardingGateSystem);
        world.addSystem(BoardingActionSystem);
        world.addSystem(BoardingLandingResetSystem);
        world.addSystem(MissionPlayerPlunderedSystem);
    },
    remove(world) {
        world.removeSystem(BoardingGateSystem);
        world.removeSystem(BoardingActionSystem);
        world.removeSystem(BoardingLandingResetSystem);
        world.removeSystem(MissionPlayerPlunderedSystem);
    },
};

/**
 * mïsn Flags 0x8000, "Mission will fail if player is boarded by pirates"
 * (EVN Bible) — stock's Pirate Offshoot string nova:719-726 ("Rescue
 * Tomak", "Pick Up Cargo", "Beat On 'Daring' Dan McGraw"...) sets it.
 *
 * "Boarded by pirates" is read as the one piracy the simulation has: an
 * NPC warship plunder-boarding the disabled owner (gövt Flags 0x1000,
 * npc_ai_plugin's PlayerPlunderedEvent, targeted at the victim). Every
 * such boarding IS piracy whatever the boarder's government calls
 * itself — the Bible's own definition of the act is "pirating one of
 * this govt's ships" (BoardPenalty) — so no govt-class predicate is
 * applied. A rival PLAYER boarding the owner is not an NPC pirate and
 * does not count. Marks the flagged missions failed exactly as the
 * player-loss systems do (mission_ship_plugin's
 * failPlayerMissionsOnLoss); the OnFailure and the notice follow at the
 * next date advance. Runs identically on every peer off the same event,
 * and an already-failed mission stays failed.
 */
const MissionPlayerPlunderedSystem = new System({
    name: 'MissionPlayerPlunderedSystem',
    events: [PlayerPlunderedEvent],
    args: [PlayerPlunderedEvent, MissionsComponent] as const,
    step(_plundered, missions) {
        for (const active of missions.values()) {
            if (active.failIfBoardedByPirates && !active.failed) {
                active.failed = true;
            }
        }
    },
});
