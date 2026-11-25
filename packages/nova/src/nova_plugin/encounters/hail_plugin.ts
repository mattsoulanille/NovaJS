import * as t from 'io-ts';
import { GovtData } from 'novadatainterface/govt_data';
import { Entities, GetEntity } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { CommunicatorResource, MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
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
import { SimulationGameDataResource, SystemIdResource } from '../core/index.js';
import { GovtComponent } from '../core/index.js';
import { JumpComponent } from '../travel/index.js';
import {
    AssistingComponent, AssistingType, FuelHaggleComponent, FuelHaggleType,
    isInFlock, NpcFireControlSystem,
} from '../npc/index.js';
import { NpcRespawnSystem } from '../spawn/index.js';
import { ArmorComponent, FuelComponent, ShieldComponent } from '../ship/index.js';
import { escortParent } from '../escorts/index.js';
import {
    assistIsFree,
    assistNeed,
    AssistWillingness,
    assistWillingness,
    canRequestAssistance,
    FUEL_SALE_AMOUNT,
    fuelAskingBase,
    fuelHaggleAfterAccept,
    FuelHaggleState,
    fuelSalePrice,
    lowerFuelPrice,
    NO_FUEL_HAGGLE,
    bribeDay,
    lowerPlanetBribe,
    planetBribeAsk,
    planetBribePrice,
    planetBribeRefused,
    planetTakesBribes,
    StellarHaggleState,
    stellarHaggleOn,
    shipBribePrice,
    shipHailResponse,
    shipIsFighting,
} from '../reputation/index.js';
import {
    PlanetComponent, PlanetDataComponent, stellarClearanceFor,
    StellarBribesComponent, STELLAR_BRIBE_MS, StellarHaggleComponent,
} from '../travel/index.js';
import { ActiveRanksComponent } from '../ncb/index.js';
import { ranksAllowAssistance, ranksGiveFreeFuel } from '../ncb/index.js';
import { OutfitsStateComponent } from '../ship/index.js';
import { ShipDataComponent } from '../ship/index.js';
import {
    alliedEitherWay, localLawIn, shipDisposition,
} from '../reputation/index.js';
import {
    isPacifiedToward, NpcComponent, NpcSteeringSystem,
} from '../npc/index.js';
import { AggressionComponent, isIffHostile } from '../combat/index.js';
import { contrabandDetectedBy, ShootAllWeaponsComponent } from '../npc/index.js';
import {
    ControlledByComponent, CreditsComponent, GameDateComponent, MissionsComponent,
    PlayerEscortComponent,
} from '../player/index.js';
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
    /**
     * Lower Price on a ship's price for fuel (reference H1 wave 17): the
     * ship counters with 3/4 of it or withdraws the offer, and always
     * withdraws a counter (hail.ts's lowerFuelPrice); a withdrawn offer's
     * next one from that ship costs 1,000 more. Accept Price is the
     * `requestAssistance` record itself, as Pay is for an unfriendly ship's
     * price.
     */
    | { kind: 'lowerPrice', target: string }
    | { kind: 'bribe', target: string }
    /** A button pressed in a channel to ANOTHER PLAYER's ship (#332). */
    | { kind: 'message', target: string, message: PlayerHailMessage };

/**
 * WHAT A HAIL TO ANOTHER PLAYER SAYS (Matthew's ruling on #332): "Eventually,
 * hailing a player should open an actual channel of some kind for them to
 * communicate instead of the normal hailing window ... For now, buttons
 * pressed should just send the message to the bottom left info text area on
 * that player's screen. Nothing should take control of their ship. Players
 * can't repair each other yet."
 *
 * One value per button of the ship comm's column — Greetings, and the offer
 * slot's Request Assistance or (IFF-hostile) Beg For Mercy. The record names
 * the BUTTON, never free text: the wording is composed by the receiving
 * client (display/status_bar_content's playerHailMessage), so a tampered
 * client cannot write arbitrary text onto another player's screen.
 */
export type PlayerHailMessage = 'greetings' | 'assistance' | 'mercy';
export const PlayerHailMessageType: t.Type<PlayerHailMessage> = t.union([
    t.literal('greetings'), t.literal('assistance'), t.literal('mercy'),
]);

export const HailActionType: t.Type<HailAction> = t.union([
    t.type({ kind: t.literal('requestAssistance'), target: t.string }),
    t.type({ kind: t.literal('lowerPrice'), target: t.string }),
    t.type({ kind: t.literal('bribe'), target: t.string }),
    t.type({
        kind: t.literal('message'), target: t.string,
        message: PlayerHailMessageType,
    }),
]);

/**
 * The last hail message a player's ship SENT to another player's ship.
 *
 * It lives on the SENDER's own ship, not the recipient's: applyHail never
 * writes to a ship another peer controls (#332). The recipient's client
 * finds it by scanning for a SentHail addressed to its own ship (`to`) and
 * prints it once per `seq` on its status line
 * (display/status_message_plugin's ShowPlayerHailMessage).
 *
 * WHY STATE, NOT AN EVENT. Another peer's record reaches this peer AFTER the
 * tick it is stamped for, so it is applied by a rollback resimulation — and
 * the bridge deliberately drops events re-emitted for a tick the display has
 * already been sent (simulation_bridge_host's eventsForwardedThrough): an
 * event would never reach the one screen it is for. State converges through
 * the delta stream however the record arrived.
 *
 * `seq` counts this ship's messages (each press is a new one, even of the
 * same button); `at` is the SIMULATION time it was sent, so a client that
 * first sees the component long afterwards (entering the system) does not
 * replay a stale message.
 */
export interface SentHail {
    to: string;
    message: PlayerHailMessage;
    seq: number;
    at: number;
}
export const SentHailType: t.Type<SentHail> = t.type({
    to: t.string,
    message: PlayerHailMessageType,
    seq: t.number,
    at: t.number,
});
export const SentHailComponent = new Component<SentHail>('SentHail');

/**
 * Whether the hailed ship belongs to ANOTHER player, so that no hail may
 * change it (#332, and rollback_protocol's trust-model item 5: a peer acts
 * only on what it owns). Three ownership markers, any one of which is enough:
 *
 *  - ControlledByComponent: a player's own ship. Every ship that carries one
 *    and is not the hailer's is somebody else's.
 *  - PlayerEscortComponent.player: a hired or captured escort, by the uuid
 *    of the player SHIP it belongs to.
 *  - MultiplayerData.owner: the PEER that inserted it — escorts, bay
 *    fighters, captured prizes, mission ships. A server peer's ownership is
 *    not "another player's" (the same exemption simulation_input's mayActOn
 *    makes), and local play (no peerId) has nobody else to protect.
 *
 * Pure over synced state plus the record's stamped peer, so every peer
 * refuses the same hail at the same tick.
 */
export function hailTargetBelongsToAnotherPlayer(world: World,
    target: Entity, hailerUuid: string, peerId: string | undefined): boolean {
    if (target.components.has(ControlledByComponent)) {
        return true;
    }
    const escortOf = target.components.get(PlayerEscortComponent)?.player;
    if (escortOf !== undefined && escortOf !== hailerUuid) {
        return true;
    }
    const owner = target.components.get(MultiplayerData)?.owner;
    if (peerId === undefined || owner === undefined || owner === peerId) {
        return false;
    }
    const servers = world.resources.get(CommunicatorResource)?.servers.value
        ?? DEFAULT_SERVER_PEERS;
    return !servers.has(owner);
}

/**
 * Whether the hailed ship is SOMEONE ELSE'S ESCORT — it flies for a leader
 * that is not the hailer: a fleet escort of an NPC flagship, a carrier's bay
 * fighter, another player's hired or captured escort. Read through
 * escortParent, the one parent-chain rule the escort command system and the
 * hail dialog's own-escort test already share.
 *
 * Such a ship answers a request for help with "Sorry sir, I'm just an
 * escort." and does nothing else (ruling #332's screenshot of the original:
 * a hailed Fed Viper escort). The hailer's OWN escorts are not "someone
 * else's": their channel is the escort-management box.
 *
 * Pure over synced state (FormationComponent, OwnerComponent and
 * PlayerEscortComponent all cross the wire), so the dialog's answer and
 * applyHail's refusal agree on every peer.
 */
export function isSomeoneElsesEscort(target: Entity,
    hailerUuid: string): boolean {
    const parent = escortParent(target);
    return parent !== undefined && parent !== hailerUuid;
}

/** The server's uuid when a world has no communicator (simulation_input's
 * DEFAULT_SERVER_PEERS, which is not importable from nova_plugin). */
const DEFAULT_SERVER_PEERS: ReadonlySet<string> = new Set(['server']);

/**
 * Records a message to another player's ship on the SENDER's ship (see
 * SentHail). The only thing a hail to a player does in the simulation.
 */
function sendPlayerHail(world: World, sender: Entity, to: string,
    message: PlayerHailMessage) {
    const previous = sender.components.get(SentHailComponent);
    sender.components.set(SentHailComponent, {
        to, message,
        seq: (previous?.seq ?? 0) + 1,
        at: world.resources.get(TimeResource)?.time ?? 0,
    });
}

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

/** What the player ship needs help with (hail.ts's assistNeed), if
 * anything: a repair (disabled) or fuel (under a jump's worth). */
function playerNeed(player: Entity) {
    return assistNeed(player.components.has(DisabledComponent),
        player.components.get(FuelComponent));
}

/**
 * A refusing stellar's bribe terms for `player` right now, or undefined
 * when there is no deal to strike. Re-checks EVERYTHING against synced
 * state — the record carries intent only:
 *
 *  1. The stellar must actually be refusing this player (the same pure
 *    `stellarClearanceFor` verdict the landing gate and the radar use). You
 *    cannot pay for clearance you already have.
 *  2. Its government must take planet bribes — gövt Flags 0x4000 "Planets of
 *    this govt will take bribes", or 0x8000 whose Bible text ends "...and
 *    their planets will always take bribes" (hail.ts's planetTakesBribes).
 *    An INDEPENDENT stellar has no government and so never bargains.
 *  3. The planet must not be turning offers down today: an ordinary
 *    planet's fresh refusal (about one in eight, reference "R7 bribe price
 *    above 1M, wave 27") or a haggle it withdrew from earlier the same day
 *    (reference "R7 planet bribe, wave 28"); hail.ts's planetBribeRefused,
 *    the same verdict the dialog draws.
 *
 * The price is hail.ts's planetBribePrice (reference "R7 bribe price, wave
 * 22": 3,000, or 4,000 for a 0x8000 govt, growing with the cash above about
 * 1M, capped by a third of it, never below 1,000), or its 3/4 counter while
 * one is on the table (planetBribeAsk).
 */
function planetBribeTerms(world: World, player: Entity, playerUuid: string,
    target: Entity, targetUuid: string): {
        planetId: string, price: number, haggle: StellarHaggleState,
        now: number,
    } | undefined {
    const planetData = target.components.get(PlanetDataComponent);
    const planetId = target.components.get(PlanetComponent)?.id;
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!planetData || planetId === undefined || !gameData) {
        return undefined;
    }
    const now = world.resources.get(TimeResource)?.time ?? 0;
    const clearance = stellarClearanceFor({
        planetData, gameData,
        govts: world.resources.get(GovtsResource),
        records: player.components.get(LegalRecordsComponent),
        shipData: player.components.get(ShipDataComponent),
        outfits: player.components.get(OutfitsStateComponent),
        ranks: player.components.get(ActiveRanksComponent),
        missions: player.components.get(MissionsComponent),
        bribes: player.components.get(StellarBribesComponent),
        planetId, now,
        systemId: world.resources.get(SystemIdResource),
    });
    if (clearance.cleared) {
        return undefined;
    }
    const govt = lookupGovt(world, planetData.govt ?? undefined);
    if (!planetTakesBribes(govt)) {
        return undefined;
    }
    const credits = player.components.get(CreditsComponent);
    if (!credits) {
        return undefined;
    }
    const date = player.components.get(GameDateComponent);
    const haggle = stellarHaggleOn(
        player.components.get(StellarHaggleComponent)?.get(planetId),
        bribeDay(date));
    const largerBribes = !!govt?.flags.largerBribes;
    if (planetBribeRefused(targetUuid, playerUuid, largerBribes, haggle,
        date)) {
        return undefined;
    }
    const price = planetBribeAsk(planetBribePrice(targetUuid, playerUuid,
        credits.credits, largerBribes), haggle);
    return { planetId, price, haggle, now };
}

