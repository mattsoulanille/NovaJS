import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { World } from 'nova_ecs/world';
import { Subscription } from 'rxjs';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlsSubject } from '../nova_plugin/controls_plugin.js';
import { DisabledComponent } from '../nova_plugin/disabled_component.js';
import { escortParent } from '../nova_plugin/escort_command_plugin.js';
import { SourceComponent } from '../nova_plugin/weapon_components.js';
import { DisplayAssetDataResource, SimulationGameDataResource } from '../nova_plugin/game_data_resource.js';
import { GovtComponent } from '../nova_plugin/govt_component.js';
import {
    assistGrantedText,
    ASSIST_GRANTED_FALLBACK,
    bribeAmount,
    busyResponseText,
    BUSY_RESPONSE_FALLBACK,
    assistIsFree,
    canRequestAssistance,
    channelOpenText,
    CLEARED_TO_DOCK_INDEX,
    CLEARED_TO_LAND_INDEX,
    DOCKING_DENIED_INDEX,
    genericGreetings,
    greetingText,
    HAIL_RESPONSE_TABLE,
    hashString,
    hostileResponseText,
    LANDING_DENIED_INDEX,
    mercyAcceptedText,
    MISC_STRING_TABLE,
    miscString,
    noNeedResponseText,
    NO_NEED_RESPONSE_FALLBACK,
    NO_RESPONSE_FALLBACK,
    NO_RESPONSE_INDEX,
    planetTakesBribes,
    shipHailResponse,
    shipIsFighting,
    shipTakesBribes,
    stellarBribeOfferText,
    stellarBribeRefusedText,
    stellarChannelOpenText,
    STELLAR_RESPONSE_TABLE,
    STELLAR_STATUS_FORBIDDEN_INDEX,
    STELLAR_STATUS_HOSTILE_INDEX,
} from '../nova_plugin/hail.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { HailAction } from '../nova_plugin/hail_plugin.js';
import { SoundEvent } from '../nova_plugin/sound_plugin.js';
import { FuelComponent } from '../nova_plugin/health_plugin.js';
import { planetDisposition, shipDisposition } from '../nova_plugin/iff_plugin.js';
import { isPort, landable } from '../nova_plugin/landable.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { SimulationTimeResource } from './simulation_time.js';
import { NpcComponent } from '../nova_plugin/npc_ai_plugin.js';
import { ShootAllWeaponsComponent } from '../nova_plugin/npc_plugin.js';
import { PersComponent } from '../nova_plugin/pers_plugin.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import { targetIdentity } from './target_identity.js';
import { ActiveRanksComponent } from '../nova_plugin/ncb_plugin.js';
import {
    ranksAllowAssistance, ranksGiveFreeRepair,
} from '../nova_plugin/rank_logic.js';
import {
    PlanetComponent, PlanetDataComponent, PlanetTargetComponent,
    stellarClearanceFor, StellarBribesComponent,
} from '../nova_plugin/planet_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { CreditsComponent, MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation_plugin.js';
import { ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { TargetComponent } from '../nova_plugin/target_component.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import {
    EscortManagement, EscortPressAction, escortReadout, HailContext,
    HailDialog,
} from '../spaceport/hail_dialog.js';
import {
    escortDailyFee, escortSellValue, escortUpgradeCost,
} from '../spaceport/escort_fees.js';
import {
    escortProvenance, escortSaleQueued, pendingEscortUpgrade,
} from '../nova_plugin/player_escort.js';
import { EscortAction } from '../nova_plugin/escort_action.js';
import { shipGateContext } from '../spaceport/ship_gate_context.js';
import {
    ShipyardContext, shipStockGatesPass,
} from '../spaceport/shipyard_stock_rules.js';
import { ShipData } from 'novadatainterface/ship_data';
import { ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { displayName } from '../nova_plugin/display_name.js';
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
 * nobody to answer, so no dialog appears at all. The press gets the original's "No response." on the
 * bottom-left status line and the can't-do beep, the same feedback a blocked
 * landing gets. See hailIsUnanswerable / refuseHail.
 *
 * ESCORT COMM: the escort variant MANAGES one of the player's own escorts
 * (Upgrade / Sell / Release / Close Channel per hail/hail_escort.png and
 * hail/hail_captured_escort.png), not a fleet-command panel — commanding
 * escorts is the keyboard escort-controls' job. All three functions are live.
 * Their prices come off the escort's CURRENT ship class through
 * spaceport/escort_fees.ts — the same module the settlement at the pad
 * re-derives them from — and each press leaves as an EscortActionEvent, so
 * the escort dialog's effects ride the same input-record path every other
 * simulation effect does.
 *
 * Upgrade and Sell QUEUE their deal for the next shipyard rather than
 * striking it here (nova_plugin/escort_action.ts). This module's job for
 * them is the OFFER: what each would cost, whether the player can pay it
 * today, whether the target hull is one they are allowed at all
 * ({@link escortUpgradeOffer}), and which deals are already queued — all
 * read off the same synced state the simulation writes, so the box a
 * second peer draws is the same box.
 */

const HailDialogResource = new Resource<HailDialog>('HailDialog');
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
    const planetData = planetTargetUuid
        ? world.entities.get(planetTargetUuid)
            ?.components.get(PlanetDataComponent)
        : undefined;
    return !!planetData && !isPort(planetData.flags);
}

