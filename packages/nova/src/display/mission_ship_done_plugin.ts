import { GetWorld } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { MissionData } from 'novadatainterface/mission_data';
import {
    dayNumber, MissionShip, MissionShipComponent, GOAL_BOARD, GOAL_RESCUE, ShipObjective,
    PlayerShipSelector, GameDateComponent, MissionsComponent,
    PlayerNamesComponent,
} from '../nova_plugin/player/index.js';
import {
    ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/core/index.js';
import {
    makeDescTextContext, playerGender, ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb/index.js';
import { expandMissionText } from '../nova_plugin/missions/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import { activeAsOffer, offerSubstitutions } from '../spaceport/mission_offers.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { OfferPopup } from '../spaceport/offer_popup.js';
import { playerIdentitySubs } from '../spaceport/player_identity.js';
import { markShipDoneTextShown } from '../spaceport/ship_done_shown.js';
import {
    keepCentred, ScreenSize, stopCentring,
} from './screen_size_plugin.js';
import { flightOverlays, landedIn } from './flight_overlays.js';
import { Stage } from './stage_resource.js';
import { PersHailQuoteSystem } from "./ship_mission_offer_plugin.js";
import { showStatusMessage } from './status_message_plugin.js';

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
 * A RESCUE goal is that case only for the deferred auto-abort's përs
 * replacement, the one rescue ship still boarded through a plunder
 * session. Every other live rescue ship's board only retrieves its
 * mission cargo — no dialog, as on the original (encounters/
 * rescue_board.ts) — so its text is presented by the sweep below.
 *
 * If the boarding ends before the text is presented (the hulk is
 * destroyed under you, the session is closed from the simulation side),
 * nothing here shows it and the deferred 'shipDone' event still does, at
 * the next landing — the old behaviour, kept as the fallback.
 *
 * ============================================================================
 * OnShipDone RUNS NOW TOO, ON ITS OWN RECORD
 * ============================================================================
 *
 * The Bible runs OnShipDone at the same moment it shows the text, and so
 * does the original (reference "OnShipDone and an in-flight OnFailure,
 * read by a person's hail (the SD / SF leftover), wave 48"). The set
 * string is not this module's: display/mission_set_string_plugin.ts sees
 * the same `shipDonePending` flag, resolves the string and sends it as a
 * `missionSetString` record (missions/mission_set_string_record.ts), whose
 * apply marks the goal `onShipDoneRun` and leaves `shipDonePending` set,
 * so this module's cue and the boarding dialog's 'show' are untouched.
 * Of the stock mïsn set, 76 missions have a non-empty OnShipDone and NONE
 * of them has a ShipDoneText, so the two rarely meet.
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
    /**
     * Whether each of the player's missions' ship goal was already FAILED
     * when this display world first saw it (see MISSION_FAILED_MESSAGE).
     * Only a false -> true change seen here is announced, so a mission
     * that failed in an earlier system (and waits for the landing to run
     * its OnFailure) is not announced again by every display world the
     * player jumps into. Optional so worlds and specs built without it
     * simply never announce.
     */
    failed?: Map<string, boolean>;
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
        player.components.get(ActiveRanksComponent),
        player.components.get(PlayerNamesComponent));
    const bits = player.components.get(ControlBitsComponent) ?? new Set();
    const text = expandMissionText(mission.shipDoneText, {
        ...(offer ? offerSubstitutions(universe,
            date ? dayNumber(date) : 0, offer, bits, active) : {}),
        ...identity,
    }, makeDescTextContext(bits, playerGender()));

    // Marked BEFORE the popup is awaited: the player may jump or land
    // with it still up, and the date advance that follows must already
    // know not to queue the same text again.
    markShipDoneTextShown(missionId);
    await popup.show(text, { accept: 'Okay' },
        { pict: mission.shipDonePict, style: 'briefing' });
    return true;
}

/**
 * The status line the original prints the moment a mission's special-ship
 * goal fails in flight: stock STR# 2002 ("misc strings") index 283,
 * verbatim. Measured for an escort goal whose ship the player disabled
 * (reference "Reviving a disabled ally, wave 11": "Mission failed." at
 * the moment it went Disabled, and `i` then answered "You have no active
 * missions."). The other in-flight goal failures (an escorted ship
 * killed, a disable target destroyed) are announced the same way; they
 * were not measured separately.
 *
 * The mission's OnFailure runs at once too, and the mission leaves the
 * list: display/mission_set_string_plugin.ts sends it as a
 * `missionSetString` record (reference "OnShipDone and an in-flight
 * OnFailure ..., wave 48"); the next landing is only the fallback. Until
 * the record lands the Mission Info list already hides it
 * (spaceport/mission_info.ts).
 */
export const MISSION_FAILED_MESSAGE = 'Mission failed.';

/**
 * Whether a completed goal's ShipDoneText is the boarding dialog's to
 * present (see the module note): a BOARD goal only. No rescue is boarded
 * through a plunder session any more — the cargo retrieval and the
 * deferred auto-abort's board (the Refuel Traders, `autoAbortOnBoard`)
 * both open no dialog at all (encounters/rescue_board.ts) — so a rescue's
 * text is the sweep's like any other goal's (GUESS for a deferred one: no
 * stock deferred rescue has a ShipDoneText).
 */
function boardingPresents(objective: ShipObjective): boolean {
    return objective.goal === GOAL_BOARD;
}

/**
 * Sweeps the local player's missions for ship goals the simulation has
 * just completed and shows their ShipDoneText — and for ship goals it has
 * just FAILED, which get MISSION_FAILED_MESSAGE on the status line.
 *
 * BOARD GOALS (and boarded rescues) ARE SKIPPED — boarding_plugin presents
 * those, in place of the plunder dialog (see the module note and
 * boardingPresents). Sorted by mission id so two goals completing on the
 * same frame queue in a stable order.
 */
export const MissionShipDoneSystem = new System({
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
            if (state.failed) {
                const before = state.failed.get(missionId);
                state.failed.set(missionId, objective.failed);
                if (before === false && objective.failed) {
                    showStatusMessage(world, MISSION_FAILED_MESSAGE);
                }
            }
            // Warm the cache for every mission with special ships, so
            // the boarding dialog's synchronous status has an answer by
            // the time a hull is actually boarded.
            const hasText = shipDoneTextKnown(state, universe, missionId);
            if (!objective.shipDonePending || hasText !== true
                || state.shown.has(missionId)
                || boardingPresents(objective)) {
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
    // #156 pin (shared: *): MissionShipDonePlugin registers after
    // ShipMissionOfferPlugin.
    after: [PersHailQuoteSystem],
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
        // Centred on the live UI size and on every resize, not once here:
        // at build ScreenSize still holds the CSS-pixel seed (see
        // CentredUiResource), which put the popup bottom-right under any
        // UI scale above 1.
        keepCentred(world, popup.container);
        stage.addChild(popup.container);
        world.resources.set(ShipDonePopupResource, popup);
        // Docking withdraws it, unanswered (display/flight_overlays.ts),
        // and so does an open that only gets there once the player has
        // landed.
        popup.withdrawnWhen = () => landedIn(world);
        flightOverlays(world).register('ship-done text', () => popup.withdraw());
        world.resources.set(ShipDoneStateResource, {
            shown: new Set<string>(), missions: new Map(),
            loading: new Set<string>(),
            failed: new Map<string, boolean>(),
        });
        world.addSystem(MissionShipDoneSystem);
    },
    remove(world) {
        flightOverlays(world).unregister('ship-done text');
        world.removeSystem(MissionShipDoneSystem);
        // Destroyed, not just detached: the popup is per-world, and its
        // Text canvases leaked with every system transit (review #40).
        const popup = world.resources.get(ShipDonePopupResource);
        if (popup) {
            stopCentring(world, popup.container);
            popup.destroy();
        }
        world.resources.delete(ShipDonePopupResource);
        world.resources.delete(ShipDoneStateResource);
    },
};