/** Records `haggle` as the player's standing with `planetId`, mutating
 * the existing map when there is one (so the delta/serializer sees the
 * component it already knows) and materializing it otherwise. */
function setStellarHaggle(player: Entity, planetId: string,
    haggle: StellarHaggleState) {
    const entry = {
        day: haggle.day, countered: haggle.countered,
        withdrawn: haggle.withdrawn,
    };
    const haggles = player.components.get(StellarHaggleComponent);
    if (haggles) {
        haggles.set(planetId, entry);
    } else {
        player.components.set(StellarHaggleComponent,
            new Map([[planetId, entry]]));
    }
}

/**
 * Buys temporary landing clearance at a stellar, at the price
 * {@link planetBribeTerms} names (the counter, when one is on the table),
 * which the player must be able to afford: a pilot with less than the
 * price cannot pay.
 *
 * The effect is one map entry on the player: this stellar's NOVA id -> the
 * simulation time the clearance lapses. Time comes from TimeResource, never
 * Date.now, so the expiry is identical on every peer. The haggle with the
 * planet is over (its entry is dropped).
 */
function applyPlanetBribe(world: World, player: Entity, playerUuid: string,
    target: Entity, targetUuid: string) {
    const terms = planetBribeTerms(world, player, playerUuid, target,
        targetUuid);
    const credits = player.components.get(CreditsComponent);
    if (!terms || !credits) {
        return;
    }
    const { planetId, price: amount, now } = terms;
    if (amount <= 0 || credits.credits < amount) {
        return;
    }
    credits.credits -= amount;
    player.components.get(StellarHaggleComponent)?.delete(planetId);
    // Mutate the existing map when there is one so the delta/serializer sees
    // the component it already knows about, and materialize it otherwise.
    const bribes = player.components.get(StellarBribesComponent);
    const until = now + STELLAR_BRIBE_MS;
    if (bribes) {
        bribes.set(planetId, until);
    } else {
        player.components.set(StellarBribesComponent,
            new Map([[planetId, until]]));
    }
}

