import * as t from 'io-ts';
import { GovtData } from 'novadatainterface/govt_data';
import { Entities, GetEntity } from 'nova_ecs/arg_types';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementState, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { DisabledComponent } from '../ship/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { GovtComponent } from '../core/index.js';
import { JumpComponent } from '../travel/index.js';
import { AssistingComponent, AssistingType, NpcFireControlSystem } from '../npc/index.js';
import { NpcRespawnSystem } from '../spawn/index.js';
import { ArmorComponent, FuelComponent, ShieldComponent } from '../ship/index.js';
import {
    bribeAmount,
    canRequestAssistance,
    planetTakesBribes,
    shipIsFighting,
    shipTakesBribes,
} from '../reputation/index.js';
import {
    PlanetComponent, PlanetDataComponent, stellarClearanceFor,
    StellarBribesComponent, STELLAR_BRIBE_MS,
} from '../travel/index.js';
import { ActiveRanksComponent } from '../ncb/index.js';
import { ranksAllowAssistance } from '../ncb/index.js';
import { OutfitsStateComponent } from '../ship/index.js';
import { ShipDataComponent } from '../ship/index.js';
import { shipDisposition } from '../reputation/index.js';
import {
    isPacifiedToward, NpcComponent, NpcSteeringSystem,
} from '../npc/index.js';
import { AggressionComponent } from '../combat/index.js';
import { ShootAllWeaponsComponent } from '../npc/index.js';
import { CreditsComponent, MissionsComponent } from '../player/index.js';
import { GovtsResource, LegalRecordsComponent } from '../reputation/index.js';
import { findControlledEntity } from '../player/index.js';
import { ShipComponent } from '../ship/index.js';
import { TargetComponent } from '../ship/index.js';

/**
 * ============================================================================
 * Hailing — the simulation side (deterministic)
 * ============================================================================
 *
 * The comms DIALOG is client-side (display/hail_dialog_plugin.ts), but every
 * simulation effect a hail can cause — repairing/refuelling the player,
 * deducting bribe credits, an NPC "coming to assist", a bribed ship breaking
 * off — MUST flow through the deterministic input path so it resolves
 * identically on every peer. A hail action arrives as a `{ kind: 'hail' }`
 * SimulationInput record (simulation_input.ts), applied by `applyHail` below
 * on every peer at the same tick, exactly like setTarget / self-destruct.
 *
 * No randomness is used: eligibility and the bribe amount are pure functions
 * of synced state (govt flags, the player's records, credits), so the display
 * dialog and the sim agree without a compliance roll — and there is nothing
 * for a seeded-Random mismatch to desync. (A future randomized "will they
 * come?" roll would have to live entirely in the sim, using RandomResource,
 * with the dialog wording made outcome-agnostic.)
 *
 * Boarding / plunder / capture (PICTs 8515-8516) are explicitly out of scope;
 * the AssistingComponent and bribe seams here don't touch them.
 */

/**
 * The player-initiated hail actions that change the simulation. `target` is
 * the hailed ship's uuid. Amounts and eligibility are recomputed sim-side
 * from synced state — the record carries intent only, never a client-chosen
 * credit figure, so a tampered client can't grant itself a free repair.
 */
export type HailAction =
    | { kind: 'requestAssistance', target: string }
    | { kind: 'bribe', target: string };

export const HailActionType: t.Type<HailAction> = t.union([
    t.type({ kind: t.literal('requestAssistance'), target: t.string }),
    t.type({ kind: t.literal('bribe'), target: t.string }),
]);

/** How long a bribe keeps a hostile ship off the player's back, in ms.
 * TUNABLE / ASSUMPTION: the Bible doesn't quantify the reprieve; a bribe in
 * the original buys a lasting break until the player provokes them again.
 * Two minutes is long enough to escape and short enough that a persistent
 * criminal is eventually hunted again (the reputation record is unchanged). */