/** Whether the player ship is disabled or low on fuel (assist gate). */
function playerNeedsHelp(entity: ReturnType<typeof getPlayerShip>): boolean {
    if (!entity) {
        return false;
    }
    if (entity.entity.components.has(DisabledComponent)) {
        return true;
    }
    const fuel = entity.entity.components.get(FuelComponent);
    return !!fuel && fuel.current < fuel.max && fuel.current < 100;
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
 * The three things a hailed ship can say to a Request Assistance press, all
 * resolved from STR# 3000 when the channel opens (the button's handler is
 * synchronous, so the text cannot be fetched on the press).
 */
export interface AssistReplies {
    /** "All right, I'll help you." — accepted, the errand is dispatched. */
    granted: string;
    /** "I'm busy." — the ship is in the middle of a fight. */
    busy: string;
    /** "You're not in any trouble." — the player's ship is fine. */
    noNeed: string;
}

/** The pinned literals, used when the string table cannot be loaded. */
export const ASSIST_REPLIES_FALLBACK: AssistReplies = {
    granted: ASSIST_GRANTED_FALLBACK,
    busy: BUSY_RESPONSE_FALLBACK,
    noNeed: NO_NEED_RESPONSE_FALLBACK,
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
 * Evaluated at the moment of the press (not when the channel was opened) so a
 * ship that got into a fight, or a player who took a hit, while the dialog was
 * up still gets an honest answer. The simulation's applyHail re-checks the
 * SAME predicates over the SAME synced components and is the authority; this
 * exists so the player SEES the answer instead of pressing a button that
 * silently does nothing.
 */
export function assistAnswer(world: World, targetUuid: string | undefined,
    replies: AssistReplies): { line: string, dispatch: boolean } {
    const player = getPlayerShip(world);
    if (!playerNeedsHelp(player)) {
        return { line: replies.noNeed, dispatch: false };
    }
    const target = targetUuid ? world.entities.get(targetUuid) : undefined;
    if (target && targetIsFighting(target)) {
        return { line: replies.busy, dispatch: false };
    }
    return { line: replies.granted, dispatch: true };
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
        lines.push('Status: Hostile');
    }
    return lines.join('\n');
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
 *   Require    met by the player's Contribute (hull + outfits + ranks);
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
    displayAssets?: DisplayAssetDataInterface):
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
        const disposition = shipDisposition(govt, playerGovt, playerRecords);
        // Behavioral hostility: a ship whose AI is attacking the player is
        // hostile regardless of politics — the same rule the target corners
        // use (iff_plugin's targetCornerStyle), including the legacy dev-enemy
        // ShootAllWeapons marker. Read from the same synced components the sim
        // reads so the dialog and applyHail agree on the outcome.
        const targetsPlayer = shipTarget.components
            .get(TargetComponent)?.target === player.uuid;
        const shipNpcMode = shipTarget.components.get(NpcComponent)?.mode;
        const attackingPlayer = targetsPlayer && (shipNpcMode === 'attack'
            || shipTarget.components.has(ShootAllWeaponsComponent));

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
            shipClass: shipData?.name,
            govtName: govt?.commName,
            hostile: disposition === 'hostile' || attackingPlayer,
        });

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
                pendingUpgrade:
                    pendingEscortUpgrade(shipTarget) !== undefined,
                pendingSale: escortSaleQueued(shipTarget),
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

        const response = shipHailResponse(govt, disposition, aiType,
            attackingPlayer);
        if (response.kind === 'cantHail') {
            return {
                context: {
                    variant: 'ship', heading, image,
                    body: 'There is no response.',
                },
                target: shipTargetUuid, isEscort: false,
                replies: ASSIST_REPLIES_FALLBACK,
            };
        }
        if (response.kind === 'hostile') {
            const largerBribes = !!govt?.flags.largerBribes;
            const amount = bribeAmount(credits, largerBribes);
            const bribe = response.canBribe
                ? {
                    amount, canAfford: credits >= amount && amount > 0,
                    purpose: 'mercy' as const,
                    // What they say once the demand is PAID (STR# 3000
                    // 135-139). Resolved here because the Pay handler is
                    // synchronous, exactly like the assistance replies.
                    accepted: mercyAcceptedText(shipStrings, shipSeed),
                }
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
                    bribe,
                },
                target: shipTargetUuid, isEscort: false,
                replies: ASSIST_REPLIES_FALLBACK,
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
        const greeting = greetingText({
            persCommQuote: pers?.commQuote,
            govtGreetings: govt?.commGreetings,
            genericGreetings: genericGreetings(shipStrings),
            govtCommName: govt?.commName,
            talkative: response.talkative,
            seed: shipSeed,
        }) || undefined;
        // ränk 0x0400 / 0x0800 for the hailed ship's OWN government
        // (rank_logic.ts): always-assist and free repair. Read off the same
        // synced ActiveRanksComponent the simulation reads, so the dialog and
        // applyHail cannot disagree about whether the button is offered.
        const hailRanks = player.entity.components.get(ActiveRanksComponent);
        const getHailRank = (id: string) =>
            gameData.data.Rank.getCached(id);
        const assist = canRequestAssistance({
            disposition, govt, attackingPlayer,
            rankAlwaysAssists: ranksAllowAssistance(
                hailRanks, getHailRank, govt?.id),
        }) ? {
            free: assistIsFree(govt, ranksGiveFreeRepair(
                hailRanks, getHailRank, govt?.id)),
        } : undefined;
        // The OFFER is not withdrawn for a ship that happens to be fighting,
        // nor for a player whose ship is in perfect shape, NOR ONCE IT HAS
        // BEEN USED (hail/request_assistance.png still shows the button after
        // the ship has answered "You're not in any trouble."): they ask, and
        // the ship answers with a line from the response table ("I'm busy" /
        // "You're not in any trouble." / "All right, I'll help you."). Only
        // the lines are resolved here — the press decides which is used.
        const replies = resolveAssistReplies(shipStrings, shipSeed);
        return {
            context: {
                variant: 'ship', heading, image, body, greeting, assist,
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
        const image = planetData?.landingPict
            ? planetData.landingPict : null;
        const isStation = planetData?.flags.isStation ?? false;
        // A stellar that is not a PORT — unlandable (Jupiter, a wrecked
        // gate) or flagged uninhabited, which the Bible glosses as "no
        // traffic control or refuelling" — has nobody listening, so the
        // original never opens a channel to one. Refuse here — the plugin
        // turns this undefined into the status line's "No response." and a
        // can't-do beep (see hailIsUnanswerable) — rather than opening a
        // comm dialog just to deny a landing that was never on offer.
        if (planetData && !isPort(planetData.flags)) {
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
        const clearance = planetData && planetId !== undefined
            ? stellarClearanceFor({
                planetData, gameData, records: playerRecords,
                shipData: player.entity.components.get(ShipDataComponent),
                outfits: player.entity.components.get(OutfitsStateComponent),
                bribes: player.entity.components.get(StellarBribesComponent),
                ranks: player.entity.components.get(ActiveRanksComponent),
                missions: player.entity.components.get(MissionsComponent),
                // Bribe expiries are SIM-clock stamps; the display world's
                // own TimeResource is the wall clock and would judge every
                // paid bribe already expired.
                planetId,
                now: world.resources.get(SimulationTimeResource)?.time ?? 0,
            })
            : { cleared: true as const };

        // A port that is refusing you and whose government bargains (gövt
        // 0x4000 / 0x8000) offers the deal in the middle button slot, the way
        // a hostile ship offers Beg For Mercy. Price and affordability are the
        // same pure functions the simulation re-derives in applyHail, so the
        // dialog never shows a number the sim would disagree with.
        const canBribe = !clearance.cleared && planetTakesBribes(govt);
        const amount = bribeAmount(credits, !!govt?.flags.largerBribes);
        const bribe = canBribe
            ? {
                amount, canAfford: credits >= amount && amount > 0,
                purpose: 'landing' as const,
            }
            : undefined;

        const stellarStrings = await loadStrings(displayAssets,
            STELLAR_RESPONSE_TABLE);
        const miscStrings = await loadStrings(displayAssets, MISC_STRING_TABLE);
        const seed = hashString(planetTargetUuid);
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
            : canBribe
                ? stellarBribeOfferText(stellarStrings, seed)
                // A shut port that won't be bought says so in its own words
                // (STR# 3002 30-34) after traffic control's flat refusal.
                : `${miscString(miscStrings,
                    isStation ? DOCKING_DENIED_INDEX : LANDING_DENIED_INDEX,
                    isStation ? 'Docking request denied.'
                        : 'Landing request denied.')} `
                + `${stellarBribeRefusedText(stellarStrings, seed)}`;

        // The lower well names the stellar, and — when it is refusing you —
        // states WHY in the original's own vocabulary: "Forbidden" (STR# 2002
        // index 172) for a shut port or a missing travel permit, "Hostile"
        // (173) for a legal record below its MinStatus. identityRuns paints a
        // "Status:" line red, exactly as it does for a hostile ship.
        // `isLandable` is always true here (the non-port case returned
        // above); it is still threaded through the SAME planetDisposition the
        // radar blip reads so the two can never drift apart.
        const status = planetDisposition(clearance, isLandable);
        const heading = status === 'neutral' || status === 'unlandable' ? name
            : `${name}\nStatus: ${miscString(miscStrings,
                status === 'hostile'
                    ? STELLAR_STATUS_HOSTILE_INDEX
                    : STELLAR_STATUS_FORBIDDEN_INDEX,
                status === 'hostile' ? 'Hostile' : 'Forbidden')}`;

        return {
            context: {
                variant: 'planet', heading, image,
                body: `${opening}\n${answer}`, bribe,
            },
            target: planetTargetUuid, isEscort: false,
            replies: ASSIST_REPLIES_FALLBACK,
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
        const dialog = new HailDialog(displayAssets, controls, {
            requestAssistance: () => {
                // ONE call decides and answers: the ship's line comes back
                // whether it accepted or refused, and only an acceptance
                // dispatches. A refusal (busy, or a player who needs nothing)
                // leaves the ship's behavior completely untouched.
                const answer = assistAnswer(world, currentTarget,
                    currentReplies);
                if (answer.dispatch && currentTarget) {
                    world.emit(HailRequestEvent, {
                        action: {
                            kind: 'requestAssistance', target: currentTarget,
                        },
                    });
                }
                return answer.line;
            },
            bribe: () => {
                if (currentTarget) {
                    world.emit(HailRequestEvent,
                        { action: { kind: 'bribe', target: currentTarget } });
                }
            },
            // The escort box's management functions. Each becomes one
            // EscortActionEvent naming the escort; QUEUEING AN UPGRADE also
            // names the class the box priced, which the simulation checks
            // against the escort's own shïp UpgradeTo — so this can only
            // ever confirm what the escort already says — and then STORES,
            // so the settlement at the pad can tell a stale deal from a
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
            // Local client UI beep through the shared display audio path
            // (SoundEvent → SoundSystem); no simulation involvement.
            playSound: (id: string) => world.emit(SoundEvent, { id }),
        });
        stage.addChild(dialog.container);
        world.resources.set(HailDialogResource, dialog);
        if (typeof window !== 'undefined') {
            (window as unknown as { novaHailDialog: HailDialog })
                .novaHailDialog = dialog;
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

        let opening = false;
        const openHail = async (): Promise<void> => {
            if (dialog.container.visible || opening) {
                return;
            }
            // Nobody is home on a dead moon: no channel opens at all.
            if (hailIsUnanswerable(world)) {
                await refuseHail();
                return;
            }
            opening = true;
            try {
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
                const computed = await computeContext(world, simulationData,
                    displayAssets);
                if (!computed) {
                    return;
                }
                currentTarget = computed.target;
                currentReplies = computed.replies;
                currentEscort = computed.context.escort;
                // Re-add to move above later-added containers (spaceport).
                stage.addChild(dialog.container);
                dialog.container.position.set(
                    screenSize.x / 2, screenSize.y / 2);
                await dialog.show(computed.context);
            } finally {
                opening = false;
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
        const stage = world.resources.get(Stage);
        const dialog = world.resources.get(HailDialogResource);
        if (stage && dialog) {
            stage.removeChild(dialog.container);
        }
        world.resources.delete(HailControlsSubscription);
        world.resources.delete(HailDialogResource);
    },
};