/**
 * LOWER PRICE on a stellar's bribe (reference "R7 planet bribe, wave 28"):
 * the planet counters with 3/4 or withdraws its offer, and always withdraws
 * a counter (hail.ts's lowerPlanetBribe, the same pure draw the dialog
 * shows). Only a planet naming a price right now can be haggled with, and
 * not over a price the pilot cannot pay (the dialog offers no Lower Price
 * then). A withdrawal makes the planet refuse every offer for the rest of
 * the game day.
 */
function applyPlanetLowerPrice(world: World, player: Entity,
    playerUuid: string, target: Entity, targetUuid: string) {
    const terms = planetBribeTerms(world, player, playerUuid, target,
        targetUuid);
    const credits = player.components.get(CreditsComponent);
    if (!terms || !credits || credits.credits < terms.price) {
        return;
    }
    setStellarHaggle(player, terms.planetId,
        lowerPlanetBribe(terms.haggle, targetUuid, playerUuid).haggle);
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
    // A STELLAR was hailed, not a ship: the only actions it accepts are a
    // bribe for landing clearance and a Lower Price on it.
    if (target.components.has(PlanetComponent)) {
        if (action.kind === 'bribe') {
            applyPlanetBribe(world, player, found.uuid, target,
                action.target);
        } else if (action.kind === 'lowerPrice') {
            applyPlanetLowerPrice(world, player, found.uuid, target,
                action.target);
        }
        return;
    }
    if (!target.components.has(ShipComponent) || action.target === found.uuid) {
        return;
    }
    // ANOTHER PLAYER'S SHIP (#332): no hail may change it. Hailing a human
    // player's own ship sends them a message and does nothing else — it is
    // recorded on the SENDER's ship, never theirs — and every ship action
    // (assistance, a bribe) against it, or against a ship another player
    // owns, is refused outright: "Nothing should take control of their
    // ship. Players can't repair each other yet."
    if (target.components.has(ControlledByComponent)) {
        if (action.kind === 'message') {
            sendPlayerHail(world, player, action.target, action.message);
        }
        return;
    }
    if (action.kind === 'message'
        || hailTargetBelongsToAnotherPlayer(world, target, found.uuid,
            peerId)) {
        return;
    }
    const targetGovt = lookupGovt(world,
        target.components.get(GovtComponent)?.id);
    const playerGovt = lookupGovt(world,
        player.components.get(GovtComponent)?.id);
    const playerRecords = player.components.get(LegalRecordsComponent);
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        return;
    }
    // Both verdicts below judge a criminal record by the law of THIS
    // system (reference A14, ruling #376), the one the brackets use too.
    const systemId = world.resources.get(SystemIdResource);
    const law = localLawIn(gameData, systemId);
    const disposition = shipDisposition(targetGovt, playerGovt, playerRecords,
        law, undefined, contrabandDetectedBy(player));

    // HOSTILITY IN THE CHANNEL IS THE SHIP'S IFF (Matthew's ruling on #297),
    // not a narrower NPC-posture copy of it: the one predicate the target
    // corners paint with (hostility.ts's isIffHostile), so a recent
    // aggressor that has since broken its lock, or another player's escort
    // holding its perimeter against us, is as hostile here as its red
    // brackets say. Every input is synced, so the display dialog reaches the
    // same verdict and every peer applies the same outcome.
    const now = world.resources.get(TimeResource)?.time ?? 0;
    const iffHostile = isIffHostile(action.target, target, found.uuid,
        player, gameData, uuid => world.entities.get(uuid), now, systemId);
    const targetNpcMode = target.components.get(NpcComponent)?.mode;

    if (action.kind === 'requestAssistance' || action.kind === 'lowerPrice') {
        // ränk 0x0400: "Player can always request battle assistance from
        // ships of the affiliated government" (rank_logic.ts).
        const getRank = (id: string) => world.resources
            .get(SimulationGameDataResource)?.data.Rank.getCached(id);
        const ranks = player.components.get(ActiveRanksComponent);
        const rankAlwaysAssists = ranksAllowAssistance(ranks, getRank,
            targetGovt?.id);
        if (!canRequestAssistance({
            govt: targetGovt,
            iffHostile,
            ship: target.components.get(ShipDataComponent),
            rankAlwaysAssists,
        })) {
            return;
        }
        // SOMEONE ELSE'S ESCORT: "Sorry sir, I'm just an escort." (ruling
        // #332, rendered by the dialog) — and nothing else happens to it.
        if (isSomeoneElsesEscort(target, found.uuid)) {
            return;
        }
        // NO NEED, NO ERRAND. The button is offered to every non-hostile ship
        // now, whatever shape the player's hull is in — the ship answers a
        // pointless request with "You're not in any trouble." (STR# 3000
        // 70-74, rendered by the dialog), or, when the player is under
        // attack, turns him down flat ("Yeah, right!", 95-99: reference H1
        // wave 15, no battle assistance), and is left completely alone here:
        // no AssistingComponent means NpcDecisionSystem keeps its brain and
        // AssistBehaviorSystem never steers it. The same synced predicate the
        // dialog uses, so every peer reaches the same verdict on the tick the
        // record is applied.
        const need = playerNeed(player);
        if (need === undefined) {
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
        // Checked in the dialog's order (escort, no need, busy, then the
        // government's willingness below) and evaluated from synced state
        // with the same predicates the dialog uses, so every peer refuses on
        // the same tick — and a busy ship never takes the player's money.
        if (shipIsFighting({
            npcMode: targetNpcMode,
            npcTarget: target.components.get(TargetComponent)?.target,
            shootsAllWeapons: target.components.has(ShootAllWeaponsComponent),
        })) {
            return;
        }
        // WHO HELPS, AND ON WHAT TERMS (hail.ts's assistWillingness): an
        // unfriendly government's ship refuses ("I'd rather not.") or makes
        // the player pay (ruling #297); any other ship, allies included,
        // refuses a disabled pilot ("Not a chance.") and sells a fuelless
        // one a jump of fuel (reference H1 waves 16 and 17); free help
        // comes only from a Roadside Assistance govt, a ränk 0x0800 (fuel
        // only, from the affiliated govt's ships or its ALLIES': reference
        // "P1 / H1 wave 18" and "H1 wave 19" — a disabled holder is
        // refused), or a ränk 0x0400's warship. The dialog only sends a
        // request to a ship with a price from its haggle page's Pay /
        // Accept Price button, so a request that arrives here for one IS
        // the payment; the price is re-derived from synced state, never
        // taken from the record. The alliance is read off GovtsResource
        // (every gövt, staged at genesis), so every peer agrees.
        const rankFreeFuel = ranksGiveFreeFuel(ranks, getRank,
            targetGovt?.id, affil => {
                const affilGovt = lookupGovt(world, affil);
                return !!affilGovt && !!targetGovt
                    && alliedEitherWay(affilGovt, targetGovt);
            });
        const willingness: AssistWillingness = assistWillingness({
            disposition, govt: targetGovt,
            aiType: target.components.get(NpcComponent)?.aiType,
            rankAlwaysAssists,
            free: assistIsFree(targetGovt, rankFreeFuel, need),
            need,
        });
        // Already on its way to this player: the errand was paid for (or
        // granted) once, and a second press must neither charge again nor
        // haggle over a deal already struck.
        const alreadyComing = target.components.get(AssistingComponent)
            ?.client === found.uuid;
        if (action.kind === 'lowerPrice') {
            // LOWER PRICE: the ship counters with 3/4 or withdraws its
            // offer, and always withdraws a counter (hail.ts's
            // lowerFuelPrice, the same pure draw the dialog shows). Only a
            // ship that is offering fuel right now can be haggled with,
            // and not over a price the pilot cannot pay: that press is
            // answered "You can't fool me - you can't afford it." and
            // changes nothing (reference "P1 / H1 wave 18", finding 3).
            if (willingness === 'sellFuel' && !alreadyComing) {
                const haggle = fuelHaggleOf(target, found.uuid);
                if (!canPayFuelPrice(player, action.target, haggle)) {
                    return;
                }
                setFuelHaggle(target, found.uuid, lowerFuelPrice(
                    haggle, action.target, found.uuid).haggle);
            }
            return;
        }
        switch (willingness) {
            case 'unwilling':
            case 'refuse':
                return;
            case 'forPay': {
                if (alreadyComing) {
                    return;
                }
                const credits = player.components.get(CreditsComponent);
                if (!credits) {
                    return;
                }
                // GUESS: help is priced like the ship's bribe (unmeasured).
                const amount = shipBribePrice(action.target, found.uuid,
                    credits.credits, !!targetGovt?.flags.largerBribes);
                if (amount <= 0 || credits.credits < amount) {
                    return;
                }
                credits.credits -= amount;
                break;
            }
            case 'sellFuel': {
                // ACCEPT PRICE: the price on the table — this ship's first
                // ask to this pilot (its own ask, capped by his cash),
                // 1,000 an earlier ask, or the counter to it — the
                // fuel errand on its way. Credits move here and nowhere
                // else (reference H1 wave 17: a 3,700 counter, 3,700 taken
                // at once). A price he cannot pay takes nothing and does
                // not count as an ask ("You can't fool me - you can't
                // afford it.", reference "P1 / H1 wave 18", finding 3).
                if (alreadyComing) {
                    return;
                }
                const credits = player.components.get(CreditsComponent);
                const haggle = fuelHaggleOf(target, found.uuid);
                const price = fuelPriceFor(player, action.target, haggle);
                if (!credits || credits.credits < price) {
                    return;
                }
                credits.credits -= price;
                setFuelHaggle(target, found.uuid,
                    fuelHaggleAfterAccept(haggle));
                target.components.set(AssistingComponent,
                    { client: found.uuid, fuel: FUEL_SALE_AMOUNT });
                return;
            }
            case 'willing':
                break;
        }
        // The helper breaks off whatever it was doing and comes over. Marking
        // it is enough: NpcDecisionSystem yields to the AssistingComponent
        // and AssistBehaviorSystem flies it in and heals the client.
        target.components.set(AssistingComponent, { client: found.uuid });
        return;
    }

    // Bribe / beg for mercy: only an IFF-HOSTILE, bribe-taking ship
    // bargains — Beg For Mercy is the hostile channel's button. A ship
    // attacking the player (or that did, inside the aggression window)
    // counts even if its politics are neutral, so the player can buy it off
    // just like a politically hostile one.
    if (!iffHostile) {
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
        now)) {
        return;
    }
    // The Bible's mercy semantics, the same pure verdict the dialog draws
    // its offer from (hail.ts's shipHailResponse): a silent ship answers
    // nothing, a Flags2 0x0001 govt has no Beg For Mercy, and only the
    // bribe flags make a plea cost money rather than earn a refusal.
    const aiType = target.components.get(NpcComponent)?.aiType;
    const response = shipHailResponse(targetGovt, iffHostile, aiType,
        target.components.get(ShipDataComponent));
    if (response.kind !== 'hostile' || !response.canBribe) {
        return;
    }
    const credits = player.components.get(CreditsComponent);
    if (!credits) {
        return;
    }
    // The ship's price (hail.ts's shipBribePrice, reference "R7 bribe
    // price, wave 22"): its fuel-sale ask grown with the cash, or 20,000
    // flat for a 0x8000 govt, capped by a third of the cash, floor 1,000.
    // A pilot who cannot pay it pays nothing and stays unpacified.
    const amount = shipBribePrice(action.target, found.uuid, credits.credits,
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
        // The briber's escorts too: a ship one of them provoked records
        // that escort as its aggressor (npc_targeting.ts's
        // responsibleShip), and the money buys off the whole flock's fight.
        if (npc.aggressor === found.uuid || (npc.aggressor !== undefined
            && isInFlock(npc.aggressor, found.uuid,
                id => world.entities.get(id)))) {
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

/** Where `playerUuid` stands with `target`'s fuel price
 * (FuelHaggleComponent), or a fresh haggle. */
function fuelHaggleOf(target: Entity, playerUuid: string): FuelHaggleState {
    return target.components.get(FuelHaggleComponent)?.get(playerUuid)
        ?? NO_FUEL_HAGGLE;
}

/**
 * The fuel price `targetUuid` names `player` with `haggle` on the table:
 * hail.ts's fuelAskingBase (the ship's own ask, capped by the pilot's
 * cash) plus the haggle. The dialog's fuelOffer quotes the same figure.
 */
function fuelPriceFor(player: Entity, targetUuid: string,
    haggle: FuelHaggleState): number {
    return fuelSalePrice(fuelAskingBase(targetUuid, {
        credits: player.components.get(CreditsComponent)?.credits ?? 0,
    }), haggle);
}

/** Whether `player` has the cash for the fuel price on the table. */
function canPayFuelPrice(player: Entity, targetUuid: string,
    haggle: FuelHaggleState): boolean {
    const credits = player.components.get(CreditsComponent)?.credits ?? 0;
    return credits >= fuelPriceFor(player, targetUuid, haggle);
}

/**
 * Records where `playerUuid` now stands with `target`'s fuel price. A fresh
 * entry object (never the shared NO_FUEL_HAGGLE); mutates the existing map
 * when there is one, so the delta stream sees the component it already
 * knows about.
 */
function setFuelHaggle(target: Entity, playerUuid: string,
    state: FuelHaggleState) {
    const entry = { asks: state.asks, countered: state.countered };
    const haggle = target.components.get(FuelHaggleComponent);
    if (haggle) {
        haggle.set(playerUuid, entry);
    } else {
        target.components.set(FuelHaggleComponent,
            new Map([[playerUuid, entry]]));
    }
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
        Optional(JumpComponent), Entities,
        Optional(ControlledByComponent)] as const,
    step(assisting, movement, entity, jump, entities, controlledBy) {
        // NEVER A PLAYER'S SHIP (#332). applyHail refuses to mark one, but
        // a stray AssistingComponent (a snapshot from an older build, a
        // future writer) must still not autopilot somebody's ship across
        // the system and heal whoever it was pointed at.
        if (controlledBy) {
            entity.components.delete(AssistingComponent);
            return;
        }
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
        if (assisting.fuel !== undefined) {
            // A FUEL SALE (reference H1 waves 16 and 17): the jump of fuel
            // that was paid for, and nothing else.
            const fuel = client.components.get(FuelComponent);
            if (fuel) {
                fuel.current = Math.min(fuel.max,
                    fuel.current + assisting.fuel);
            }
            entity.components.delete(AssistingComponent);
            return;
        }
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
        // A ship's price for fuel depends on how many of its offers the
        // player has answered and whether its counter is on the table:
        // synced so a rollback across a haggle converges, and delta-synced
        // so the comm dialog quotes the price applyHail will charge.
        world.addComponent(FuelHaggleComponent);
        serializer?.addComponent(FuelHaggleComponent, FuelHaggleType);
        world.resources.get(DeltaResource)?.addComponent(FuelHaggleComponent, {
            componentType: FuelHaggleType,
        });
        // A player-to-player hail (#332) is synced player state: it must
        // reach the RECIPIENT's display through the delta stream, and ride
        // snapshots so a rollback across it converges (see SentHail).
        world.addComponent(SentHailComponent);
        serializer?.addComponent(SentHailComponent, SentHailType);
        world.resources.get(DeltaResource)?.addComponent(SentHailComponent, {
            componentType: SentHailType,
        });
        world.addSystem(AssistBehaviorSystem);
    },
};