export const BRIBE_PACIFY_MS = 120_000;

/** Assist: the helper thrusts toward the client until within this range. */
export const ASSIST_ARRIVAL_RANGE = 300;
/** Assist: stop thrusting inside this range (coast the last stretch). */
export const ASSIST_STANDOFF = 200;

/** Under one jump's worth of fuel (FUEL_PER_JUMP = 100) counts as "low". */
export const LOW_FUEL_THRESHOLD = 100;

function lookupGovt(world: World, govtId: string | undefined):
    GovtData | undefined {
    if (govtId === undefined) {
        return undefined;
    }
    const govts = world.resources.get(GovtsResource);
    if (govts?.has(govtId)) {
        return govts.get(govtId);
    }
    return world.resources.get(SimulationGameDataResource)
        ?.data.Govt.getCached(govtId);
}

/** Whether the player ship needs fuel/repair help (disabled or low fuel). */
function playerNeedsHelp(player: Entity): boolean {
    if (player.components.has(DisabledComponent)) {
        return true;
    }
    const fuel = player.components.get(FuelComponent);
    return !!fuel && fuel.current < fuel.max
        && fuel.current < LOW_FUEL_THRESHOLD;
}

/**
 * Buys temporary landing clearance at a stellar. Re-checks EVERYTHING against
 * synced state — the record carries intent only:
 *
 *  1. The stellar must actually be refusing this player (the same pure
 *    `stellarClearanceFor` verdict the landing gate and the radar use). You
 *    cannot pay for clearance you already have.
 *  2. Its government must take planet bribes — gövt Flags 0x4000 "Planets of
 *    this govt will take bribes", or 0x8000 whose Bible text ends "...and
 *    their planets will always take bribes" (hail.ts's planetTakesBribes).
 *    An INDEPENDENT stellar has no government and so never bargains.
 *  3. The player must be able to afford the demand, which is the SAME
 *    percentage-of-cash figure a ship demands (hail.ts's bribeAmount), with
 *    the pirate/largerBribes surcharge — the Bible gives no separate planet
 *    price, so the ship convention is reused rather than invented (a
 *    documented assumption).
 *
 * The effect is one map entry on the player: this stellar's NOVA id -> the
 * simulation time the clearance lapses. Time comes from TimeResource, never
 * Date.now, so the expiry is identical on every peer.
 */
function applyPlanetBribe(world: World, player: Entity, target: Entity) {
    const planetData = target.components.get(PlanetDataComponent);
    const planetId = target.components.get(PlanetComponent)?.id;
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!planetData || planetId === undefined || !gameData) {
        return;
    }
    const now = world.resources.get(TimeResource)?.time ?? 0;
    const bribes = player.components.get(StellarBribesComponent);
    const clearance = stellarClearanceFor({
        planetData, gameData,
        govts: world.resources.get(GovtsResource),
        records: player.components.get(LegalRecordsComponent),
        shipData: player.components.get(ShipDataComponent),
        outfits: player.components.get(OutfitsStateComponent),
        ranks: player.components.get(ActiveRanksComponent),
        missions: player.components.get(MissionsComponent),
        bribes, planetId, now,
    });
    if (clearance.cleared) {
        return;
    }
    const govt = lookupGovt(world, planetData.govt ?? undefined);
    if (!planetTakesBribes(govt)) {
        return;
    }
    const credits = player.components.get(CreditsComponent);
    if (!credits) {
        return;
    }
    const amount = bribeAmount(credits.credits, !!govt?.flags.largerBribes);
    if (amount <= 0 || credits.credits < amount) {
        return;
    }
    credits.credits -= amount;
    // Mutate the existing map when there is one so the delta/serializer sees
    // the component it already knows about, and materialize it otherwise.
    const until = now + STELLAR_BRIBE_MS;
    if (bribes) {
        bribes.set(planetId, until);
    } else {
        player.components.set(StellarBribesComponent,
            new Map([[planetId, until]]));
    }
}

