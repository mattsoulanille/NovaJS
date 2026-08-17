import { Entities, GetWorld } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { PersData } from 'novadatainterface/pers_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { dayNumber } from '../nova_plugin/calendar.js';
import { ControlsSubject } from '../nova_plugin/controls_plugin.js';
import { makeDescTextContext, playerGender } from '../nova_plugin/desc_text.js';
import { DisabledComponent } from '../nova_plugin/disabled_component.js';
import {
    DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/game_data_resource.js';
import { GovtComponent } from '../nova_plugin/govt_component.js';
import { shipDisposition } from '../nova_plugin/iff_plugin.js';
import {
    AcceptedMission, ShipOfferSpentComponent,
} from '../nova_plugin/mission_accept.js';
import { MissionOffer } from '../nova_plugin/mission_logic.js';
import { buildAcceptedMissionShips } from '../nova_plugin/mission_ship_spawn.js';
import { expandMissionText } from '../nova_plugin/mission_text.js';
import { ActiveRanksComponent } from '../nova_plugin/ncb_plugin.js';
import { ControlBitsComponent } from '../nova_plugin/ncb_plugin.js';
import { NpcComponent } from '../nova_plugin/npc_ai_plugin.js';
import { PersComponent } from '../nova_plugin/pers_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { GameDateComponent } from '../nova_plugin/player_state_plugin.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import { ShootAllWeaponsComponent } from '../nova_plugin/npc_plugin.js';
import { SystemIdResource } from '../nova_plugin/system_id_resource.js';
import { TargetComponent } from '../nova_plugin/target_component.js';
import { offerSubstitutions } from '../spaceport/mission_offers.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { OfferPopup } from '../spaceport/offer_popup.js';
import { playerIdentitySubs } from '../spaceport/player_identity.js';
import {
    buildShipMissionAccept, buildShipMissionOffer,
} from '../spaceport/ship_mission_accept.js';
import {
    ShipOfferGates, shipOfferConsequence, ShipOfferTrigger,
    shipOfferTrigger, showsHailQuote,
} from '../spaceport/ship_mission_offer.js';
import { ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { showStatusMessage } from './status_message_plugin.js';

/**
 * ============================================================================
 * Missions offered BY A SHIP, on screen (mïsn AvailLoc 2, përs LinkMission)
 * ============================================================================
 *
 * The Bible's AvailLoc 2 is "Offered from ship (must set up associated përs
 * resource as well)", and përs Flags 0x0200 decides which of two things the
 * player does to hear it: HAIL the ship (the default) or BOARD it. This
 * module is the on-screen half of both — one shared popup, one shared
 * presentation path — with hail_dialog_plugin and boarding_plugin as its
 * two triggers.
 *
 * WHAT THE PLAYER SEES. Matthew's ruling for the hail case: the mission is
 * "accepted by hailing the ship, which pops up a mission dialog box instead
 * of the normal hailing box". So a përs with an offer on the table never
 * opens the comm dialog at all — the mission offer takes its place, on the
 * same offer frame (PICT 8521-3) the spaceport boards use, with the mïsn's
 * own Accept/Refuse labels and its offer dësc picture. When no offer
 * applies, the comm dialog opens exactly as before.
 *
 * The boarding case shows the offer BEFORE the plunder dialog, which is
 * both what the original does and what the stock text demands: mïsn 134's
 * offer text opens "You match velocities with the derelict ship and dock
 * with it. Passing through the airlock you are surprised to encounter the
 * surviving crew..." — it IS the boarding narration, and it would read as
 * nonsense after a plunder screen.
 *
 * HOW IT REACHES THE SIMULATION. Not directly, ever. Accept resolves the
 * whole acceptance against a DETACHED COPY of the player's state
 * (spaceport/ship_mission_accept.ts), builds the mission's special ships,
 * and emits AcceptShipMissionEvent; browser.ts encodes the ships and hands
 * the pair to bridge.acceptMission, which is the deterministic input record
 * every peer replays (nova_plugin/mission_accept.ts). Nothing here mutates
 * the display world's mirror of the player.
 *
 * REFUSING DOES NOTHING, deliberately. The Bible gives a mission an OnRefuse
 * set string, and running one in flight would need an input record of its
 * own — but no stock AvailLoc 2 mission has a non-empty OnRefuse (all 13
 * are empty), so the honest implementation is to run nothing and say so.
 * The original re-offers a refused mission on the next hail, and so does
 * this: refusing leaves no state behind. ACCEPTING does — the sim marks the
 * hull with ShipOfferSpentComponent — so one offer is taken at most once.
 */

/**
 * An accepted ship-offered mission, on its way to the simulation bridge.
 * The ships are raw entities; browser.ts encodes them into `record.ships`
 * with the bridge's serializer (the display world has no serializer of
 * its own) and dispatches the single record.
 */
export const AcceptShipMissionEvent = new EcsEvent<{
    record: AcceptedMission,
    ships: Entity[],
}>('AcceptShipMissionEvent');

/** The popup every ship offer is shown on, built once per display world. */
export const ShipOfferPopupResource =
    new Resource<OfferPopup>('ShipOfferPopup');

function getPlayerShip(world: World) {
    for (const [uuid, entity] of world.entities) {
        if (entity.components.has(PlayerShipSelector)) {
            return { uuid, entity };
        }
    }
    return undefined;
}

/**
 * The four encounter conditions the përs QUOTE bits test (ShipOfferGates),
 * read off the same synced components the hail dialog and the target
 * corners read, so nothing on screen can disagree about whether a person
 * is adrift or shooting at you.
 *
 *  disabled        DisabledComponent — the derelicts, and any hulk.
 *  attackingPlayer the AI is targeting the player in attack mode (the same
 *                  test hail_dialog_plugin's computeContext uses, including
 *                  the legacy ShootAllWeapons dev-enemy marker).
 *  holdsGrudge     APPROXIMATED by attackingPlayer. përs Flags 0x0001 ("will
 *                  hold a grudge if attacked, and will subsequently attack
 *                  the player wherever the twain shall meet") is carried in
 *                  PersData but not applied to the spawned ship
 *                  (pers_plugin's documented gaps), so there is no durable
 *                  grudge to read. A person currently attacking you is the
 *                  closest true statement the engine can make; six stock
 *                  përs use 0x0004 and all six also use 0x0010, so in stock
 *                  content the two gates coincide anyway.
 *  likesPlayer     the ship's government is not hostile to the player —
 *                  shipDisposition's 'friendly' OR 'neutral'. Not 'friendly'
 *                  alone: that means the govts are ALLIED, which for the
 *                  Civvies (gövt 157, who fly every Refuel Trader and every
 *                  Escort Merchant) is nobody, and would silence 141 of the
 *                  stock hail quotes permanently.
 */
export async function shipOfferGates(world: World, target: Entity,
    gameData: SimulationGameDataInterface): Promise<ShipOfferGates> {
    const player = getPlayerShip(world);
    const govtId = target.components.get(GovtComponent)?.id;
    const govt = govtId
        ? await gameData.data.Govt.get(govtId).catch(() => undefined)
        : undefined;
    const playerGovtId = player?.entity.components.get(GovtComponent)?.id;
    const playerGovt = playerGovtId
        ? await gameData.data.Govt.get(playerGovtId).catch(() => undefined)
        : undefined;
    const records = player?.entity.components.get(LegalRecordsComponent);
    const targetsPlayer = player !== undefined
        && target.components.get(TargetComponent)?.target === player.uuid;
    const attackingPlayer = targetsPlayer
        && (target.components.get(NpcComponent)?.mode === 'attack'
            || target.components.has(ShootAllWeaponsComponent));
    return {
        disabled: target.components.has(DisabledComponent),
        attackingPlayer,
        holdsGrudge: attackingPlayer,
        likesPlayer:
            shipDisposition(govt, playerGovt, records) !== 'hostile',
    };
}

/**
 * One of the offer's dëscs, expanded with the same substitution table
 * the spaceport boards build (offerSubstitutions + playerIdentitySubs +
 * the dësc conditional context) plus the wildcard only a ship offer has:
 * <OSN>, "the offering ship name".
 *
 * Read straight off the player's synced components rather than through a
 * MissionSession: nothing is being mutated, and a session would be a
 * second, divergent source for the same three values.
 */
async function expandOfferText(world: World, universe: MissionUniverse,
    offer: MissionOffer, persName: string, text: string,
    extra: {
        active?: Parameters<typeof offerSubstitutions>[3],
        payment?: number,
        specialShipName?: string,
    } = {}): Promise<string> {
    const entity = getPlayerShip(world)?.entity;
    const bits = entity?.components.get(ControlBitsComponent) ?? new Set();
    const date = entity?.components.get(GameDateComponent);
    const identity = await playerIdentitySubs(universe,
        entity?.components.get(ShipComponent)?.id, undefined,
        entity?.components.get(ActiveRanksComponent));
    return expandMissionText(text, {
        ...offerSubstitutions(universe,
            date ? dayNumber(date) : 0, offer, extra.active),
        ...identity,
        offeringShipName: persName,
        ...(extra.payment !== undefined ? { payment: extra.payment } : {}),
        ...(extra.specialShipName !== undefined
            ? { specialShipName: extra.specialShipName } : {}),
    }, makeDescTextContext(bits, playerGender()));
}

/**
 * Shows `target`'s LinkMission offer if it has one for this player right
 * now, and returns whether it did. Both triggers call this; the hail
 * plugin uses the answer to decide whether to open the comm dialog
 * instead, and the boarding plugin to decide whether to hold the plunder
 * dialog back.
 *
 * Resolves only when the player has finished with the popup, so a caller
 * that awaits it knows the screen is clear.
 */
export async function presentShipOffer(world: World, targetUuid: string,
    trigger: ShipOfferTrigger): Promise<boolean> {
    const popup = world.resources.get(ShipOfferPopupResource);
    const gameData = world.resources.get(SimulationGameDataResource);
    const player = getPlayerShip(world);
    const target = world.entities.get(targetUuid);
    if (!popup || !gameData || !player || !target) {
        return false;
    }
    // A hull whose offer has already been taken never offers again: the
    // simulation marks it on the accept, and the marker is synced here.
    if (target.components.has(ShipOfferSpentComponent)) {
        return false;
    }
    const persComponent = target.components.get(PersComponent);
    if (!persComponent) {
        return false;
    }
    let pers: PersData;
    try {
        pers = await gameData.data.Pers.get(persComponent.id);
    } catch {
        return false;
    }
    const universe = MissionUniverse.shared(gameData);
    // The system both the player and the offering ship are in: the
    // mission context borrows a stellar from it, and the mission's own
    // ships are then spawned into it (see buildShipMissionOffer).
    const systemId = world.resources.get(SystemIdResource);
    const offer = await buildShipMissionOffer(player.entity, pers, trigger,
        gameData, universe, { systemId });
    if (!offer) {
        return false;
    }
    const text = await expandOfferText(world, universe, offer,
        persComponent.name || pers.name, offer.data.offerText);
    if (!text.trim()) {
        // "Invisible missions still get their offer text unless it is
        // empty": mïsn Flags 0x0400 (invisible) hides a mission from the
        // player-info list, not from its own offer — mïsn 133 and the
        // four Refuel Traders are all invisible and all have offer text.
        // An offer with NO text has nothing to show and no way for the
        // player to consent, so it is not made.
        return false;
    }

    const choice = await popup.show(text, {
        accept: offer.data.acceptButton || 'Accept',
        // mïsn Flags 0x0004 cantRefuse — the same rule presentOffers
        // applies on the spaceport boards: no Refuse button at all.
        refuse: offer.data.flags.cantRefuse ? null
            : (offer.data.refuseButton || 'Refuse'),
    }, { pict: offer.data.offerPict, style: 'offer' });
    if (choice !== 'accept') {
        // See the module note: nothing is run, nothing is remembered.
        return true;
    }
    await acceptShipOffer(world, player, target, targetUuid, pers, offer,
        gameData, universe, popup, systemId);
    return true;
}

/** The accept half: resolve, build the ships, dispatch, show the brief. */
async function acceptShipOffer(world: World,
    player: { uuid: string, entity: Entity }, target: Entity,
    targetUuid: string, pers: PersData, offer: MissionOffer,
    gameData: SimulationGameDataInterface, universe: MissionUniverse,
    popup: OfferPopup, systemId: string | undefined): Promise<void> {
    const consequence = shipOfferConsequence(pers);
    const accept = await buildShipMissionAccept(player.entity, offer,
        gameData, universe, {
        offeredBy: targetUuid, systemId,
        // 'stay' is the absence of the field, so only the two verbs the
        // sim knows how to carry out are sent.
        ...(consequence === 'stay' ? {} : { offeredByFate: consequence }),
    });
    if (!accept) {
        // acceptOffer refused it (a full hold, the 16-mission cap): say
        // so on the popup rather than swallowing the press, the same way
        // presentOffers does on the boards.
        await popup.show('You cannot take on this mission right now.',
            { accept: 'OK' });
        return;
    }

    // The mission's own ships, spawned into the system the player is
    // already flying in, riding the SAME record as the mission (see
    // AcceptedMissionType.ships). This is where the Derelict Decoy's
    // four pirates come from, and where the Refuel Trader's rescue hulk
    // takes the trader's place.
    let ships: Entity[] = [];
    if (systemId) {
        const movement = target.components.get(MovementStateComponent);
        const replace = consequence === 'replace' && movement
            ? {
                position: movement.position,
                rotation: movement.rotation,
                velocity: movement.velocity,
                // Bible, përs Flags 0x0040: "if the mission's SpecialShip
                // düde type contains the përs ship's ship type in it, the
                // SpecialShip that's created will be of the same type as
                // the përs ship, regardless of the probabilities in the
                // düde resource."
                preferShipId: target.components.get(ShipComponent)?.id,
            }
            : undefined;
        try {
            ships = await buildAcceptedMissionShips(offer.data.id,
                accept.shipSource, player.uuid, systemId, gameData,
                universe, { replace });
        } catch (e) {
            console.warn('Failed to build ship-offered mission ships:', e);
        }
    }

    world.emit(AcceptShipMissionEvent, { record: accept.record, ships });

    // The briefing (or, for an immediate auto-abort, its notice). Every
    // stock AvailLoc 2 mission has an EMPTY BriefText, so in stock
    // content nothing follows the offer — but a plug-in's would.
    for (const event of accept.events) {
        if (!event.text?.trim()) {
            continue;
        }
        const brief = await expandOfferText(world, universe, offer,
            pers.name, event.text, {
            active: accept.active,
            payment: event.payment,
            specialShipName: event.specialShipName,
        });
        await popup.show(brief, { accept: 'OK' },
            { pict: offer.data.briefPict, style: 'briefing' });
    }
}

/**
 * ============================================================================
 * The HailQuote advertisement (përs HailQuote, STR# 7101)
 * ============================================================================
 *
 * "HailQuote: Index number of an entry in STR# resource 7101, to be
 * displayed at the bottom of the game screen (i.e. over the radio)" (EVN
 * Bible, përs). So it is the bottom-left status line — the same line the
 * arrival date and the blocked-landing messages use — and not a dialog:
 * it is the person calling out to everyone in the system, which is how
 * you learn a Refuel Trader needs help before you have targeted anything.
 *
 * WHEN IT FIRES. Once per person per system visit, as soon as that
 * person's gate conditions are true (showsHailQuote). Not necessarily on
 * arrival: six stock përs use 0x0010, "only show HailQuote when ship
 * BEGINS to attack the player", which is a transition, so the conditions
 * are re-checked every frame until the quote is either said or ruled out.
 *
 * DISPLAY-ONLY, and it must be: the status line is local feedback, the
 * përs data is not reachable from the simulation, and one player's radio
 * traffic is not another's. Nothing here writes sim state.
 *
 * 0x0080 ("only show quote once") IS HONOURED WITHIN A SYSTEM VISIT, not
 * across the pilot's career. The display world is rebuilt on every system
 * transit, so `said` resets with it; a career-long record would need
 * per-player përs state on the save, which is the same gap pers_plugin
 * already documents for killed people ("a killed person can reappear on
 * the next eligible spawn draw"). Since at most one instance of a person
 * lives in a system at a time, within a visit the bit changes nothing —
 * it is the repeat encounters it is meant to quiet, and those are the
 * ones that wait on that persisted state.
 */
interface HailQuoteState {
    /** përs ids whose quote has been said (or ruled out) this world. */
    said: Set<string>;
    /** përs ids with an async lookup in flight. */
    resolving: Set<string>;
    /** Fetched përs records; null for one that failed to load. */
    pers: Map<string, PersData | null>;
    /** Whether each përs's LinkMission is offerable (përs Flags 0x0400).
     * Only populated for the përs that actually set that bit. */
    missionAvailable: Map<string, boolean>;
}
const HailQuoteStateResource =
    new Resource<HailQuoteState>('PersHailQuoteState');

/**
 * Evaluates one përs's quote against the CURRENT world and says it if it
 * is due. Returns nothing; every side effect is the status line or the
 * caches. Split out of the system so a spec can drive it directly.
 */
async function considerHailQuote(world: World, state: HailQuoteState,
    gameData: SimulationGameDataInterface, target: Entity,
    persId: string, persName: string): Promise<void> {
    if (state.said.has(persId) || state.resolving.has(persId)) {
        return;
    }
    let pers = state.pers.get(persId);
    if (pers === undefined) {
        state.resolving.add(persId);
        try {
            pers = await gameData.data.Pers.get(persId);
            state.pers.set(persId, pers);
        } catch {
            state.pers.set(persId, null);
            state.said.add(persId);
            return;
        } finally {
            state.resolving.delete(persId);
        }
    }
    if (!pers || !pers.hailQuote.trim()) {
        // Nothing to say, ever: stop re-checking this person.
        state.said.add(persId);
        return;
    }

    const gates = await shipOfferGates(world, target, gameData);
    // 0x0400 needs the mission's availability, which is a full offer
    // resolution. Done once per person and cached, and with the
    // AvailRandom roll forced to PASS: the bit asks whether the mission
    // is available to this player at all, not whether this particular
    // percentage roll came up — an advertisement that flickered with a
    // 40% roll every frame would be noise, not information.
    let missionAvailable = true;
    if (pers.flags.hailOnlyWhenMissionAvailable) {
        const cached = state.missionAvailable.get(persId);
        if (cached === undefined) {
            const player = getPlayerShip(world);
            const trigger = shipOfferTrigger(pers);
            if (!player || !trigger) {
                state.said.add(persId);
                return;
            }
            state.resolving.add(persId);
            try {
                const offer = await buildShipMissionOffer(player.entity,
                    pers, trigger, gameData,
                    MissionUniverse.shared(gameData), {
                    systemId: world.resources.get(SystemIdResource),
                    random: () => 0,
                });
                missionAvailable = offer !== null;
                state.missionAvailable.set(persId, missionAvailable);
            } catch {
                state.missionAvailable.set(persId, false);
                missionAvailable = false;
            } finally {
                state.resolving.delete(persId);
            }
        } else {
            missionAvailable = cached;
        }
    }

    if (!showsHailQuote(pers, {
        ...gates, missionAvailable,
        // Per-person, and this is the first time it is being said.
        alreadyShown: false,
    })) {
        // The gates may become true later (0x0010 is a transition); leave
        // this person unmarked so the next frame re-checks them.
        return;
    }
    state.said.add(persId);
    const universe = MissionUniverse.shared(gameData);
    const identity = await playerIdentitySubs(universe,
        getPlayerShip(world)?.entity.components.get(ShipComponent)?.id);
    showStatusMessage(world, expandMissionText(pers.hailQuote, {
        ...identity,
        // Every stock quote opens with <OSN> — see mission_text.ts.
        offeringShipName: persName || pers.name,
    }));
}

/**
 * Sweeps the system's përs for quotes that are due. Runs on the local
 * player's entity (PlayerShipSelector), so a peer's client never says
 * another player's radio traffic, and sorted by uuid so several people
 * announcing themselves on the same frame do so in a stable order.
 */
const PersHailQuoteSystem = new System({
    name: 'PersHailQuoteSystem',
    args: [HailQuoteStateResource, SimulationGameDataResource, Entities,
        PlayerShipSelector, GetWorld] as const,
    step(state, gameData, entities, _player, world) {
        const candidates: [string, Entity, string, string][] = [];
        for (const [uuid, entity] of entities) {
            const pers = entity.components.get(PersComponent);
            if (pers && !state.said.has(pers.id)
                && !state.resolving.has(pers.id)) {
                candidates.push([uuid, entity, pers.id, pers.name]);
            }
        }
        candidates.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
        for (const [, entity, persId, persName] of candidates) {
            void considerHailQuote(world, state, gameData, entity,
                persId, persName).catch(e => {
                    console.warn('Hail quote evaluation failed:', e);
                });
        }
    },
});

export const ShipMissionOfferPlugin: Plugin = {
    name: 'ShipMissionOfferPlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        const controls = world.resources.get(ControlsSubject);
        const stage = world.resources.get(Stage);
        const screenSize = world.resources.get(ScreenSize);
        if (!displayAssets || !controls || !stage || !screenSize) {
            throw new Error(
                'ShipMissionOfferPlugin missing a required resource');
        }
        const popup = new OfferPopup(displayAssets, controls);
        popup.container.name = 'ShipOfferPopup';
        popup.container.position.set(screenSize.x / 2, screenSize.y / 2);
        stage.addChild(popup.container);
        world.resources.set(ShipOfferPopupResource, popup);

        world.resources.set(HailQuoteStateResource, {
            said: new Set(), resolving: new Set(),
            pers: new Map(), missionAvailable: new Map(),
        });
        world.addSystem(PersHailQuoteSystem);
    },
    remove(world) {
        world.removeSystem(PersHailQuoteSystem);
        const stage = world.resources.get(Stage);
        const popup = world.resources.get(ShipOfferPopupResource);
        if (stage && popup) {
            stage.removeChild(popup.container);
        }
        world.resources.delete(ShipOfferPopupResource);
        world.resources.delete(HailQuoteStateResource);
    },
};
