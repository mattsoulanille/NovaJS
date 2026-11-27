import { GovtData } from 'novadatainterface/govt_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { World } from 'nova_ecs/world';
import { Subscription } from 'rxjs';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import {
    ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource, GovtComponent,
    SoundEvent, isPort, landable, displayName, SystemIdResource,
} from '../nova_plugin/core/index.js';
import {
    DisabledComponent, SourceComponent, FuelComponent, OutfitsStateComponent, ShipDataComponent,
    TargetComponent,
} from '../nova_plugin/ship/index.js';
import { escortParent, EscortAction } from '../nova_plugin/escorts/index.js';
import {
    assistGrantedText, ASSIST_GRANTED_FALLBACK, busyResponseText,
    BUSY_RESPONSE_FALLBACK, assistIsFree, canRequestAssistance, channelOpenText,
    CLEARED_TO_DOCK_INDEX, CLEARED_TO_LAND_INDEX, DOCKING_DENIED_INDEX, genericGreetings,
    greetingText, HAIL_RESPONSE_TABLE, hashString, hostileResponseText, LANDING_DENIED_INDEX,
    mercyAcceptedText, mercyLoweredText, mercyRefusedText, MISC_STRING_TABLE, miscString, noNeedResponseText,
    NO_NEED_RESPONSE_FALLBACK, NO_RESPONSE_FALLBACK, NO_RESPONSE_INDEX, planetTakesBribes,
    shipNoResponseText, assistWillingness, assistRefusedText, justAnEscortText,
    assistForPayText, assistPaidText, rudeGreetingText,
    shipHailResponse, shipIsFighting, shipTakesBribes, stellarBribeOfferText,
    stellarBribeRefusedText, stellarChannelOpenText, STELLAR_RESPONSE_TABLE,
    STELLAR_STATUS_FORBIDDEN_INDEX, STELLAR_STATUS_HOSTILE_INDEX, planetDisposition,
    STELLAR_STATUS_DOMINATED_INDEX, CombatRatingComponent,
    alliedEitherWay,
    shipDisposition, LegalRecordsComponent, loadLocalLaw, underFireRefusalText,
    MERCY_REFUSED_FALLBACK, assistNeed, disabledRefusalText, fuelSaleMoodText,
    fuelOfferWithdrawnText, fuelSalePrice, payMeText, fuelSaleTerms,
    FuelHaggleState, laterFuelHaggle, lowerFuelPrice,
    NO_FUEL_HAGGLE, fuelAskingBase, cantAffordText, planetBribePrice,
    planetBribeRefused, shipBribePrice, StellarClearance, bribeDay,
    laterStellarHaggle, lowerPlanetBribe, planetBribeAsk,
    StellarHaggleState, stellarBribeDeclinedText, stellarHaggleFrom,
    lowerMercyPrice, MercyHaggleState, mercyPrice, NO_MERCY_HAGGLE,
} from '../nova_plugin/reputation/index.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    HailAction, hailTargetBelongsToAnotherPlayer, isSomeoneElsesEscort,
    PlayerHailMessage, tributeDemandOutcome, tributeReleasedText,
    tributeResponseText,
} from '../nova_plugin/encounters/index.js';
import {
    stellarHostileTo, stellarTakesDemands,
} from '../nova_plugin/travel/index.js';
import { afterSimulationFrames, SimulationTimeResource } from './simulation_time.js';
import { isIffHostile } from '../nova_plugin/combat/index.js';
import {
    contrabandDetectedBy, FuelHaggleComponent, isAttackingPlayer, NpcComponent,
    ShootAllWeaponsComponent,
} from '../nova_plugin/npc/index.js';
import { PersComponent } from '../nova_plugin/spawn/index.js';
import {
    MissionShipComponent, PlayerShipSelector, CreditsComponent, MissionsComponent,
    ControlledByComponent, GameDateComponent,
    escortDealOf, escortProvenance, hasDominated,
} from '../nova_plugin/player/index.js';
import { targetIdentity } from './target_identity.js';
import {
    ActiveRanksComponent, ranksAllowAssistance, ranksGiveFreeFuel,
} from '../nova_plugin/ncb/index.js';
import {
    PlanetComponent, PlanetDataComponent, PlanetTargetComponent,
    stellarClearanceFor, StellarBribesComponent, StellarHaggleComponent,
    SystemVisitComponent,
} from '../nova_plugin/travel/index.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import {
    EscortManagement, EscortPressAction, escortReadout, HailContext,
    HailDialog, HOSTILE_STATUS_LINE, queuedDealKind,
    STELLAR_STATUS_DOMINATED_WORD, TributePressAnswer,
} from '../spaceport/hail_dialog.js';
import {
    escortDailyFee, escortSellValue, escortUpgradeCost,
} from '../spaceport/escort_fees.js';
import { shipGateContext } from '../spaceport/ship_gate_context.js';
import {
    ShipyardContext, shipStockGatesPass,
} from '../spaceport/shipyard_stock_rules.js';
import { ShipData } from 'novadatainterface/ship_data';
import {
    keepCentred, ScreenSize, stopCentring,
} from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { presentShipOffer } from './ship_mission_offer_plugin.js';
import { showStatusMessage } from './status_message_plugin.js';
import { BEEP_CANT_DO, playUiSound } from './ui_sound.js';

/**
 * Opens the communications (hail) dialog with the 'hail' key ('y') while in
 * flight. Mirrors mission_info_plugin: pull resources, add the dialog to the
 * stage, subscribe to the control, and open a modal overlay on the shared
 * MenuControls focus stack.
 *
 * Everything the dialog can DO to the simulation is dispatched as a display-
 * world event that browser.ts forwards to the deterministic bridge:
 *  - HailRequestEvent   -> bridge.hail(action)         (assist / bribe)
 *  - EscortActionEvent  -> bridge.escortAction(action) (release/sell/upgrade)
 * The dialog itself never touches the sim, keeping every effect on the
 * input-record path that all peers replay identically.
 *
 * NOT EVERY HAIL OPENS A CHANNEL: with a stellar that is not a PORT selected
 * (Jupiter, a dead hypergate, a wormhole — landable.ts isPort) there is
 * nobody to answer, so no dialog appears at all — nor from any working gate,
 * usable or not (gateRefusesHail). The press gets the original's "No
 * response." on the bottom-left status line and the can't-do beep, the same
 * feedback a blocked landing gets. See hailIsUnanswerable / refuseHail.
 *
 * ESCORT COMM: the escort variant MANAGES one of the player's own escorts
 * (Upgrade / Sell / Release / Close Channel per hail/hail_escort.png and
 * hail/hail_captured_escort.png), not a fleet-command panel — commanding
 * escorts is the keyboard escort-controls' job. All three functions are live.
 * Their prices come off the escort's CURRENT ship class through
 * spaceport/escort_fees.ts — the same module the settlement at lift-off
 * re-derives them from — and each press leaves as an EscortActionEvent, so
 * the escort dialog's effects ride the same input-record path every other
 * simulation effect does.
 *
 * Upgrade and Sell QUEUE their deal for the next spaceport departure rather
 * than striking it here (nova_plugin/escorts/escort_action.ts); they are
 * MUTUALLY EXCLUSIVE toggles, and queueing one un-queues the other (ruling
 * #249). This module's job for
 * them is the OFFER: what each would cost, whether the player can pay it
 * today, whether the target hull is one they are allowed at all
 * ({@link escortUpgradeOffer}), and which deals are already queued — all
 * read off the same synced state the simulation writes, so the box a
 * second peer draws is the same box.
 */

export const HailDialogResource = new Resource<HailDialog>('HailDialog');

/**
 * What the response well says after a press in a channel to another
 * player's ship (#332). NovaJS's own wording: the original is single-player.
 */
export const PLAYER_HAIL_SENT_TEXT = 'Message sent.';
/** How many two-frame waits a paid mercy price's channel refresh makes for
 * the simulation to show the ship bought off (about 10 frames). */
const BOUGHT_OFF_REFRESH_TRIES = 5;
const HailControlsSubscription =
    new Resource<Subscription>('HailControlsSubscription');

/** Fired when a hail dialog action needs a deterministic sim effect. */
export const HailRequestEvent =
    new EcsEvent<{ action: HailAction }>('HailRequestEvent');

/**
 * Fired when the escort-management box's Upgrade / Sell / Release is
 * pressed. browser.ts forwards it to bridge.escortAction, which STAGES an
 * upgrade's target ship class before scheduling the input record — which is
 * exactly why this is a separate event from HailRequestEvent rather than a
 * fourth HailAction: an escort upgrade is an async, game-data-staging
 * dispatch and a hail is not.
 *
 * The record carries INTENT ONLY (which escort, and which class an upgrade
 * claims to be going to). Prices, provenance and eligibility are all
 * recomputed by applyEscortAction against synced state.
 */
export const EscortActionEvent =
    new EcsEvent<{ action: EscortAction }>('EscortActionEvent');

function getPlayerShip(world: World) {
    for (const [uuid, entity] of world.entities) {
        if (entity.components.has(PlayerShipSelector)) {
            return { uuid, entity };
        }
    }
    return undefined;
}

/**
 * Whether the player's hail would go somewhere with no traffic control —
 * anything that is not a PORT (landable.ts isPort). Two ways to fail it,
 * both from the spöb Flags:
 *
 *  - NOT LANDABLE (0x0001 clear): Jupiter, a scenery world, a wrecked
 *    hypergate.
 *  - UNINHABITED (0x0020 set): the Bible's own gloss on that bit is "no
 *    traffic control or refuelling", so Pan, Spica and the wormholes have
 *    nobody listening even though the player may land on them.
 *
 * There is nobody down there to answer, so the original opens NO channel at
 * all: it prints "No response." (STR# 2002 index 52) on the bottom-left
 * status line and beeps. Split out from computeContext — which returns
 * undefined for exactly this case — so the plugin can tell a refusal apart
 * from "nothing is targeted", which is also undefined and is silent.
 *
 * A THIRD way, any WORKING GATE ({@link gateRefusesHail}), whether or not
 * the player may use it: MEASURED both ways (reference "Stellar hail
 * graphic, wave 23", HG-V01 after "Hypergate usage denied."; "Hypergates
 * and the radar, wave 24", Kit Gate C2 after "Cleared for hypergate
 * entry"), each answering the hail with "No response." and no dialog. No
 * clearance is read, so no game data is needed.
 *
 * A targeted SHIP wins over the planet target, the same order computeContext
 * reads them in, so hailing a ship while a dead moon happens to be selected
 * still opens the ship's channel.
 */
export function hailIsUnanswerable(world: World): boolean {
    const player = getPlayerShip(world);
    if (!player) {
        return false;
    }
    const shipTargetUuid = player.entity.components.get(TargetComponent)?.target;
    if (shipTargetUuid && world.entities.get(shipTargetUuid)) {
        return false;
    }
    const planetTargetUuid =
        player.entity.components.get(PlanetTargetComponent)?.target;
    const planetTarget = planetTargetUuid
        ? world.entities.get(planetTargetUuid) : undefined;
    const planetData = planetTarget?.components.get(PlanetDataComponent);
    if (!planetData) {
        return false;
    }
    return !isPort(planetData.flags) || gateRefusesHail(planetData);
}