/**
 * Applies a hail action deterministically on every peer. Resolves the hailing
 * player from `peerId` and the target from the record; re-checks eligibility
 * against synced state before mutating anything.
 */
export function applyHail(world: World, peerId: string | undefined,
    action: HailAction) {
    const found = findControlledEntity(world, peerId);
    if (!found) {
        return;
    }
    const player = found.entity;
    const target = world.entities.get(action.target);
    if (!target) {
        return;
    }
    // A STELLAR was hailed, not a ship: the only action it accepts is a bribe
    // for landing clearance.
    if (target.components.has(PlanetComponent)) {
        if (action.kind === 'bribe') {
            applyPlanetBribe(world, player, target);
        }
        return;
    }
    if (!target.components.has(ShipComponent)) {
        return;
    }
    const targetGovt = lookupGovt(world,
        target.components.get(GovtComponent)?.id);
    const playerGovt = lookupGovt(world,
        player.components.get(GovtComponent)?.id);
    const playerRecords = player.components.get(LegalRecordsComponent);
    const disposition = shipDisposition(targetGovt, playerGovt, playerRecords);

    // Behavioral hostility: a ship whose AI is attacking the player (mode
    // 'attack' with its target pointed at the player) is hostile regardless
    // of politics — the same rule the target corners use (iff_plugin's
    // targetCornerStyle), including the legacy dev-enemy ShootAllWeapons
    // marker. Computed from synced state so it matches the display dialog.
    const targetsPlayer =
        target.components.get(TargetComponent)?.target === found.uuid;
    const targetNpcMode = target.components.get(NpcComponent)?.mode;
    const attackingPlayer = targetsPlayer && (targetNpcMode === 'attack'
        || target.components.has(ShootAllWeaponsComponent));

    if (action.kind === 'requestAssistance') {
        if (!canRequestAssistance({
            disposition,
            govt: targetGovt,
            attackingPlayer,
            // ränk 0x0400: "Player can always request battle assistance from
            // ships of the affiliated government" (rank_logic.ts).
            rankAlwaysAssists: ranksAllowAssistance(
                player.components.get(ActiveRanksComponent),
                (id: string) => world.resources
                    .get(SimulationGameDataResource)?.data.Rank.getCached(id),
                targetGovt?.id),
        })) {
            return;
        }
        // NO NEED, NO ERRAND. The button is offered to every non-hostile ship
        // now, whatever shape the player's hull is in — the ship answers a
        // pointless request with "You're not in any trouble." (STR# 3000
        // 70-74, rendered by the dialog) and is left completely alone here:
        // no AssistingComponent means NpcDecisionSystem keeps its brain and
        // AssistBehaviorSystem never steers it. The same synced predicate the
        // dialog uses, so every peer reaches the same verdict on the tick the
        // record is applied.
        if (!playerNeedsHelp(player)) {
            return;
        }
        // BUSY: a ship in the middle of a fight refuses ("I'm busy" — STR#
        // 3000 index 80-84, rendered by the dialog) and is left completely
        // alone. Returning here is the whole refusal: no AssistingComponent
        // means NpcDecisionSystem never yields its brain, AssistBehaviorSystem
        // never steers it, and its target and firing state are untouched — the
        // playtest bug was an assisting ship flying at the player while still
        // shooting its opponent.
        //
        // Checked AFTER canRequestAssistance so the ineligible cases (healthy
        // player, hostile govt) keep their existing outcomes, and evaluated
        // from synced state with the same predicate the dialog uses, so every
        // peer refuses on the same tick.
        if (shipIsFighting({
            npcMode: targetNpcMode,
            npcTarget: target.components.get(TargetComponent)?.target,
            shootsAllWeapons: target.components.has(ShootAllWeaponsComponent),
        })) {
            return;
        }
        // The helper breaks off whatever it was doing and comes over. Marking
        // it is enough: NpcDecisionSystem yields to the AssistingComponent
        // and AssistBehaviorSystem flies it in and heals the client.
        target.components.set(AssistingComponent, { client: found.uuid });
        return;
    }

    // Bribe / beg for mercy: only a hostile, bribe-taking ship bargains. A
    // ship actively attacking the player counts as hostile here even if its
    // politics are neutral (behavioral hostility), so the player can buy it
    // off just like a politically hostile one.
    if (disposition !== 'hostile' && !attackingPlayer) {
        return;
    }
    // ONE PAYMENT PER REPRIEVE. The comm dialog keeps Beg For Mercy in its
    // slot after a successful bribe (the reference keeps Request Assistance
    // there too — hail/request_assistance.png), so a second Pay press can
    // reach here; charging for a reprieve the player already owns would let
    // the button drain them. The reprieve itself is not extended either: it
    // runs from the payment that bought it, and a player who wants a fresh
    // one waits for this one to lapse (or provokes the ship, which voids it).
    if (isPacifiedToward(target.components.get(NpcComponent), found.uuid,
        world.resources.get(TimeResource)?.time ?? 0)) {
        return;
    }
    const aiType = target.components.get(NpcComponent)?.aiType;
    if (targetGovt?.flags2.noAssistOrMercy
        || !shipTakesBribes(targetGovt, aiType)) {
        return;
    }
    const credits = player.components.get(CreditsComponent);
    if (!credits) {
        return;
    }
    const amount = bribeAmount(credits.credits,
        !!targetGovt?.flags.largerBribes);
    if (amount <= 0 || credits.credits < amount) {
        return;
    }
    credits.credits -= amount;
    // Pacify the ship: forget the player as an aggressor and ignore them as a
    // hostile until the reprieve lapses (NpcDecisionSystem honors this).
    const npc = target.components.get(NpcComponent);
    if (npc) {
        const time = world.resources.get(TimeResource);
        npc.pacifiedFrom = found.uuid;
        npc.pacifiedUntil = (time?.time ?? 0) + BRIBE_PACIFY_MS;
        if (npc.aggressor === found.uuid) {
            npc.aggressor = undefined;
        }
        const tgt = target.components.get(TargetComponent);
        if (npc.mode === 'attack' && tgt?.target === found.uuid) {
            npc.mode = undefined;
            tgt.target = undefined;
        }
    }
    forgetMutualAggression(player, action.target, target, found.uuid);
}

