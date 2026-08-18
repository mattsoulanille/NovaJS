import { GetWorld } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { MissionData } from 'novadatainterface/mission_data';
import { dayNumber } from '../nova_plugin/calendar.js';
import { ControlsSubject } from '../nova_plugin/controls_plugin.js';
import { makeDescTextContext, playerGender } from '../nova_plugin/desc_text.js';
import {
    DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/game_data_resource.js';
import { expandMissionText } from '../nova_plugin/mission_text.js';
import { MissionShip, MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import {
    GOAL_BOARD, GOAL_RESCUE, ShipObjective,
} from '../nova_plugin/mission_ship_state.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import {
    GameDateComponent, MissionsComponent,
} from '../nova_plugin/player_state_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import { activeAsOffer, offerSubstitutions } from '../spaceport/mission_offers.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { OfferPopup } from '../spaceport/offer_popup.js';
import { playerIdentitySubs } from '../spaceport/player_identity.js';
import { markShipDoneTextShown } from '../spaceport/ship_done_shown.js';
import { ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';

/**
 * ============================================================================
 * mïsn ShipDoneText, shown WHEN THE SHIP GOAL COMPLETES
 * ============================================================================
 *
 * "ShipDoneText: The desc to show when you complete the special ship
 * goal" (EVN Bible, mïsn). The original shows it at that moment — the
 * instant the last special ship is destroyed, disabled, boarded,
 * observed, rescued or chased off — not at the next landing. Matthew's
 * report is exactly that gap: the Hyperioid mission's "You take one of
 * the hyperioid's pods..." only appeared after landing at the
 * destination stellar, long after the boarding it narrates.
 *
 * WHERE THE FLAG COMES FROM. Goal progress is shared simulation state:
 * MissionShipTrackSystem (and its death / departure siblings) drive
 * mission_ship_state's transitions on the ShipObjective inside the
 * OWNER's MissionsComponent, and `updateCompletion` raises
 * `shipDonePending` the tick the goal completes. Every peer computes
 * that identically, and the component is serializer-registered, so the
 * owner's DISPLAY world sees the flag the same frame its own simulation
 * mirror does.
 *
 * WHAT THIS MODULE DOES WITH IT. It watches the LOCAL player's own
 * missions for that flag and puts the ShipDoneText on screen, with its
 * dësc picture and its wildcards expanded, as an in-flight popup. It is
 * the same OfferPopup the landing notices and the ship-offered missions
 * use, on the same briefing frame, so the text reads identically
 * wherever it is shown.
 *
 * PLAYER-LOCALITY. Only the mission's owner sees it: the system runs on
 * `PlayerShipSelector`, which is the LOCAL player's ship in this client's
 * display world, and the missions read are that ship's own. A peer
 * watching the same kill in the same system computes the same
 * `shipDonePending` in its simulation — it is shared state — but its
 * display never looks at another player's mission list, so nothing is
 * shown there.
 *
 * ROLLBACK. `shown` is a once-guard keyed on the mission id, per display
 * world. The rollback driver can resimulate the tick the goal completed
 * (and hence raise the flag again); the guard means the popup is
 * presented exactly once regardless.
 *
 * ============================================================================
 * BOARD AND RESCUE GOALS GO THROUGH THE BOARDING DIALOG INSTEAD
 * ============================================================================
 *
 * ShipGoal 2 ("board them") and ShipGoal 5 ("rescue them") complete by
 * BOARDING, and a boarding already owns the screen: boarding_plugin's
 * BoardingUi is deciding, that same frame, whether to raise the plunder
 * table. Two independent presenters racing for that moment would show
 * the text behind the plunder dialog, so the sweep below deliberately
 * SKIPS those two goals and boarding_plugin drives them, through
 * `boardShipDoneStatus` / `presentBoardShipDone` — showing the text IN
 * PLACE OF the plunder dialog and ending the boarding with it, exactly as
 * a board-offered mission does (see boardingDialogPhase).
 *
 * Matthew's ruling for the boarding case: for a mission ship whose
 * boarding completes the goal, the mission text is what should appear.
 * The Hyperioid's text — "You take one of the hyperioid's pods, knowing
 * that it will regenerate it and be fine in a few days" — IS the
 * boarding, and a plunder table asking what to steal from the creature
 * you just sampled reads as nonsense, the same argument mïsn 134's
 * derelict already won.
 *
 * If the boarding ends before the text is presented (the hulk is
 * destroyed under you, the session is closed from the simulation side),
 * nothing here shows it and the deferred 'shipDone' event still does, at
 * the next landing — the old behaviour, kept as the fallback.
 *
 * ============================================================================
 * OnShipDone IS STILL DEFERRED
 * ============================================================================
 *
 * The Bible runs OnShipDone at the same moment it shows the text. NovaJS
 * runs it at the owner's next date advance (mission_logic's
 * runPendingShipDone), and this change does not move it, because moving
 * it is a much larger job than moving the text:
 *
 *  - a set string is not a popup. It can start, abort and fail OTHER
 *    missions (Sxxx/Axxx/Fxxx), grant outfits and ranks, and pay — so an
 *    in-flight OnShipDone needs an input record carrying a whole
 *    MISSIONS-MAP delta, where the established in-flight record
 *    (mission_accept.ts) carries exactly one mission and a set of scalar
 *    deltas. It also produces its own accept/abort/fail notices, which
 *    would need presenting here too.
 *
 *  - nothing in the shipped content can tell. Of the stock mïsn set,
 *    76 missions have a non-empty OnShipDone and NONE of them has a
 *    ShipDoneText; the one stock mission that has a ShipDoneText
 *    (nova:741, "Rescue Heraan Operatives") has an EMPTY OnShipDone, as
 *    do the two Hyperioid missions this bug was reported against. The
 *    text and the set string are disjoint in practice, so showing the
 *    text now and running the set string at the next jump or landing is
 *    never observable as an ordering.
 *
 * The one thing that MUST agree is the text: the deferred pass queues a
 * 'shipDone' event carrying the same dësc, and the landing popups render
 * it. `markShipDoneTextShown` tells that pass this client has already
 * shown it (spaceport/ship_done_shown.ts), so it is read exactly once.
 */

/** The popup every ShipDoneText is shown on, built once per display world. */
export const ShipDonePopupResource =
    new Resource<OfferPopup>('ShipDonePopup');

/** Per-display-world presentation state (see the module note). */
export interface ShipDoneState {
    /** Mission ids whose text has been presented, or is being presented,
     * in this display world. The rollback-safe once-guard. */
    shown: Set<string>;
    /** Mission data for the player's active missions. A null entry is a
     * lookup that failed; an ABSENT entry has not been looked up yet. */
    missions: Map<string, MissionData | null>;
    /** Mission ids with a lookup in flight. */
    loading: Set<string>;
}
export const ShipDoneStateResource =
    new Resource<ShipDoneState>('MissionShipDoneState');

function getPlayerShip(world: World):
    { uuid: string, entity: Entity } | undefined {
    for (const [uuid, entity] of world.entities) {
        if (entity.components.has(PlayerShipSelector)) {
            return { uuid, entity };
        }
    }
    return undefined;
}

/**
 * Where the boarding dialog stands with respect to a mission ship's
 * ShipDoneText:
 *
 *  'none'  nothing to show for this hull — it is not one of the local
 *          player's own board/rescue special ships, or its mission has
 *          no ShipDoneText, or this boarding did not complete the goal.
 *          The plunder dialog behaves exactly as it always has.
 *  'wait'  it IS one, and the simulation has not yet said what the
 *          boarding did to the goal. The plunder dialog is held back for
 *          those few frames rather than flashing up and being replaced.
 *  'show'  the goal has just completed: present the text.
 */
export type ShipDoneBoardStatus = 'none' | 'wait' | 'show';

/**
 * The rule above, as a pure function of the three things it reads: the
 * boarded hull's MissionShipComponent, the owner's ShipObjective for that
 * mission, and whether the mission has a ShipDoneText at all.
 *
 * `hasText` is UNDEFINED while the mission data is still being fetched,
 * which is a 'wait' rather than a 'none': the fetch resolves in a frame
 * or two and answering 'none' meanwhile would raise the plunder dialog
 * for exactly the hull that must not get one.
 *
 * The waiting is bounded from the OTHER side, by the simulation's own
 * record of what the boarding did: `live[targetUuid].boarded` is set the
 * tick the board is credited, so a boarding that counted WITHOUT
 * completing the goal (ship 1 of 3) reads 'none' from then on and the
 * plunder dialog opens as usual. This deliberately re-reads the sim's
 * answer instead of recomputing "would this boarding finish the goal?"
 * from `satisfied`/`total` — one completion rule, in mission_ship_state.
 */
export function boardShipDoneStatus(input: {
    /** The boarded hull's MissionShipComponent, if it has one. */
    missionShip: MissionShip | undefined,
    /** Entity uuid of the LOCAL player's ship. */
    playerUuid: string,
    /** The owner's objective for `missionShip.mission`, if any. */
    objective: ShipObjective | undefined,
    /** Entity uuid of the boarded hull. */
    targetUuid: string,
    /** Whether the mission's ShipDoneText is non-empty; undefined while
     * the mission data is still loading. */
    hasText: boolean | undefined,
}): ShipDoneBoardStatus {
    const { missionShip, objective, targetUuid } = input;
    // An aux ship is mission atmosphere, never part of the goal
    // (MissionShipType.aux), and another player's special ship is
    // another player's business.
    if (!missionShip || missionShip.aux
        || missionShip.owner !== input.playerUuid) {
        return 'none';
    }
    if (!objective) {
        return 'none';
    }
    if (objective.goal !== GOAL_BOARD && objective.goal !== GOAL_RESCUE) {
        return 'none';
    }
    if (input.hasText === false) {
        return 'none';
    }
    if (input.hasText === undefined) {
        return 'wait';
    }
    if (objective.shipDonePending) {
        return 'show';
    }
    if (objective.complete || objective.failed) {
        // Settled already (an earlier ship finished it, or the goal has
        // become unachievable): this boarding has no text of its own.
        return 'none';
    }
    if (objective.live.get(targetUuid)?.boarded) {
        // Credited, and the goal is still outstanding — so this boarding
        // was not the one that completes it.
        return 'none';
    }
    return 'wait';
}

/** The cached "does this mission have a ShipDoneText" answer, kicking off
 * the lookup the first time it is asked for. */
function shipDoneTextKnown(state: ShipDoneState, universe: MissionUniverse,
    missionId: string): boolean | undefined {
    if (!state.missions.has(missionId)) {
        // May fill the cache synchronously (an already-loaded universe),
        // so the answer is re-read rather than assumed absent.
        loadMission(state, universe, missionId);
    }
    const cached = state.missions.get(missionId);
    if (cached === undefined) {
        return undefined;
    }
    return cached === null ? false : !!cached.shipDoneText.trim();
}

/** Populates `state.missions` for one mission id, once. */
function loadMission(state: ShipDoneState, universe: MissionUniverse,
    missionId: string): void {
    if (state.missions.has(missionId) || state.loading.has(missionId)) {
        return;
    }
    // The ordinary case: the universe is long since loaded (the mission
    // was accepted at a spaceport, which loads it), so the answer is
    // available on the spot and the boarding dialog never has to wait.
    const loaded = universe.getMission(missionId);
    if (loaded) {
        state.missions.set(missionId, loaded);
        return;
    }
    state.loading.add(missionId);
    void universe.load().then(() => {
        state.missions.set(missionId,
            universe.getMission(missionId) ?? null);
    }).catch(() => {
        state.missions.set(missionId, null);
    }).finally(() => {
        state.loading.delete(missionId);
    });
}

/**
 * The boarding dialog's view of `boardShipDoneStatus`, resolved against
 * the display world. Synchronous — it is called every frame from
 * BoardingUi.update — with the one asynchronous part (the mission data)
 * behind the cache above.
 */
export function boardShipDoneStatusOf(world: World,
    targetUuid: string): ShipDoneBoardStatus {
    const state = world.resources.get(ShipDoneStateResource);
    const gameData = world.resources.get(SimulationGameDataResource);
    const player = getPlayerShip(world);
    const target = world.entities.get(targetUuid);
    if (!state || !gameData || !player || !target) {
        return 'none';
    }
    const missionShip = target.components.get(MissionShipComponent);
    if (!missionShip) {
        return 'none';
    }
    const objective = player.entity.components.get(MissionsComponent)
        ?.get(missionShip.mission)?.shipObjective;
    return boardShipDoneStatus({
        missionShip, playerUuid: player.uuid, objective, targetUuid,
        hasText: shipDoneTextKnown(state,
            MissionUniverse.shared(gameData), missionShip.mission),
    });
}

/**
 * Presents the ShipDoneText of the mission whose special ship
 * `targetUuid` is, for the boarding dialog. Returns whether a text was
 * actually shown — the boarding ends only when one was.
 */
export function presentBoardShipDone(world: World,
    targetUuid: string): Promise<boolean> {
    const missionId = world.entities.get(targetUuid)
        ?.components.get(MissionShipComponent)?.mission;
    if (!missionId) {
        return Promise.resolve(false);
    }
    return presentShipDoneText(world, missionId);
}

/**
 * Puts one mission's ShipDoneText on screen, once. Resolves TRUE when a
 * text was shown and the player dismissed it, FALSE when there was
 * nothing to show (no such mission, an empty ShipDoneText, or it has
 * already been presented in this display world).
 *
 * The text is expanded exactly as every other mission dësc is: the dësc
 * conditional blocks against the player's real bits and gender, then the
 * wildcards — <SN> (the special ship's own name, frozen on the mission at
 * accept), <DST>/<RST>, <CT>/<CQ>, <DL>, <PAY>, and the player-identity
 * tags. The mission is ACTIVE here, so unlike the landing popups (which
 * see a mission already removed from the player's list) every tag has a
 * real value to take.
 */
export async function presentShipDoneText(world: World,
    missionId: string): Promise<boolean> {
    const state = world.resources.get(ShipDoneStateResource);
    const popup = world.resources.get(ShipDonePopupResource);
    const gameData = world.resources.get(SimulationGameDataResource);
    const player = getPlayerShip(world)?.entity;
    if (!state || !popup || !gameData || !player) {
        return false;
    }
    // The once-guard, taken BEFORE the first await: `update` and the
    // sweep below both run every frame, and an unguarded second entrant
    // would stack a second popup behind the first.
    if (state.shown.has(missionId)) {
        return false;
    }
    const active = player.components.get(MissionsComponent)?.get(missionId);
    if (!active) {
        return false;
    }
    state.shown.add(missionId);

    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    const mission = universe.getMission(missionId);
    if (!mission || !mission.shipDoneText.trim()) {
        return false;
    }
    const date = player.components.get(GameDateComponent);
    const offer = activeAsOffer(universe, active);
    const identity = await playerIdentitySubs(universe,
        player.components.get(ShipComponent)?.id, undefined,
        player.components.get(ActiveRanksComponent));
    const text = expandMissionText(mission.shipDoneText, {
        ...(offer ? offerSubstitutions(universe,
            date ? dayNumber(date) : 0, offer, active) : {}),
        ...identity,
    }, makeDescTextContext(
        player.components.get(ControlBitsComponent) ?? new Set(),
        playerGender()));

    // Marked BEFORE the popup is awaited: the player may jump or land
    // with it still up, and the date advance that follows must already
    // know not to queue the same text again.
    markShipDoneTextShown(missionId);
    await popup.show(text, { accept: 'Okay' },
        { pict: mission.shipDonePict, style: 'briefing' });
    return true;
}

/**
 * Sweeps the local player's missions for ship goals the simulation has
 * just completed and shows their ShipDoneText.
 *
 * BOARD AND RESCUE GOALS ARE SKIPPED — boarding_plugin presents those, in
 * place of the plunder dialog (see the module note). Sorted by mission
 * id so two goals completing on the same frame queue in a stable order.
 */
const MissionShipDoneSystem = new System({
    name: 'MissionShipDoneSystem',
    args: [ShipDoneStateResource, SimulationGameDataResource,
        PlayerShipSelector, MissionsComponent, GetWorld] as const,
    step(state, gameData, _player, missions, world) {
        const universe = MissionUniverse.shared(gameData);
        const due: string[] = [];
        for (const [missionId, active] of missions) {
            const objective = active.shipObjective;
            if (!objective) {
                continue;
            }
            // Warm the cache for every mission with special ships, so
            // the boarding dialog's synchronous status has an answer by
            // the time a hull is actually boarded.
            const hasText = shipDoneTextKnown(state, universe, missionId);
            if (!objective.shipDonePending || hasText !== true
                || state.shown.has(missionId)
                || objective.goal === GOAL_BOARD
                || objective.goal === GOAL_RESCUE) {
                continue;
            }
            due.push(missionId);
        }
        due.sort();
        for (const missionId of due) {
            void presentShipDoneText(world, missionId).catch(e => {
                console.warn('Mission ship-done text failed:', e);
            });
        }
    },
});

export const MissionShipDonePlugin: Plugin = {
    name: 'MissionShipDonePlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        const controls = world.resources.get(ControlsSubject);
        const stage = world.resources.get(Stage);
        const screenSize = world.resources.get(ScreenSize);
        if (!displayAssets || !controls || !stage || !screenSize) {
            throw new Error(
                'MissionShipDonePlugin missing a required resource');
        }
        const popup = new OfferPopup(displayAssets, controls);
        popup.container.name = 'ShipDonePopup';
        popup.container.position.set(screenSize.x / 2, screenSize.y / 2);
        stage.addChild(popup.container);
        world.resources.set(ShipDonePopupResource, popup);
        world.resources.set(ShipDoneStateResource, {
            shown: new Set(), missions: new Map(), loading: new Set(),
        });
        world.addSystem(MissionShipDoneSystem);
    },
    remove(world) {
        world.removeSystem(MissionShipDoneSystem);
        const stage = world.resources.get(Stage);
        const popup = world.resources.get(ShipDonePopupResource);
        if (stage && popup) {
            stage.removeChild(popup.container);
        }
        world.resources.delete(ShipDonePopupResource);
        world.resources.delete(ShipDoneStateResource);
    },
};