/**
 * Whether a hailed GATE stays silent: every working transit stellar (a
 * hypergate or a wormhole, PlanetData.gate), whether or not the player may
 * use it. A destroyed gate is unlandable, so not a port, and already silent
 * through isPort.
 *
 * MEASURED for hypergates both ways: HG-V01, which had denied the pilot
 * ("Hypergate usage denied."; reference "Stellar hail graphic, wave 23"),
 * and Kit Gate C2 right after "Cleared for hypergate entry" (reference
 * "Hypergates and the radar, wave 24") each gave "No response." on the
 * status line and no comm.
 * GUESS: a wormhole follows the hypergate. Every stock wormhole is
 * uninhabited (0x0020), no port, and already silent through isPort; this
 * only decides a plug-in's inhabited one.
 */
export function gateRefusesHail(planetData: Pick<PlanetData, 'gate'>):
    boolean {
    return !!planetData.gate;
}

/**
 * The player's landing clearance at a stellar in this world: the SAME
 * verdict the landing gate and the radar blip read (planet_plugin's
 * stellarClearanceFor), off the player's delta-synced components.
 */
function playerStellarClearance(world: World, player: Entity,
    gameData: SimulationGameDataInterface, planetData: PlanetData,
    planetId: string): StellarClearance {
    return stellarClearanceFor({
        planetData, gameData,
        records: player.components.get(LegalRecordsComponent),
        shipData: player.components.get(ShipDataComponent),
        outfits: player.components.get(OutfitsStateComponent),
        bribes: player.components.get(StellarBribesComponent),
        ranks: player.components.get(ActiveRanksComponent),
        missions: player.components.get(MissionsComponent),
        // Bribe expiries are SIM-clock stamps; the display world's
        // own TimeResource is the wall clock and would judge every
        // paid bribe already expired.
        planetId,
        systemId: world.resources.get(SystemIdResource),
        now: world.resources.get(SimulationTimeResource)?.time ?? 0,
    });
}

/**
 * Whether the hail key is aimed at a DISABLED ship, which answers nothing:
 * the original prints "No response." on the status line and opens no
 * channel, for a disabled mission ally, a disabled hired escort, any
 * disabled ship (reference "Reviving a disabled ally, wave 11"; the same
 * escort had answered with a channel before it was disabled). Checked
 * before a përs's hail-offered mission too, since a hulk offers nothing.
 */
export function hailTargetIsDisabled(world: World): boolean {
    const player = getPlayerShip(world);
    const shipTargetUuid = player?.entity.components.get(TargetComponent)
        ?.target;
    const shipTarget = shipTargetUuid
        ? world.entities.get(shipTargetUuid) : undefined;
    return !!shipTarget?.components.has(DisabledComponent);
}

/** What the player ship needs help with (hail.ts's assistNeed — the same
 * predicate applyHail reads), if anything. */
function playerNeed(entity: ReturnType<typeof getPlayerShip>) {
    return entity ? assistNeed(entity.entity.components.has(DisabledComponent),
        entity.entity.components.get(FuelComponent)) : undefined;
}

/**
 * Whether some other ship is ATTACKING the player's ship right now: the
 * behavioural reading of the hostility rule (allegiance.ts's
 * isAttackingPlayer: in attack posture on it, or it hit the player or
 * locked a missile on it within the aggression window). Read off synced
 * components and the simulation clock, like everything the press decides
 * on.
 *
 * GUESS for who counts: the reference measured NPC raiders; another
 * player's ship attacking us counts here too (the same rule paints it red).
 */