/**
 * WHAT ELSE A PAID BRIBE HAS TO ERASE.
 *
 * Dropping the NPC's own attack (above) stops the bribed ship shooting, but
 * it does NOT make it neutral, because hostility is a two-sided reading: the
 * player's own AggressionComponent still remembers every shot that ship
 * landed in the last AGGRESSION_WINDOW_MS, and that memory is tier 3b of the
 * one hostility rule (hostility.ts's styleForTarget). While it stands, the
 * ship the player just paid off keeps hostile target corners, keeps being
 * picked by the 'r' key, keeps a red IFF blip — and, worst, keeps being shot
 * at by the player's own POINT DEFENSE turrets, whose prey filter is exactly
 * "hostile fighter in range" (point_defense.ts). The first PD round to land
 * voids the reprieve (NpcDecisionSystem clears pacifiedFrom when the briber
 * damages it), so the player paid for a truce their own turrets cancelled.
 * Matthew's report, precisely.
 *
 * So the payment forgets the encounter in BOTH directions: the player forgets
 * what the bribed ship did to them, and (for the multiplayer case where the
 * bribed ship is itself player-controlled and so carries the component) the
 * bribed ship forgets what the briber did to it. Only the entry naming the
 * other party is dropped — a brawl with three pirates leaves the two
 * unbribed ones exactly as hostile as they were.
 *
 * The accumulated stray damage goes with the entry rather than being zeroed
 * in place, for the same reason sweepAggression deletes rather than
 * un-flags: leaving 49 points of forgiven damage in wait would let one shot
 * after the truce flip the pair hostile instantly.
 *
 * Deterministic: two keyed deletes on synced components, no iteration order
 * and no clock.
 */
function forgetMutualAggression(player: Entity, targetUuid: string,
    target: Entity, playerUuid: string) {
    player.components.get(AggressionComponent)?.delete(targetUuid);
    target.components.get(AggressionComponent)?.delete(playerUuid);
}

/** Point-and-thrust steering toward a position (assist rendezvous). */
function steerToward(movement: MovementState,
    targetPos: { x: number, y: number }) {
    const toTarget = new Vector(targetPos.x - movement.position.x,
        targetPos.y - movement.position.y);
    movement.turnTo = toTarget.angle;
    movement.turnBack = false;
    movement.accelerating = toTarget.length > ASSIST_STANDOFF ? 1 : 0;
}

/**
 * Flies an assisting NPC to its client and, once alongside, restores the
 * client's armor, shields, and fuel to full (a disabled client then lifts its
 * DisabledComponent automatically next tick, via ShipDisableSystem's
 * armor-above-threshold exit) and releases the helper back to normal AI.
 * Runs after NpcSteeringSystem so its steering wins for the helper this tick.
 *
 * YIELDS TO A JUMP SEQUENCE, like every other movement writer in the sim
 * (FormationSystem, EscortCommandBehaviorSystem, NpcSteeringSystem all take
 * the same bail). A ship committed to a hyperspace jump is steered by
 * JumpSequenceSystem alone: it has to hold still for its spin-up and hold
 * its heading through the burn, and a second writer nudging turnTo and
 * accelerating would fight it. Theoretical today — an assisting ship has no
 * path into a jump sequence, since NpcDecisionSystem hands it to this system
 * and never reaches its depart/flee transitions — so this is consistency
 * insurance, bought for one Optional arg, against the next thing that can
 * put a JumpComponent on an arbitrary ship.
 */
export const AssistBehaviorSystem = new System({
    name: 'AssistBehaviorSystem',
    args: [AssistingComponent, MovementStateComponent, GetEntity,
        Optional(JumpComponent), Entities] as const,
    step(assisting, movement, entity, jump, entities) {
        if (jump) {
            // JumpSequenceSystem owns this ship's steering until it leaves.
            // The AssistingComponent is deliberately KEPT: a jump that is
            // cancelled (a disable) puts the helper straight back on its
            // errand rather than stranding its client waiting.
            return;
        }
        const client = entities.get(assisting.client);
        const clientMovement = client?.components.get(MovementStateComponent);
        if (!client || !clientMovement) {
            entity.components.delete(AssistingComponent);
            return;
        }
        const toClient = clientMovement.position.subtract(movement.position);
        if (toClient.length > ASSIST_ARRIVAL_RANGE) {
            steerToward(movement, clientMovement.position);
            return;
        }
        // Alongside: render assistance and depart.
        const armor = client.components.get(ArmorComponent);
        if (armor) {
            armor.current = armor.max;
        }
        const shield = client.components.get(ShieldComponent);
        if (shield) {
            shield.current = shield.max;
        }
        const fuel = client.components.get(FuelComponent);
        if (fuel) {
            fuel.current = fuel.max;
        }
        entity.components.delete(AssistingComponent);
    },
    // NpcFireControlSystem and NpcRespawnSystem are #237 pins (shared: *):
    // HailPlugin registers between NpcAiPlugin and NpcSpawnPlugin.
    after: [TimeSystem, NpcSteeringSystem, NpcFireControlSystem],
    before: [MovementSystem, NpcRespawnSystem],
});

export const HailPlugin: Plugin = {
    name: 'HailPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(AssistingComponent, AssistingType);
        world.addComponent(AssistingComponent);
        world.addSystem(AssistBehaviorSystem);
    },
};