function playerUnderAttack(world: World,
    player: ReturnType<typeof getPlayerShip>): boolean {
    if (!player) {
        return false;
    }
    const now = world.resources.get(SimulationTimeResource)?.time ?? 0;
    for (const [uuid, entity] of world.entities) {
        if (uuid !== player.uuid
            && isAttackingPlayer(uuid, entity, player.uuid, player.entity, now)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether a hailed ship is busy fighting, read off the same synced components
 * the simulation's applyHail reads (hail_plugin.ts) and passed through the one
 * shared predicate, so the dialog's answer and the sim's refusal agree.
 */
export function targetIsFighting(target: Entity): boolean {
    return shipIsFighting({
        npcMode: target.components.get(NpcComponent)?.mode,
        npcTarget: target.components.get(TargetComponent)?.target,
        shootsAllWeapons: target.components.has(ShootAllWeaponsComponent),
    });
}

/**
 * The things a hailed ship can say to a Request Assistance press, all
 * resolved from STR# 3000 when the channel opens (the button's handler is
 * synchronous, so the text cannot be fetched on the press).
 */
export interface AssistReplies {
    /** "All right, I'll help you." — accepted, the errand is dispatched. */
    granted: string;
    /**
     * "Okay, I'm on my way." (STR# 3000 145-149) — FREE FUEL from a ship of
     * the govt a ränk 0x0800 is affiliated with, said at once with no price
     * popup (reference "P1 / H1 wave 18", finding 4: "Okay, I'm on my
     * way.", index 145). Present only for such a ship; the errand is
     * dispatched.
     */
    freeFuel?: string;
    /** "I'm busy." — the ship is in the middle of a fight. */
    busy: string;
    /** "You're not in any trouble." — the player's ship is fine. */
    noNeed: string;
    /**
     * "Yeah, right!" / "No way." (STR# 3000 95-99) — the player's ship is
     * fine but under attack (reference H1 wave 15; underFireRefusalText).
     * A ship of a govt whose ränk 0x0400 the player holds says it too, a
     * TRADER ("Not a chance.", reference H1 wave 17, finding 7) and a
     * WARSHIP alike ("No way." / "Not a chance." / "You wish.", "H1 wave
     * 19", finding 4: no battle assistance has been seen at all). Optional
     * only so a hand-built reply set may leave it out (the no-need line is
     * then said).
     */
    underFire?: string;
    /**
     * "Sorry sir, I'm just an escort." — SOMEONE ELSE'S ESCORT (ruling
     * #332). Present only for such a ship, and said to every request,
     * whatever shape the player is in: an escort does not decide.
     */
    escort?: string;
    /**
     * "I'd rather not." — an unwilling ship (an unfriendly government that
     * takes no bribes, or a ship another player owns). Present only for
     * such a ship.
     */
    unwilling?: string;
    /**
     * "... but it'll cost you." — an unfriendly government's ship that
     * takes bribes names its price (ruling #297). Present only for such a
     * ship; the press moves onto the haggle page.
     */
    forPay?: string;
    /**
     * "Not a chance." / "No way." (STR# 3000 95-99) — a non-hostile ship's
     * answer to a disabled pilot, allies included (reference H1 waves 16
     * and 17). Present only for a ship that would not help him for free
     * (hail.ts's assistWillingness 'refuse').
     */
    refusal?: string;
    /**
     * A non-hostile ship's fuel sale to a fuelless pilot (reference H1
     * waves 16 and 17; assistWillingness 'sellFuel'). Present only for such
     * a ship; the price is read at the press, off the synced haggle.
     */
    fuelSale?: FuelSaleLines;
    /**
     * A refusing planet's bribe (reference "R7 planet bribe, wave 28"):
     * what Lower Price needs to counter or withdraw. Present only on a
     * planet's channel that names a price.
     */
    planetBribe?: PlanetBribeLines;
    /**
     * A stellar's Demand Tribute / Release row (#353): what the press
     * answers from. Present on every channel to a stellar that takes a
     * demand.
     */
    tribute?: TributeLines;
    /**
     * A hostile ship's Beg For Mercy price (reference "R7 a provoked
     * freighter's Lower Price, wave 32"): what Lower Price needs to counter
     * or withdraw and the next plea to ask 1,000 more. Present only on a
     * hostile ship's channel that names a price.
     */
    mercy?: MercyLines;
}

/** What a hostile ship naming a Beg For Mercy price needs for the
 * channel's haggle, resolved when the channel opens (the Lower Price
 * handler is synchronous). */
export interface MercyLines {
    /** The channel's first ask (hail.ts's shipBribePrice). */
    firstAsk: number;
    /** The ship's mood line, in the well behind the popup. */
    offer: string;
    /** "Okay, I'll leave you alone." (STR# 3000 135-139), once paid. */
    accepted: string;
    /** This hail's withdrawal line (STR# 3000 150-154). */
    withdrawn: string;
    /** STR# 2002, for the popup's "Pay me N credits.". */
    miscStrings: readonly string[] | undefined;
}

/**
 * The ship's Beg For Mercy offer for the price on the table: the channel's
 * first ask plus 1,000 for each ask withdrawn on it, or the 3/4 counter
 * while one is (hail.ts's mercyPrice), the same figure applyHail charges on
 * Accept Price.
 */
export function mercyOffer(lines: MercyLines, haggle: MercyHaggleState,
    credits: number): NonNullable<HailContext['bribe']> {
    const amount = mercyPrice(lines.firstAsk, haggle);
    return {
        amount, canAfford: credits >= amount && amount > 0,
        purpose: 'mercy',
        offer: lines.offer,
        demand: payMeText(lines.miscStrings, amount),
        accepted: lines.accepted,
        withdrawn: lines.withdrawn,
    };
}

/**
 * What a stellar's Demand Tribute / Release press needs, resolved when the
 * channel opens (the press handler is synchronous).
 */
export interface TributeLines {
    /** The stellar's uuid (the record's target) and NOVA id. */
    planetUuid: string;
    planetId: string;
    isStation: boolean;
    /** Whether it has a defence fleet (PlanetData.defense). */
    hasFleet: boolean;
    /** STR# 3002, the stellar's lines. */
    stellarStrings: readonly string[] | undefined;
    /** The identity block's lines above its Status line. */
    identity: readonly string[];
    /** The landing clearance's own Status line, when it has one. */
    clearanceStatus?: string;
    /** STR# 2002 173 / 171: "Hostile" / "Dominated". */
    hostileWord: string;
    dominatedWord: string;
}

/**
 * The identity block of a stellar's channel: its name and class caption,
 * then ONE Status line: "Dominated" for a stellar the pilot has dominated
 * (reference "Tribute (R18), wave 38": "Status: Dominated", green), else
 * the landing clearance's own ("Hostile" / "Forbidden"), else "Hostile"
 * while the stellar is against him over tribute (its laugh in this
 * channel, or its fleet up against him: waves 38 / 39).
 */
export function tributeHeading(lines: TributeLines,
    status: 'dominated' | 'hostile' | undefined): string {
    const statusLine = status === 'dominated'
        ? `Status: ${lines.dominatedWord}`
        : lines.clearanceStatus
            ?? (status === 'hostile' ? `Status: ${lines.hostileWord}`
                : undefined);
    return [...lines.identity, ...(statusLine ? [statusLine] : [])]
        .join('\n');
}

/**
 * The answer to a Demand Tribute / Release press (#353), from the same
 * pure verdict the simulation applies (encounters/tribute.ts's
 * tributeDemandOutcome over the pilot's synced combat rating), and the
 * record to send: every demand sends one, a laugh included, which costs
 * one kill's record (reference "Tribute leftovers (R18), wave 40";
 * tribute.ts's TRIBUTE_LAUGH_KILLS). `seed` picks the laugh or fleet line.
 *
 * GUESS (display only): "has a fleet" is PlanetData.defense here; the
 * simulation also needs the fleet's düde to name a ship class, which every
 * stock düde does.
 */
export function tributePressAnswer(lines: TributeLines,
    kind: 'demand' | 'release', rating: number, seed: number):
    TributePressAnswer & { record: 'demandTribute' | 'releaseTribute' } {
    if (kind === 'release') {
        return {
            answer: tributeReleasedText(lines.stellarStrings, lines.isStation),
            heading: tributeHeading(lines, undefined),
            next: 'demand', record: 'releaseTribute',
        };
    }
    const outcome = tributeDemandOutcome(rating, lines.hasFleet);
    return {
        answer: tributeResponseText(lines.stellarStrings, outcome,
            lines.isStation, seed),
        heading: tributeHeading(lines,
            outcome === 'dominate' ? 'dominated' : 'hostile'),
        next: outcome === 'dominate' ? 'release' : 'demand',
        record: 'demandTribute',
    };
}

/** What a planet naming a bribe needs for its haggle, resolved when the
 * channel opens (the Lower Price handler is synchronous). */
export interface PlanetBribeLines {
    /** The stellar's NOVA id, StellarHaggleComponent's key. */
    planetId: string;
    /** The asking price before any counter (hail.ts's planetBribePrice). */
    price: number;
    /** "No deal, cheapskate." (STR# 3002 30-34), on a withdrawal. */
    withdrawn: string;
    /** "You wish." / ... (STR# 3002 45-49), every later offer that visit. */
    refused: string;
    /** STR# 2002, for the popup's "Pay us N credits.". */
    miscStrings: readonly string[] | undefined;
}

/**
 * The planet's offer for the price on the table: `lines.price`, or its
 * 3/4 counter while `haggle` has one (hail.ts's planetBribeAsk), the same
 * figure applyHail charges on Accept Price.
 */
export function planetBribeOffer(lines: PlanetBribeLines,
    haggle: StellarHaggleState, credits: number):
    NonNullable<HailContext['bribe']> {
    const amount = planetBribeAsk(lines.price, haggle);
    return {
        amount, canAfford: credits >= amount && amount > 0,
        purpose: 'landing',
        demand: payMeText(lines.miscStrings, amount, 'us'),
        withdrawn: lines.withdrawn,
        refused: lines.refused,
    };
}

/**
 * Where this player stands with the planet's bribe in this system visit,
 * as the simulation last mirrored it (StellarHaggleComponent on the
 * player).
 */
export function stellarHaggleOf(player: Entity, planetId: string):
    StellarHaggleState {
    return stellarHaggleFrom(
        player.components.get(StellarHaggleComponent)?.get(planetId));
}

/** What a ship selling fuel says, resolved when the channel opens. */
export interface FuelSaleLines {
    /**
     * The ship's opening line in its mood (hail.ts's fuelSaleTerms): "You're
     * in luck, I'm in a good mood today." (STR# 3000 115-119), "All right,
     * I'll give you some help, but it'll cost you." (140-144) or "I'm in a
     * bad mood today, so it's going to cost extra." (120-124).
     */
    mood: string;
    /** "If that's the way you feel ..." (155-159), when Lower Price
     * withdraws the offer. */
    withdrawn: string;
    /** "Hold on, I'll be right there." (145-149), after Accept Price. */
    accepted: string;
    /** "You can't fool me - you can't afford it." (60-64), Accept Price or
     * Lower Price on a price the pilot cannot pay. */
    cantAfford: string;
    /** STR# 2002, for the popup's "Pay me N credits." ({@link payMeText}). */
    miscStrings: readonly string[] | undefined;
}

/** The pinned literals, used when the string table cannot be loaded. */
export const ASSIST_REPLIES_FALLBACK: AssistReplies = {
    granted: ASSIST_GRANTED_FALLBACK,
    busy: BUSY_RESPONSE_FALLBACK,
    noNeed: NO_NEED_RESPONSE_FALLBACK,
    underFire: MERCY_REFUSED_FALLBACK,
};

/**
 * What pressing "Request Assistance" gets: the line the ship answers with,
 * and whether a request is dispatched to the simulation at all.
 *
 * The two refusals come first and dispatch NOTHING — a healthy player is told
 * they are in no trouble, and a ship in a fight says it is busy — so the
 * hailed ship's combat state is left completely untouched. Need is checked
 * ahead of busy: asking for aid you don't need is pointless whatever the
 * other captain happens to be doing.
 *
 * A healthy player who is UNDER ATTACK is not told he is in no trouble: he
 * is turned down flat, "Yeah, right!" / "No way." (STR# 3000 95-99), and
 * nothing else happens — no ship comes to fight his attackers. Measured on
 * the original, whatever his record (reference "W1 / C1 / H1 wave 15", H1).
 * A disabled or fuelless player under attack (unmeasured) goes on to the
 * busy / willingness answers below, as before.
 *
 * Evaluated at the moment of the press (not when the channel was opened) so a
 * ship that got into a fight, or a player who took a hit, while the dialog was
 * up still gets an honest answer. The simulation's applyHail re-checks the
 * SAME predicates over the SAME synced components and is the authority; this
 * exists so the player SEES the answer instead of pressing a button that
 * silently does nothing.
 */
export function assistAnswer(world: World, targetUuid: string | undefined,
    replies: AssistReplies,
    /**
     * This ship's haggle as the dialog's own presses left it, which the
     * simulation may not have mirrored back yet (see {@link fuelHaggleOf}):
     * the dialog quotes the further-along of the two.
     */
    localHaggle?: FuelHaggleState):
    {
        line: string, dispatch: boolean, haggle: boolean,
        /** A neutral ship's fuel price, for the haggle popup. */
        offer?: NonNullable<HailContext['bribe']>,
    } {
    // Someone else's escort never takes the request on its own account.
    if (replies.escort !== undefined) {
        return { line: replies.escort, dispatch: false, haggle: false };
    }
    const player = getPlayerShip(world);
    const need = playerNeed(player);
    if (need === undefined) {
        const line = replies.underFire !== undefined
            && playerUnderAttack(world, player)
            ? replies.underFire : replies.noNeed;
        return { line, dispatch: false, haggle: false };
    }
    const target = targetUuid ? world.entities.get(targetUuid) : undefined;
    if (target && targetIsFighting(target)) {
        return { line: replies.busy, dispatch: false, haggle: false };
    }
    // The unfriendly government's answer (ruling #297): a refusal, or a
    // price. A price dispatches NOTHING yet — the haggle page's Pay does.
    if (replies.unwilling !== undefined) {
        return { line: replies.unwilling, dispatch: false, haggle: false };
    }
    if (replies.forPay !== undefined) {
        return { line: replies.forPay, dispatch: false, haggle: true };
    }
    // A NON-HOSTILE ship (reference H1 waves 16 and 17): a disabled pilot
    // is refused flat, a fuelless one is offered fuel at a price — the
    // ship's mood line in the well, "Pay me N credits." on the haggle
    // popup. Nothing is dispatched until Accept Price.
    if (need === 'disabled' && replies.refusal !== undefined) {
        return { line: replies.refusal, dispatch: false, haggle: false };
    }
    if (need === 'fuel' && replies.freeFuel !== undefined) {
        return { line: replies.freeFuel, dispatch: true, haggle: false };
    }
    if (need === 'fuel' && replies.fuelSale !== undefined && player
        && targetUuid) {
        const haggle = laterFuelHaggle(localHaggle,
            fuelHaggleOf(world, targetUuid, player.uuid));
        return {
            line: replies.fuelSale.mood, dispatch: false, haggle: true,
            offer: fuelOffer(world, targetUuid, replies.fuelSale, haggle),
        };
    }
    return { line: replies.granted, dispatch: true, haggle: false };
}

/**
 * The haggle popup's offer for the price on the table: `targetUuid`'s first
 * ask to this pilot (hail.ts's fuelAskingBase: the ship's own ask, capped
 * by the pilot's cash) and `haggle` (1,000 an earlier ask, or the 3/4
 * counter), the same figure applyHail charges on Accept Price. A price he
 * cannot pay is still offered (Accept Price is not greyed); pressing either
 * button answers `cantAfford`.
 */
export function fuelOffer(world: World, targetUuid: string,
    sale: FuelSaleLines, haggle: FuelHaggleState):
    NonNullable<HailContext['bribe']> {
    const entity = getPlayerShip(world)?.entity;
    const credits = entity?.components.get(CreditsComponent)?.credits ?? 0;
    const price = fuelSalePrice(fuelAskingBase(targetUuid, { credits }),
        haggle);
    return {
        amount: price, canAfford: credits >= price,
        purpose: 'fuel',
        demand: payMeText(sale.miscStrings, price),
        accepted: sale.accepted,
        withdrawn: sale.withdrawn,
        cantAfford: sale.cantAfford,
    };
}

/**
 * Where this player stands with `targetUuid`'s fuel price, as the
 * simulation last mirrored it (FuelHaggleComponent on the ship). A press
 * made a moment ago may not be in it yet, which is what assistAnswer's
 * `localHaggle` covers.
 */
export function fuelHaggleOf(world: World, targetUuid: string,
    playerUuid: string): FuelHaggleState {
    return world.entities.get(targetUuid)?.components
        .get(FuelHaggleComponent)?.get(playerUuid) ?? NO_FUEL_HAGGLE;
}

/**
 * The assistance replies for a hailed ship, read out of the already-loaded
 * STR# 3000 lines (the stock comm-response table) ahead of time. Seeded by
 * the ship's uuid so each line is stable per encounter and identical on every
 * peer; an unavailable table leaves every group falling back to its pinned
 * literal, exactly as noShipsForHire does (spaceport/hire_escort.ts).
 */
function resolveAssistReplies(strings: readonly string[] | undefined,
    seed: number): AssistReplies {
    return {
        granted: assistGrantedText(strings, seed),
        busy: busyResponseText(strings, seed),
        noNeed: noNeedResponseText(strings, seed),
        // A healthy pilot under attack is refused from STR# 3000 95-99
        // ("No way." / "Not a chance." / "You wish.") by everyone, a ränk
        // 0x0400 holder asking a warship of his affiliated govt included:
        // reference "H1 wave 19", finding 4 (four AI 4 warships of the
        // affiliated govt, already fighting the raider on him, refused).
        underFire: underFireRefusalText(strings, seed),
    };
}

/**
 * A string table's lines, or undefined when it can't be loaded (every caller
 * then falls back to its pinned literal). Used for the stellar comm table
 * (STR# 3002) and the misc traffic-control table (STR# 2002).
 */
async function loadStrings(
    displayAssets: DisplayAssetDataInterface | undefined, table: string):
    Promise<readonly string[] | undefined> {
    if (!displayAssets) {
        return undefined;
    }
    try {
        return (await displayAssets.data.StringTable.get(table)).strings;
    } catch {
        return undefined;
    }
}

/**
 * Computes the dialog context for the player's current target (ship or, if no
 * ship is targeted, the selected planet). Returns undefined when there is
 * nothing to hail. Async: loads govt / pers game data.
 *
 * `replies` are the three lines a Request Assistance press can be answered
 * with, resolved here because the button's handler is synchronous; WHICH one
 * the ship says is decided by the press itself (assistAnswer — see the
 * plugin's requestAssistance callback).
 */
/**
 * The identity block for the ship comm's LOWER well (PICT 8511's second
 * black box), built the way the references fill it:
 *
 *   hail.png          "Class: Terrapin"
 *   hail_hostile.png  "Class: Fed Destroyer" / "(Federation)" /
 *                     "Status: Hostile"
 *
 * A përs is named instead of classed (the original titles a named captain by
 * name); the government line and the Status line only appear when there is
 * something to say. Pure, so the wording is pinned in specs.
 */
export function shipIdentityBlock({ persName, shipClass, govtName, hostile }: {
    persName?: string, shipClass?: string, govtName?: string, hostile: boolean,
}): string {
    const lines: string[] = [];
    if (persName) {
        lines.push(persName);
    } else {
        lines.push(`Class: ${shipClass || 'Unidentified ship'}`);
    }
    if (govtName) {
        lines.push(`(${govtName})`);
    }
    if (hostile) {
        lines.push(HOSTILE_STATUS_LINE);
    }
    return lines.join('\n');
}

/**
 * The class name the comm dialog's identity block shows: the shïp CommName
 * ("Aur Carrier" for an Aurora Carrier — "Let's match the original", ruling
 * #297; ruling #332's screenshot reads "Class Fed Viper (Federation)"),
 * falling back to the resource name with its developer-only "; comment"
 * suffix hidden when a class has no CommName.
 */
export function commClassName(ship: Pick<ShipData, 'name' | 'commName'>):
    string {
    return ship.commName?.trim() ? ship.commName.trim()
        : displayName(ship.name);
}

/**
 * Whether the player may be OFFERED an upgrade to `toShip`, and its
 * ShipData when they may.
 *
 * The class has to be one the player would be allowed to have. The original
 * gates hulls on two things that have nothing to do with a shop's stock —
 * the shïp's own Require flags and its Availability control-bit expression
 * (EVN Bible ~:2588/~:2620) — and an escort upgrade hands the player one of
 * those hulls, so the same two gates apply. This calls the SHIPYARD's own
 * {@link shipStockGatesPass} with NO planet context, which is exactly:
 *
 *   Require    met by the player's Contribute (hull, outfits, ranks, crons);
 *   Availability   its control-bit test passes;
 *   TechLevel  NOT applied — `ctx.planet` undefined means "no shipyard",
 *              which stocks everything.
 *
 * Tech level and the BuyRandom day roll are deliberately left out: they say
 * what a PARTICULAR shipyard has on the lot today, and an escort upgrade is
 * arranged over a comm channel in deep space with no stellar involved. What
 * is left is the two gates that are about the PLAYER rather than the shop.
 *
 * A class the data set cannot produce is refused for the same reason a
 * shop skips an unloadable hull — better to offer nothing than to promise
 * a ship that cannot be built.
 */
export async function escortUpgradeOffer(toShip: string | null,
    ctx: ShipyardContext, gameData: SimulationGameDataInterface):
    Promise<ShipData | undefined> {
    if (toShip === null) {
        return undefined;
    }
    const upgraded = await gameData.data.Ship.get(toShip).catch(() => undefined);
    if (!upgraded) {
        return undefined;
    }
    return shipStockGatesPass(upgraded, ctx) ? upgraded : undefined;
}

export async function computeContext(world: World,
    gameData: SimulationGameDataInterface,
    displayAssets?: DisplayAssetDataInterface,
    /**
     * The planet haggles as this dialog's own presses left them (by NOVA
     * id), which the simulation may not have mirrored back yet.
     */
    localStellarHaggle?: ReadonlyMap<string, StellarHaggleState>,
    /**
     * Which opening of the comm dialog this is (see the plugin's
     * openHail): a hostile ship's withdrawal line is drawn per hail.
     */
    channel = 0):
    Promise<{
        context: HailContext, target: string, isEscort: boolean,
        replies: AssistReplies,
    } | undefined> {
    const player = getPlayerShip(world);
    if (!player) {
        return undefined;
    }
    const playerGovt = player.entity.components.get(GovtComponent)?.id
        ? await gameData.data.Govt.get(
            player.entity.components.get(GovtComponent)!.id).catch(() => undefined)
        : undefined;
    const playerRecords = player.entity.components.get(LegalRecordsComponent);
    const credits = player.entity.components.get(CreditsComponent)?.credits ?? 0;

    const shipTargetUuid = player.entity.components.get(TargetComponent)?.target;
    const shipTarget = shipTargetUuid
        ? world.entities.get(shipTargetUuid) : undefined;

    if (shipTargetUuid && shipTarget) {
        const govtId = shipTarget.components.get(GovtComponent)?.id;
        const govt = govtId
            ? await gameData.data.Govt.get(govtId).catch(() => undefined)
            : undefined;
        // PersComponent carries the resolved name; the pers RECORD (comm
        // quote / hail pict) is fetched by id when present.
        const persComponent = shipTarget.components.get(PersComponent);
        const pers = persComponent
            ? await gameData.data.Pers.get(persComponent.id).catch(() => undefined)
            : undefined;
        const aiType = shipTarget.components.get(NpcComponent)?.aiType;
        // The law of THIS system judges a criminal record (reference
        // A14, ruling #376) — loaded before isIffHostile below, whose
        // synchronous read of the same caches then agrees with it.
        const systemId = world.resources.get(SystemIdResource);
        const law = await loadLocalLaw(gameData, systemId);
        const disposition = shipDisposition(govt, playerGovt, playerRecords,
            law, undefined, contrabandDetectedBy(player.entity));
        // HOSTILITY IN THE CHANNEL IS THE SHIP'S IFF (Matthew's ruling on
        // #297): the one predicate the target corners paint with
        // (hostility.ts's isIffHostile) — recent aggression and another
        // player's escort engaging us included — read off the same synced
        // components the sim's applyHail reads, on the MIRRORED SIM CLOCK
        // (aggression timestamps are sim time; this world's own
        // TimeResource is the wall clock). So the Status line, the offer
        // slot, the corners and applyHail's verdict all agree.
        const iffHostile = isIffHostile(shipTargetUuid, shipTarget,
            player.uuid, player.entity, gameData,
            uuid => world.entities.get(uuid),
            world.resources.get(SimulationTimeResource)?.time ?? 0,
            systemId);

        const shipData = shipTarget.components.get(ShipDataComponent);
        // pers.hailPict is ALREADY a global id (the parser emits e.g.
        // "nova:4001"), so it must NOT be re-prefixed. Fall back to the ship's
        // own pict when the pers has no custom portrait.
        const image = pers?.hailPict ?? shipData?.pict ?? null;
        // A mission's special ship answers under the name its mïsn gave
        // it (ShipNameID), the same way a përs answers under its own —
        // hailing the bounty target you were sent after should not say
        // "Class: Thunderhead" when the briefing named it. Resolved
        // through the SAME rule as the target pane (target_identity.ts),
        // so the two panels can never disagree; a përs the mission
        // replaced keeps its përs identity, the more specific of the two.
        const missionShip = shipTarget.components.get(MissionShipComponent);
        const identity = targetIdentity({
            persName: persComponent?.name,
            missionName: missionShip?.name,
            shipClass: shipData?.name ?? '',
        });
        const heading = shipIdentityBlock({
            persName: identity.named ? identity.name : undefined,
            shipClass: shipData ? commClassName(shipData) : undefined,
            govtName: govt?.commName,
            // The ship's IFF alone (ruling #297): "A ship of an unfriendly
            // government may show as neutral when hailed".
            hostile: iffHostile,
        });

        // ANOTHER PLAYER'S OWN SHIP (ruling #332): "hailing a player should
        // [eventually] open an actual channel ... For now, buttons pressed
        // should just send the message to the bottom left info text area on
        // that player's screen. Nothing should take control of their ship."
        // The ship comm's ordinary column — the offer slot by that ship's
        // IFF like any ship's — whose every press is a message (see
        // HailContext.playerChannel); nothing is asked of their ship.
        if (shipTarget.components.has(ControlledByComponent)) {
            const strings =
                await loadStrings(displayAssets, HAIL_RESPONSE_TABLE);
            return {
                context: {
                    variant: 'ship', heading, image,
                    body: channelOpenText(strings, hashString(shipTargetUuid)),
                    playerChannel: { hostile: iffHostile },
                },
                target: shipTargetUuid, isEscort: false,
                replies: ASSIST_REPLIES_FALLBACK,
            };
        }
        // A ship ANOTHER player owns (their escort, fighter, mission ship):
        // the simulation refuses every hail action against it (hail_plugin's
        // hailTargetBelongsToAnotherPlayer). Its offer button is still drawn
        // (ruling #297: always visible for a ship that communicates), and
        // the ship REFUSES in the well — "Sorry sir, I'm just an escort."
        // for an escort (#332), "I'd rather not." otherwise — rather than
        // promising help, or a truce, that never comes.
        //
        // THE SIMULATION'S OWN PREDICATE, with the peer the sim would stamp
        // on our hail record (our ship's controller), so the dialog cannot
        // refuse a ship the sim would let help — a server-owned one — or
        // promise help from one the sim refuses. Ruling #297: "as long as
        // it still works for players".
        const othersShip = hailTargetBelongsToAnotherPlayer(world, shipTarget,
            player.uuid,
            player.entity.components.get(ControlledByComponent)?.peerId);

        // Is this the player's own direct escort? (one parent hop) Carrier-bay
        // fighters ALSO have a parent link pointed at the player, so they'd
        // match here too — but they are NOT
        // hired escorts and have no management dialog. The discriminator is
        // SourceComponent: bay fighters set it (bay_plugin), hired escorts
        // (spawnHiredEscorts) and captures (convertToEscort) do not.
        // This reads the DISPLAY world, so SourceComponent has to be
        // serializer-registered (fire_weapon_plugin's build) to be here at
        // all — the bridge mirrors nothing else. Unregistered, this test
        // was always false and every bay fighter came back "Hired Escort:".
        // escortParent, not a fourth private copy of the parent chain: the
        // playtest bug where a captured prize "says it is my escort" but
        // took no orders was exactly these predicates disagreeing, so the
        // hail dialog asks the same question the command system does.
        const isOwnFlock = escortParent(shipTarget) === player.uuid;
        const isBayFighter = shipTarget.components.has(SourceComponent);
        const isEscort = isOwnFlock && !isBayFighter;

        if (isOwnFlock && isBayFighter) {
            // A carrier-launched fighter from the player's own bay: label it as
            // such (not "Hired Escort:") and show no management buttons — a bay
            // fighter has no salary, upgrade price, or resale value to manage.
            const fighterName = shipData?.name || 'Fighter';
            const fighterClass = shipData?.subtitle?.trim();
            return {
                context: {
                    variant: 'escort', image,
                    // The whole identity block goes in the LOWER well, the way
                    // hail_escort.png stacks "Hired Escort: / Terrapin /
                    // Standard" there. The UPPER well is the reference's
                    // Upgrade Cost / daily Pay readout, which has no backing
                    // state here (documented content gap) — so it stays empty
                    // rather than borrowing the identity lines.
                    heading: fighterClass
                        ? `Fighter:\n ${fighterName}\n ${fighterClass}`
                        : `Fighter:\n ${fighterName}`,
                    body: '',
                },
                target: shipTargetUuid, isEscort: false,
                replies: ASSIST_REPLIES_FALLBACK,
            };
        }

        if (isEscort) {
            // ESCORT MANAGEMENT BOX (hail/hail_escort.png for a hire,
            // hail/hail_captured_escort.png for a prize). The LOWER well
            // holds the identity block — "Hired Escort:" / "Captured
            // Escort:" over the escort's ship name and class subtitle,
            // indented exactly as the references indent them — and the
            // UPPER well holds the price readout the references put there
            // (escortReadout).
            //
            // Every figure comes off the escort's CURRENT ship class
            // through spaceport/escort_fees.ts, which is the same module
            // the simulation prices these actions with — so the dialog can
            // never quote a number applyEscortAction would disagree with,
            // and an escort that has just been upgraded reprices itself
            // with nothing else to update.
            const escortName = shipData?.name || 'Escort';
            const escortClass = shipData?.subtitle?.trim();
            const provenance = escortProvenance(shipTarget);
            const upgradeTo = shipData?.escortUpgradeShip ?? null;
            const upgradeCost = shipData ? escortUpgradeCost(shipData) : 0;
            // Is the target class one this player may be offered at all?
            // Its shïp Require / Availability gates are the player's
            // business wherever the hull comes from — see
            // escortUpgradeOffer, which reads them off the SAME context
            // the shipyard and the bar's hire pool read.
            const upgradeOffered = shipData
                ? await escortUpgradeOffer(upgradeTo, shipGateContext(
                    player.entity, {
                        currentShipData:
                            player.entity.components.get(ShipDataComponent),
                        getOutfit: id => gameData.data.Outfit.getCached(id),
                        getRank: id => gameData.data.Rank.getCached(id),
                        getCron: id => gameData.data.Cron.getCached(id),
                    }), gameData)
                : undefined;
            const escort: EscortManagement = {
                provenance,
                upgrade: upgradeOffered && upgradeTo !== null
                    ? {
                        toShip: upgradeTo, cost: upgradeCost,
                        canAfford: credits >= upgradeCost,
                    }
                    : undefined,
                // Only a CAPTURED hull is the player's to sell; a hired
                // pilot's ship never was (the reference greys the button).
                sell: shipData && provenance === 'captured'
                    ? { value: escortSellValue(shipData) } : undefined,
                // ...and only a HIRED pilot draws a wage. Priced off the
                // escort's CURRENT class even with an upgrade queued: it
                // is still flying that hull until the deal settles at a
                // shipyard, and it is paid for flying that hull.
                dailyFee: shipData && provenance === 'hired'
                    ? escortDailyFee(shipData) : undefined,
                // The deals already queued against this escort, read off
                // the same synced marker the simulation writes them to
                // (player_escort.ts) — so re-opening the channel, or
                // opening it on another peer, shows the same box.
                queuedDeal: queuedDealKind(escortDealOf(shipTarget)),
            };
            const label = provenance === 'captured'
                ? 'Captured Escort:' : 'Hired Escort:';
            return {
                context: {
                    variant: 'escort', image,
                    heading: escortClass
                        ? `${label}\n ${escortName}\n ${escortClass}`
                        : `${label}\n ${escortName}`,
                    body: escortReadout(escort),
                    escort,
                },
                target: shipTargetUuid, isEscort: true,
                replies: ASSIST_REPLIES_FALLBACK,
            };
        }

        // The stock ship-comm table (STR# 3000), loaded ONCE for this hail:
        // the opening line, the hostile answer, the assistance replies and
        // the bribe-accepted line all come out of it, all seeded by the same
        // uuid hash so the whole conversation is stable per encounter and
        // identical on every peer.
        const shipStrings =
            await loadStrings(displayAssets, HAIL_RESPONSE_TABLE);
        const shipSeed = hashString(shipTargetUuid);
        // SOMEONE ELSE'S ESCORT — an NPC flagship's fleet escort, another
        // player's hired or captured escort — answers every request with
        // "Sorry sir, I'm just an escort." (ruling #332's screenshot of the
        // original) and does nothing; applyHail refuses it the same way.
        const escortLine = isSomeoneElsesEscort(shipTarget, player.uuid)
            ? justAnEscortText(shipStrings, shipSeed) : undefined;

        const response = shipHailResponse(govt, iffHostile, aiType, shipData);
        if (response.kind === 'cantHail') {
            // NO CHANNEL AT ALL (ruling #297: "Some ships don't respond to
            // hails at all (no hailing channel appears), like the krypt pod
            // and wraith"). undefined with a ship targeted is the plugin's
            // cue to print the ship no-response line on the status line
            // instead — see shipNoResponseLine / openHail.
            return undefined;
        }
        if (response.kind === 'hostile') {
            // The ship's price (hail.ts's shipBribePrice, reference "R7
            // bribe price, wave 22"), named in the fuel sale's words: the
            // ship's mood line ("I'm in a bad mood today, so it's going to
            // cost extra.") and "Pay me N credits.".
            // The channel's FIRST ask: each further plea on it asks 1,000
            // more (mercyOffer; reference "R7 a provoked freighter's Lower
            // Price, wave 32"). Drawn PER HAIL with the mood line below
            // (reference "R7 a ship's Beg For Mercy haggle, wave 33",
            // finding 2: one warship asked 3,000 to 20,000 over seven
            // hails, each with its own mood), so the channel seeds both,
            // as it does applyHail's charge.
            const firstAsk = shipBribePrice(shipTargetUuid, player.uuid,
                credits, !!govt?.flags.largerBribes, channel);
            const priced = response.canBribe && !othersShip;
            const miscStrings = priced
                ? await loadStrings(displayAssets, MISC_STRING_TABLE)
                : undefined;
            const mercy: MercyLines | undefined = priced
                ? {
                    firstAsk,
                    offer: fuelSaleMoodText(shipStrings,
                        fuelSaleTerms(shipTargetUuid, channel).mood,
                        hashString(`${shipTargetUuid}:mood:${channel}`)),
                    // What they say once the demand is PAID (STR# 3000
                    // 135-139). Resolved here because the Pay handler is
                    // synchronous, exactly like the assistance replies.
                    accepted: mercyAcceptedText(shipStrings, shipSeed),
                    // Lower Price's withdrawal (STR# 3000 150-154: "Ha ha
                    // ha! This will be your last mistake!", "Die,
                    // cheapskate!", ...), ONE line per hail (reference "R7
                    // a provoked freighter's Lower Price, wave 32",
                    // finding 4: the same line all channel long, another
                    // on the next): seeded by the ship and the channel.
                    withdrawn: mercyLoweredText(shipStrings,
                        hashString(`${shipTargetUuid}:mercy:${channel}`)),
                    miscStrings,
                }
                : undefined;
            const bribe = mercy
                ? mercyOffer(mercy, NO_MERCY_HAGGLE, credits) : undefined;
            // BEG FOR MERCY IS OFFERED TO EVERY IFF-HOSTILE SHIP whose govt
            // has not disabled it (Flags2 0x0001): one that will not be
            // bought answers the plea with a flat refusal (STR# 3000 95-99)
            // instead of a price, and keeps fighting. A ship another player
            // owns can strike no deal (applyHail refuses it), so it refuses
            // too — "just an escort" when it is one.
            const mercyRefused = response.canBeg && (!response.canBribe
                || othersShip)
                ? (othersShip ? escortLine : undefined)
                    ?? mercyRefusedText(shipStrings, shipSeed)
                : undefined;
            // A hostile ship answers from the GLOBAL hostile group (STR# 3000
            // 10-14, "What is it?" on hail/hail_hostile.png) INSTEAD of the
            // channel-open line a friendly ship opens with — that is what
            // hail/hail_hostile.png shows in the response well — and not from
            // its government's greetings, which are friendly lines only. A
            // përs still speaks their own CommQuote.
            return {
                context: {
                    variant: 'ship', heading, image,
                    body: pers?.commQuote?.trim() ? pers.commQuote
                        : hostileResponseText(shipStrings, shipSeed),
                    bribe, mercyRefused,
                },
                target: shipTargetUuid, isEscort: false,
                replies: mercy ? { ...ASSIST_REPLIES_FALLBACK, mercy }
                    : ASSIST_REPLIES_FALLBACK,
            };
        }
        // OPENING THE CHANNEL IS NOT A GREETING. hail/hail.png shows a
        // freshly hailed ship answering "Channel open." (STR# 3000 0-4) with
        // Greetings still unpressed; hail/greetings.png is the same frame
        // after the button. So the body opens with the channel-open line and
        // the greeting is held in reserve for the button — the planet dialog
        // below has always worked this way through STR# 3002's own group.
        const body = channelOpenText(shipStrings, shipSeed);
        // The Greetings answer: a përs quote, else a real line from the
        // govt's greeting STR#, else the stock generic group (STR# 3000
        // 45-49 — "Greetings." is what the govt-less Terrapin on
        // greetings.png says), all picked deterministically by the target's
        // uuid so the line is stable per encounter and across peers. A
        // non-talkative govt yields '' and gets no Greetings answer at all,
        // leaving the channel-open line in place.
        //
        // RUDE, NOT HOSTILE (ruling #297): a ship whose GOVERNMENT is
        // unfriendly to the player but which is not IFF-hostile — a pirate
        // the player has bought off, a warship of a government whose record
        // the player has ruined that has not opened fire — answers Greetings
        // with the original's curt group (STR# 3000 10-14, "What do you
        // want?") instead of its government's friendly greetings, seeded
        // like every other line. A përs still speaks their own CommQuote, and
        // a non-talkative govt still says nothing.
        const rude = disposition === 'hostile' && response.talkative
            && !pers?.commQuote?.trim();
        const greeting = (rude ? rudeGreetingText(shipStrings, shipSeed)
            : greetingText({
                persCommQuote: pers?.commQuote,
                govtGreetings: govt?.commGreetings,
                genericGreetings: genericGreetings(shipStrings),
                govtCommName: govt?.commName,
                talkative: response.talkative,
                seed: shipSeed,
            })) || undefined;
        // ränk 0x0400 / 0x0800 for the hailed ship's OWN government
        // (rank_logic.ts): always-assist and free repair. Read off the same
        // synced ActiveRanksComponent the simulation reads, so the dialog and
        // applyHail cannot disagree about whether the button is offered.
        const hailRanks = player.entity.components.get(ActiveRanksComponent);
        const getHailRank = (id: string) =>
            gameData.data.Rank.getCached(id);
        const rankAlwaysAssists = ranksAllowAssistance(
            hailRanks, getHailRank, govt?.id);
        // THE BUTTON IS ALWAYS THERE for a ship that communicates (ruling
        // #297: "They just refuse to help you or make you pay") — only a
        // Flags2 0x0001 govt (the Dechtakar) has none. Whether the ship
        // HELPS is the answer's business, below.
        // ränk 0x0800 REFUELS for free and does not repair (reference
        // "P1 / H1 wave 18"), so free help depends on the need; and the
        // ships of the affiliated govt's ALLIES refuel too ("H1 wave 19",
        // finding 5), so each such rank's affiliated govt is loaded for
        // the alliance test (the simulation reads the same gövts off
        // GovtsResource).
        const freeFuelAffils = new Map<string, GovtData | undefined>();
        for (const id of hailRanks ?? []) {
            const rank = getHailRank(id);
            if (rank?.rankFlags.freeRefuelAndRepair && rank.affilGovt
                && !freeFuelAffils.has(rank.affilGovt)) {
                freeFuelAffils.set(rank.affilGovt, await gameData.data.Govt
                    .get(rank.affilGovt).catch(() => undefined));
            }
        }
        const rankFree = ranksGiveFreeFuel(hailRanks, getHailRank, govt?.id,
            affil => {
                const affilGovt = freeFuelAffils.get(affil);
                return !!affilGovt && !!govt
                    && alliedEitherWay(affilGovt, govt);
            });
        const freeRepair = assistIsFree(govt, rankFree, 'disabled');
        const freeFuel = assistIsFree(govt, rankFree, 'fuel');
        // The caption says "(free)" when what the player needs right now
        // (read as the channel opens) would be free.
        const assist = canRequestAssistance({
            govt, iffHostile, ship: shipData, rankAlwaysAssists,
        }) ? {
            free: playerNeed(player) === 'fuel' ? freeFuel : freeRepair,
        } : undefined;
        // The answer depends on WHAT the player needs (a non-hostile ship
        // refuses a repair and sells fuel, reference H1 waves 16 and 17),
        // which is read at the press; both answers are resolved here.
        const willingness = assistWillingness({
            disposition, govt, aiType, rankAlwaysAssists, free: freeRepair,
            need: 'disabled',
        });
        const fuelWillingness = assistWillingness({
            disposition, govt, aiType, rankAlwaysAssists, free: freeFuel,
            need: 'fuel',
        });
        const miscStrings = fuelWillingness === 'sellFuel'
            ? await loadStrings(displayAssets, MISC_STRING_TABLE) : undefined;
        // The OFFER is not withdrawn for a ship that happens to be fighting,
        // nor for a player whose ship is in perfect shape, NOR ONCE IT HAS
        // BEEN USED (hail/request_assistance.png still shows the button after
        // the ship has answered "You're not in any trouble."): they ask, and
        // the ship answers with a line from the response table ("I'm busy" /
        // "You're not in any trouble." / "All right, I'll help you."). Only
        // the lines are resolved here — the press decides which is used.
        const replies: AssistReplies = {
            ...resolveAssistReplies(shipStrings, shipSeed),
            ...(escortLine !== undefined ? { escort: escortLine } : {}),
            // A ship another player owns can do nothing for us (applyHail
            // refuses it); an unfriendly government's ship that takes no
            // bribes will not.
            ...(othersShip || willingness === 'unwilling'
                ? { unwilling: assistRefusedText(shipStrings, shipSeed) }
                : willingness === 'forPay'
                    ? { forPay: assistForPayText(shipStrings, shipSeed) }
                    : {}),
            ...(!othersShip && willingness === 'refuse'
                ? { refusal: disabledRefusalText(shipStrings, shipSeed) }
                : {}),
            // A ränk 0x0800's free fuel: "Okay, I'm on my way." at once.
            // (A Roadside Assistance govt keeps the granted line: its
            // answer was never measured.)
            ...(!othersShip && rankFree && fuelWillingness === 'willing'
                ? { freeFuel: assistPaidText(shipStrings, shipSeed) }
                : {}),
            ...(!othersShip && fuelWillingness === 'sellFuel'
                ? {
                    fuelSale: {
                        // The ship's own mood, the same for every ask
                        // (reference H1 wave 17, finding 2).
                        mood: fuelSaleMoodText(shipStrings,
                            fuelSaleTerms(shipTargetUuid).mood, shipSeed),
                        withdrawn: fuelOfferWithdrawnText(shipStrings,
                            shipSeed),
                        accepted: assistPaidText(shipStrings, shipSeed),
                        cantAfford: cantAffordText(shipStrings, shipSeed),
                        miscStrings,
                    },
                }
                : {}),
        };
        // The price of an unfriendly ship's help, on the haggle page its
        // answer opens: the SAME demand a mercy plea costs (GUESS:
        // shipBribePrice), which applyHail re-derives when Pay arrives.
        const amount = shipBribePrice(shipTargetUuid, player.uuid, credits,
            !!govt?.flags.largerBribes);
        const bribe = assist && replies.forPay !== undefined
            && replies.escort === undefined
            ? {
                amount, canAfford: credits >= amount && amount > 0,
                purpose: 'assist' as const,
                offer: replies.forPay,
                accepted: assistPaidText(shipStrings, shipSeed),
            }
            : undefined;
        return {
            context: {
                variant: 'ship', heading, image, body, greeting, assist,
                ...(bribe ? { bribe } : {}),
            },
            target: shipTargetUuid, isEscort: false, replies,
        };
    }

    // No ship targeted: try the selected planet.
    const planetTargetUuid =
        player.entity.components.get(PlanetTargetComponent)?.target;
    const planetTarget = planetTargetUuid
        ? world.entities.get(planetTargetUuid) : undefined;
    if (planetTargetUuid && planetTarget) {
        const planetData = planetTarget.components.get(PlanetDataComponent);
        const planetId = planetTarget.components.get(PlanetComponent)?.id;
        const govt = planetData?.govt
            ? await gameData.data.Govt.get(planetData.govt).catch(() => undefined)
            : undefined;
        // "; comment" resource-name suffixes are authoring notes, hidden.
        const name = displayName(planetData?.name ?? '') || 'Spaceport';
        // The well shows the stellar's OWN SPRITE, as it is drawn in space,
        // on the frame's starfield (hail/hail_planet.png: Earth and its
        // ring) — not the spöb's landscape PICT, which is the spaceport's.
        const stellarSprite = planetData?.animation.images.baseImage;
        const isStation = planetData?.flags.isStation ?? false;
        // A stellar that is not a PORT — unlandable (Jupiter, a wrecked
        // gate) or flagged uninhabited, which the Bible glosses as "no
        // traffic control or refuelling" — has nobody listening, so the
        // original never opens a channel to one. Refuse here — the plugin
        // turns this undefined into the status line's "No response." and a
        // can't-do beep (see hailIsUnanswerable) — rather than opening a
        // comm dialog just to deny a landing that was never on offer.
        // Every working gate answers nothing either, usable or not: "No
        // response." and no comm (gateRefusesHail; reference waves 23 and
        // 24).
        if (planetData
            && (!isPort(planetData.flags) || gateRefusesHail(planetData))) {
            return undefined;
        }
        // Always true past that gate (a port is landable by definition), but
        // still read off the SAME landable() predicate the radar blip and the
        // landing gate use, so planetDisposition below can never drift from
        // them.
        const isLandable = planetData ? landable(planetData) : true;

        // THE SAME clearance verdict the landing gate and the radar blip use
        // (stellar_clearance.ts), read off the same delta-synced components
        // the simulation reads, so the dialog can never offer a bribe for a
        // landing that was already allowed — or promise clearance the gate
        // will refuse a second later.
        const clearance: StellarClearance =
            planetData && planetId !== undefined
                ? playerStellarClearance(world, player.entity, gameData,
                    planetData, planetId)
                : { cleared: true as const };
        // A port that is refusing you and whose government bargains (gövt
        // 0x4000 / 0x8000) offers the deal in the middle button slot, the way
        // a hostile ship offers Beg For Mercy. Price and affordability are the
        // same pure functions the simulation re-derives in applyHail, so the
        // dialog never shows a number the sim would disagree with.
        // The price is hail.ts's planetBribePrice (reference "R7 bribe
        // price, wave 22"), demanded as "Pay us N credits.".
        const stellarStrings = await loadStrings(displayAssets,
            STELLAR_RESPONSE_TABLE);
        const miscStrings = await loadStrings(displayAssets, MISC_STRING_TABLE);
        const bargains = !clearance.cleared && planetTakesBribes(govt);
        // An ordinary planet sometimes turns Offer Bribe down flat (hail.ts's
        // planetRefusesBribe; reference "R7 bribe price above 1M, wave 27":
        // "Yeah, right." at 2M, "You wish." at 100M), drawn once per system
        // visit (the pilot's SystemVisit ordinal; reference "R7 planet
        // bribe withdrawal, wave 30": a fresh refusal held through re-hails
        // and a landing a day later), and every planet
        // refuses until the pilot leaves the system once a Lower Price has
        // made it withdraw (reference "R7 planet bribe withdrawal, wave
        // 29"), both answered from STR# 3002 45-49. The button is offered
        // all the same and answers the refusal in the well, as a ship's Beg
        // For Mercy that will not be bought does; applyHail draws the same
        // verdict and charges nothing.
        const haggle = planetId !== undefined
            ? laterStellarHaggle(localStellarHaggle?.get(planetId),
                stellarHaggleOf(player.entity, planetId))
            : laterStellarHaggle(undefined, undefined);
        const refuses = bargains && planetBribeRefused(planetTargetUuid,
            player.uuid, !!govt?.flags.largerBribes, haggle,
            player.entity.components.get(SystemVisitComponent));
        const canBribe = bargains && !refuses;
        const seed = hashString(planetTargetUuid);
        // A line per hail of the day, like the original's eleven (all five
        // lines of the group): seeded by the planet and the clock.
        const refusedLine = stellarBribeDeclinedText(stellarStrings,
            hashString(`${planetTargetUuid}:${world.resources
                .get(SimulationTimeResource)?.time ?? 0}`));
        const planetBribe: PlanetBribeLines | undefined =
            canBribe && planetId !== undefined
                ? {
                    planetId,
                    price: planetBribePrice(planetTargetUuid, player.uuid,
                        credits, !!govt?.flags.largerBribes),
                    withdrawn: stellarBribeRefusedText(stellarStrings, seed),
                    refused: refusedLine,
                    miscStrings,
                }
                : undefined;
        const mercyRefused = refuses ? refusedLine : undefined;
        const bribe = planetBribe
            ? planetBribeOffer(planetBribe, haggle, credits)
            : undefined;
        // "Channel open to Earth." — the reference's own opening line
        // (hail/hail_planet.png), from STR# 3002's channel-open group with the
        // stellar's name appended to the group's trailing space.
        const opening =
            `${stellarChannelOpenText(stellarStrings, seed)}${name}.`;
        const answer = clearance.cleared
            ? miscString(miscStrings,
                isStation ? CLEARED_TO_DOCK_INDEX : CLEARED_TO_LAND_INDEX,
                isStation ? 'You are cleared to dock.'
                    : 'You are cleared to land.')
            : bargains
                ? stellarBribeOfferText(stellarStrings, seed)
                // A shut port that won't be bought says so in its own words
                // (STR# 3002 30-34) after traffic control's flat refusal.
                : `${miscString(miscStrings,
                    isStation ? DOCKING_DENIED_INDEX : LANDING_DENIED_INDEX,
                    isStation ? 'Docking request denied.'
                        : 'Landing request denied.')} `
                + `${stellarBribeRefusedText(stellarStrings, seed)}`;

        // The lower well names the stellar, then gives its class in grey
        // (STR# 1100 by spöb Type: hail/hail_planet.png's "Earth" /
        // "[Earth/Luna System]" — the stellar's type caption, NOT its
        // system, which for Earth is Sol), and — when it is refusing you —
        // states WHY in the original's own vocabulary: "Forbidden" (STR# 2002
        // index 172) for a shut port or a missing travel permit, "Hostile"
        // (173) for a legal record below its MinStatus. identityRuns paints a
        // "Status:" line red, exactly as it does for a hostile ship.
        // `isLandable` is always true here (the non-port case returned
        // above); it is still threaded through the SAME planetDisposition the
        // radar blip reads so the two can never drift apart.
        //
        // MEASURED (reference "Stellar hail graphic, wave 23"): a refusing
        // planet and a refusing station both print "Status: Hostile" in red
        // on a third line, under the class caption, with no "(System)" line.
        // The 'forbidden' wording is still unmeasured.
        const status = planetDisposition(clearance, isLandable);
        const identity = [name, planetData?.typeDescription ?? '']
            .filter(line => line !== '');
        const clearanceStatus = status !== 'neutral' && status !== 'unlandable'
            ? `Status: ${miscString(miscStrings,
                status === 'hostile'
                    ? STELLAR_STATUS_HOSTILE_INDEX
                    : STELLAR_STATUS_FORBIDDEN_INDEX,
                status === 'hostile' ? 'Hostile' : 'Forbidden')}`
            : undefined;
        // DEMAND TRIBUTE (#353): every stellar that opens a channel takes a
        // demand (Matthew's ruling: "Any planet that can be hailed and
        // responds to hails ... can be dominated"). One the pilot
        // dominates reads Release instead, and "Status: Dominated"; one
        // whose defence fleet is up against him, "Status: Hostile".
        const tributeLines: TributeLines | undefined =
            planetData && planetId !== undefined
                && stellarTakesDemands(planetData)
                ? {
                    planetUuid: planetTargetUuid, planetId, isStation,
                    hasFleet: planetData.defense !== null,
                    stellarStrings, identity,
                    ...(clearanceStatus !== undefined
                        ? { clearanceStatus } : {}),
                    hostileWord: miscString(miscStrings,
                        STELLAR_STATUS_HOSTILE_INDEX, 'Hostile'),
                    dominatedWord: miscString(miscStrings,
                        STELLAR_STATUS_DOMINATED_INDEX,
                        STELLAR_STATUS_DOMINATED_WORD),
                }
                : undefined;
        const dominated = planetId !== undefined
            && hasDominated(player.entity, planetId);
        const heading = tributeLines
            ? tributeHeading(tributeLines, dominated ? 'dominated'
                : stellarHostileTo(planetTarget, player.uuid)
                    ? 'hostile' : undefined)
            : [...identity, ...(clearanceStatus ? [clearanceStatus] : [])]
                .join('\n');

        return {
            context: {
                variant: 'planet', heading, image: null, stellarSprite,
                body: `${opening}\n${answer}`, bribe,
                ...(mercyRefused !== undefined ? { mercyRefused } : {}),
                ...(tributeLines ? {
                    tribute: { kind: dominated ? 'release' : 'demand' },
                } : {}),
            },
            target: planetTargetUuid, isEscort: false,
            replies: planetBribe || tributeLines ? {
                ...ASSIST_REPLIES_FALLBACK,
                ...(planetBribe ? { planetBribe } : {}),
                ...(tributeLines ? { tribute: tributeLines } : {}),
            } : ASSIST_REPLIES_FALLBACK,
        };
    }

    return undefined;
}

export const HailDialogPlugin: Plugin = {
    name: 'HailDialogPlugin',
    build(world) {
        const simulationData = world.resources.get(SimulationGameDataResource);
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        const controls = world.resources.get(ControlsSubject);
        const stage = world.resources.get(Stage);
        const screenSize = world.resources.get(ScreenSize);
        if (!simulationData || !displayAssets || !controls || !stage
            || !screenSize) {
            throw new Error('HailDialogPlugin missing a required resource');
        }

        let currentTarget: string | undefined;
        let currentReplies = ASSIST_REPLIES_FALLBACK;
        // The escort offer the OPEN channel was computed with. Kept beside
        // `currentTarget` for the same reason `currentReplies` is: the
        // button handlers are synchronous, so what the box drew has to be
        // remembered rather than re-derived on the press. It is only ever
        // used to name the upgrade's target CLASS — every figure is
        // recomputed sim-side (escort_action.ts).
        let currentEscort: EscortManagement | undefined;
        // What the open channel's haggle page is selling (mercy, landing
        // clearance or help), so Pay sends the matching record.
        let currentBribePurpose: 'mercy' | 'landing' | 'assist' | 'fuel'
            | undefined;
        // Each ship's haggle as this dialog's own presses left it, which
        // the mirrored FuelHaggle entry may not show yet (the record is
        // applied a tick or more later), so a counter or a re-ask at once
        // still quotes the price the simulation will charge.
        // Display-local; the sim is the authority.
        const localHaggle = new Map<string, FuelHaggleState>();
        /** This ship's haggle: the further-along of ours and the sim's. */
        const haggleWith = (target: string, playerUuid: string) =>
            laterFuelHaggle(localHaggle.get(target),
                fuelHaggleOf(world, target, playerUuid));
        // The same for a planet's bribe (by NOVA id): a counter or a
        // withdrawal this dialog has shown before the simulation mirrors
        // it. Display-local; the sim is the authority.
        const localStellarHaggle = new Map<string, StellarHaggleState>();
        // THE CHANNEL (reference "R7 a provoked freighter's Lower Price,
        // wave 32"): one opening of this dialog, from the hail to its
        // close. Named by the mirrored sim clock at the hail, kept
        // increasing (a hail on a paused clock is still a new channel),
        // and sent with a mercy plea's records so the simulation starts
        // each channel's haggle afresh. The open channel's mercy haggle is
        // this dialog's own (the simulation follows it record by record).
        let currentChannel = 0;
        let lastChannel = -1;
        let mercyHaggle: MercyHaggleState = NO_MERCY_HAGGLE;
        const dialog = new HailDialog(displayAssets, controls, {
            requestAssistance: () => {
                // ONE call decides and answers: the ship's line comes back
                // whether it accepted or refused, and only an acceptance
                // dispatches. A refusal (busy, or a player who needs nothing)
                // leaves the ship's behavior completely untouched.
                const answer = assistAnswer(world, currentTarget,
                    currentReplies,
                    currentTarget ? localHaggle.get(currentTarget)
                        : undefined);
                if (answer.dispatch && currentTarget) {
                    world.emit(HailRequestEvent, {
                        action: {
                            kind: 'requestAssistance', target: currentTarget,
                        },
                    });
                }
                if (answer.offer) {
                    currentBribePurpose = answer.offer.purpose;
                }
                return {
                    answer: answer.line, haggle: answer.haggle,
                    ...(answer.offer ? { offer: answer.offer } : {}),
                };
            },
            bribe: () => {
                if (!currentTarget) {
                    return;
                }
                // Paying for HELP (an unfriendly ship's price, ruling #297;
                // a ship's fuel, reference H1 waves 16 and 17) is the
                // assistance request itself: applyHail charges it.
                // (The haggle that payment ends is left to the simulation
                // to mirror back: a payment it refuses must not move the
                // dialog's quote ahead of what it will charge.)
                //
                // A planet's haggle lasts the system visit (reference "R7
                // planet bribe withdrawal, wave 29"), landings included, and
                // so does this display world's local copy of it: our own
                // counter must not outlive the payment that ends it, or a
                // later offer, once the bought clearance lapses, would quote
                // a counter the simulation has dropped. Without it the
                // quote is the mirrored entry: none after the payment, or
                // still the counter if the payment was refused (its record
                // lands after the Lower Price's).
                const paidPlanet = currentReplies.planetBribe;
                if (currentBribePurpose === 'landing' && paidPlanet) {
                    localStellarHaggle.delete(paidPlanet.planetId);
                }
                // A paid MERCY price makes the ship non-hostile in the open
                // channel at once (reference "A paid ship bribe (A8), wave
                // 37": the Status line gone, Request Assistance in Beg For
                // Mercy's slot). The page itself already shows it
                // (hail_dialog's boughtOffContext); once the payment has
                // reached the simulation, the channel is re-derived from it.
                if (currentBribePurpose === 'mercy'
                    && currentReplies.mercy !== undefined) {
                    void refreshBoughtOffChannel(currentTarget,
                        currentChannel);
                }
                world.emit(HailRequestEvent, {
                    action: currentBribePurpose === 'assist'
                        || currentBribePurpose === 'fuel'
                        ? { kind: 'requestAssistance', target: currentTarget }
                        : currentBribePurpose === 'mercy'
                            ? { kind: 'bribe', target: currentTarget,
                                channel: currentChannel }
                            : { kind: 'bribe', target: currentTarget },
                });
            },
            // Lower Price on a ship's fuel price (reference H1 wave 17): a
            // 3/4 counter, returned for the popup, or a withdrawal — the
            // same pure draw applyHail makes from the record.
            lowerPrice: () => {
                const target = currentTarget;
                const player = getPlayerShip(world);
                const sale = currentReplies.fuelSale;
                if (!target || !player) {
                    return {};
                }
                const credits = () => player.entity.components
                    .get(CreditsComponent)?.credits ?? 0;
                // A hostile ship's BEG FOR MERCY price (reference "R7 a
                // provoked freighter's Lower Price, wave 32"): a 3/4
                // counter or a withdrawal, whose next plea on this channel
                // asks 1,000 more — the same pure draw applyHail makes
                // from the record, which names the channel.
                const mercy = currentReplies.mercy;
                if (currentBribePurpose === 'mercy' && mercy) {
                    const lowered = lowerMercyPrice(mercyHaggle, target,
                        player.uuid, currentChannel);
                    mercyHaggle = lowered.haggle;
                    world.emit(HailRequestEvent, {
                        action: { kind: 'lowerPrice', target,
                            channel: currentChannel },
                    });
                    const offer = mercyOffer(mercy, lowered.haggle,
                        credits());
                    return lowered.outcome === 'counter'
                        ? { counter: offer } : { next: offer };
                }
                // A PLANET's bribe (reference "R7 planet bribe, wave 28"):
                // a 3/4 counter or a withdrawal, the same pure draw
                // applyHail makes from the record.
                const planet = currentReplies.planetBribe;
                if (currentBribePurpose === 'landing' && planet) {
                    const day = bribeDay(player.entity.components
                        .get(GameDateComponent));
                    const lowered = lowerPlanetBribe(laterStellarHaggle(
                        localStellarHaggle.get(planet.planetId),
                        stellarHaggleOf(player.entity, planet.planetId)),
                        target, player.uuid, day);
                    localStellarHaggle.set(planet.planetId, lowered.haggle);
                    world.emit(HailRequestEvent, {
                        action: { kind: 'lowerPrice', target },
                    });
                    return lowered.outcome === 'counter'
                        ? { counter: planetBribeOffer(planet, lowered.haggle,
                            credits()) }
                        : {};
                }
                const lowered = lowerFuelPrice(
                    haggleWith(target, player.uuid), target, player.uuid);
                localHaggle.set(target, lowered.haggle);
                world.emit(HailRequestEvent, {
                    action: { kind: 'lowerPrice', target },
                });
                return lowered.outcome === 'counter' && sale
                    ? { counter: fuelOffer(world, target, sale,
                        lowered.haggle) }
                    : {};
            },
            // A press in a channel to another PLAYER (#332): the button goes
            // to their status line as a record — the sim notes it on OUR
            // ship and their client prints it — and our well says it went.
            messagePlayer: (message: PlayerHailMessage) => {
                if (currentTarget) {
                    world.emit(HailRequestEvent, {
                        action: {
                            kind: 'message', target: currentTarget, message,
                        },
                    });
                }
                return PLAYER_HAIL_SENT_TEXT;
            },
            // The escort box's management functions. Each becomes one
            // EscortActionEvent naming the escort; QUEUEING AN UPGRADE also
            // names the class the box priced, which the simulation checks
            // against the escort's own shïp UpgradeTo — so this can only
            // ever confirm what the escort already says — and then STORES,
            // so the settlement at lift-off can tell a stale deal from a
            // live one (spaceport/escort_deals.ts).
            //
            // The dialog has already decided queue-versus-cancel from its
            // own live context (hail_dialog's escortPressAction); this end
            // only re-checks that a QUEUE has something to queue, which is
            // belt and braces against a keyboard route or a stale context
            // — never the only guard. A CANCEL is never refused here for
            // the same reason the sim never refuses one: un-queueing must
            // always work.
            escortAction: (action: EscortPressAction) => {
                const target = currentTarget;
                const escort = currentEscort;
                if (!target || !escort) {
                    return;
                }
                let record: EscortAction | undefined;
                switch (action) {
                    case 'release':
                        record = { kind: 'releaseEscort', target };
                        break;
                    case 'cancelUpgrade':
                        record = { kind: 'cancelUpgrade', target };
                        break;
                    case 'cancelSale':
                        record = { kind: 'cancelSale', target };
                        break;
                    case 'queueSale':
                        if (escort.sell) {
                            record = { kind: 'queueSale', target };
                        }
                        break;
                    case 'queueUpgrade':
                        if (escort.upgrade) {
                            record = {
                                kind: 'queueUpgrade', target,
                                toShip: escort.upgrade.toShip,
                            };
                        }
                        break;
                }
                if (record) {
                    world.emit(EscortActionEvent, { action: record });
                }
            },
            // Demand Tribute / Release at a stellar (#353): the stellar's
            // answer from the same pure verdict the simulation applies
            // (tributePressAnswer), and the record (a laugh's too: it
            // costs record).
            tribute: (kind: 'demand' | 'release') => {
                const lines = currentReplies.tribute;
                if (!lines) {
                    return { answer: '', heading: '', next: kind };
                }
                const rating = getPlayerShip(world)?.entity.components
                    .get(CombatRatingComponent)?.kills ?? 0;
                const seed = hashString(`${lines.planetUuid}:${world.resources
                    .get(SimulationTimeResource)?.time ?? 0}`);
                const { record, ...answer } = tributePressAnswer(lines, kind,
                    rating, seed);
                if (record) {
                    world.emit(HailRequestEvent, {
                        action: { kind: record, target: lines.planetUuid },
                    });
                }
                return answer;
            },
            // Local client UI beep through the shared display audio path
            // (SoundEvent → SoundSystem); no simulation involvement.
            playSound: (id: string) => world.emit(SoundEvent, { id }),
        });
        stage.addChild(dialog.container);
        // Centred on the live UI size, and kept there through resizes
        // while open (CentredUiResource).
        keepCentred(world, dialog.container);
        world.resources.set(HailDialogResource, dialog);
        if (typeof window !== 'undefined') {
            window.novaHailDialog = dialog;
        }

        /**
         * The refusal an unanswerable hail gets instead of a comm dialog:
         * the original's own "No response." on the bottom-left status line
         * (STR# 2002 index 52), plus the can't-do beep every other blocked
         * action uses (blocked landings and boardings — status_message_plugin).
         * Both are client-local display effects; nothing reaches the sim.
         */
        const refuseHail = async (): Promise<void> => {
            const miscStrings =
                await loadStrings(displayAssets, MISC_STRING_TABLE);
            showStatusMessage(world, miscString(miscStrings, NO_RESPONSE_INDEX,
                NO_RESPONSE_FALLBACK));
            playUiSound(world, { id: BEEP_CANT_DO });
        };

        /**
         * The refusal a SILENT SHIP gets (ruling #297 — the krypt pod, the
         * wraith: "no hailing channel appears"): the ship-comm table's own
         * no-response line (STR# 3000 5-9, seeded by the ship's uuid like
         * every other comm line) on the status line, plus the can't-do beep.
         * Client-local; nothing reaches the sim.
         */
        const refuseShipHail = async (shipUuid: string): Promise<void> => {
            const shipStrings =
                await loadStrings(displayAssets, HAIL_RESPONSE_TABLE);
            showStatusMessage(world,
                shipNoResponseText(shipStrings, hashString(shipUuid)));
            playUiSound(world, { id: BEEP_CANT_DO });
        };

        let opening = false;
        const openHail = async (): Promise<void> => {
            if (dialog.container.visible || opening) {
                return;
            }
            opening = true;
            try {
                // Hail whatever the keys pressed before 'y' selected: a
                // number key or 'r' just ahead of it has not reached this
                // world yet, and the dialog would name the previous
                // target while the status bar, a frame later, named the
                // new one (afterSimulationFrames).
                await afterSimulationFrames(world);
                if (dialog.container.visible || MenuControls.focused) {
                    return;
                }
                // Nobody is home on a dead moon, nor on a disabled ship: no
                // channel opens at all, just "No response." (STR# 2002 #52).
                if (hailIsUnanswerable(world)
                    || hailTargetIsDisabled(world)) {
                    await refuseHail();
                    return;
                }
                // A përs with a mission for you answers with the MISSION
                // rather than with small talk — Matthew: "accepted by
                // hailing the ship, which pops up a mission dialog box
                // instead of the normal hailing box". The comm dialog is
                // not opened at all in that case; see
                // display/ship_mission_offer_plugin.ts. Everything else
                // about the hail (unanswerable stellars above, the
                // escort/bribe/assist paths below) is untouched.
                const shipTarget = getPlayerShip(world)?.entity
                    .components.get(TargetComponent)?.target;
                if (shipTarget && world.entities.has(shipTarget)
                    && await presentShipOffer(world, shipTarget, 'hail')) {
                    return;
                }
                const channel = Math.max(lastChannel + 1, Math.floor(
                    world.resources.get(SimulationTimeResource)?.time ?? 0));
                const computed = await computeContext(world, simulationData,
                    displayAssets, localStellarHaggle, channel);
                if (!computed) {
                    // A targeted ship with no context is one that does not
                    // answer at all (computeContext's cantHail case).
                    if (shipTarget && world.entities.has(shipTarget)) {
                        await refuseShipHail(shipTarget);
                    }
                    return;
                }
                currentTarget = computed.target;
                currentReplies = computed.replies;
                currentChannel = lastChannel = channel;
                mercyHaggle = NO_MERCY_HAGGLE;
                currentEscort = computed.context.escort;
                currentBribePurpose = computed.context.bribe?.purpose;
                // Re-add to move above later-added containers (spaceport).
                stage.addChild(dialog.container);
                await dialog.show(computed.context);
            } finally {
                opening = false;
            }
        };

        /**
         * Re-derives an open ship channel after its mercy price was paid,
         * once the simulation shows the ship bought off (applyHail's
         * pacifiedFrom, mirrored back; the IFF the identity block reads
         * then says neutral). Up to BOUGHT_OFF_REFRESH_TRIES waits of two
         * simulation frames; if the channel was closed or retargeted, or
         * the payment was refused, the page stays as the press left it.
         */
        const refreshBoughtOffChannel = async (target: string | undefined,
            channel: number): Promise<void> => {
            for (let i = 0; i < BOUGHT_OFF_REFRESH_TRIES; i++) {
                await afterSimulationFrames(world);
                if (!dialog.container.visible || currentTarget !== target
                    || currentChannel !== channel) {
                    return;
                }
                const computed = await computeContext(world, simulationData,
                    displayAssets, localStellarHaggle, channel);
                if (!computed || computed.target !== target
                    || !dialog.container.visible
                    || currentTarget !== target
                    || currentChannel !== channel) {
                    return;
                }
                if (computed.context.bribe?.purpose === 'mercy'
                    || computed.context.mercyRefused !== undefined) {
                    continue; // Still hostile here: not mirrored yet.
                }
                currentReplies = computed.replies;
                currentBribePurpose = computed.context.bribe?.purpose;
                dialog.replaceContext(computed.context);
                return;
            }
        };

        world.resources.set(HailControlsSubscription,
            controls.subscribe(({ action, state }) => {
                if (action !== 'hail' || state !== 'start') {
                    return;
                }
                // A landed menu / other modal owns the keyboard: stand down.
                if (MenuControls.focused) {
                    return;
                }
                void openHail();
            }));
    },
    remove(world) {
        world.resources.get(HailControlsSubscription)?.unsubscribe();
        const dialog = world.resources.get(HailDialogResource);
        // A channel still open while its world dies (a jump completing
        // with 'h' up) would otherwise keep its MenuControls bound for
        // the rest of the session (see HailDialog.dismiss).
        dialog?.dismiss();
        if (dialog) {
            stopCentring(world, dialog.container);
        }
        // The dialog is per-world; destroying it (children included) frees
        // its Text canvases and Graphics rather than just detaching them —
        // every system transit used to leak a dialog's worth (review #40).
        // Sprite textures are the asset cache's and are left alone.
        dialog?.container.destroy({ children: true });
        world.resources.delete(HailControlsSubscription);
        world.resources.delete(HailDialogResource);
    },
};
