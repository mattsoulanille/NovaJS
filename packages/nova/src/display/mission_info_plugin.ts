import { GetEntity, GetWorld } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { Subscription } from 'rxjs';
import {
    ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource,
    SystemIdResource,
} from '../nova_plugin/core/index.js';
import type { AbortedMission } from '../nova_plugin/missions/index.js';
import {
    MissionsComponent, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import {
    listedMissions, MissionInfoAbort, MissionInfoDialog, NO_MISSIONS,
    NO_MISSIONS_STRING_INDEX, NO_MISSIONS_STRING_TABLE,
} from '../spaceport/mission_info.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import {
    buildDeferredAutoAbort, buildMissionAbort,
} from '../spaceport/ship_mission_accept.js';
import {
    keepCentred, ScreenSize, stopCentring,
} from './screen_size_plugin.js';
import { flightOverlays } from './flight_overlays.js';
import { Stage } from './stage_resource.js';
import { showStatusMessage } from './status_message_plugin.js';
import { presentSetStringRequests } from './set_string_display.js';
import { BEEP_MISSION_CLOSE, BEEP_MISSION_OPEN, playUiSound } from './ui_sound.js';

export const MissionInfoResource = new Resource<MissionInfoDialog>('MissionInfo');
/**
 * A mission the player aborted from the in-flight dialog, on its way to
 * the simulation bridge (game_session.ts -> bridge.abortMission): the
 * `abortMission` input record, resolved here against a detached copy of
 * the player (mission_accept.ts AbortedMissionType).
 */
export const AbortMissionEvent = new EcsEvent<{
    record: AbortedMission,
}>('AbortMissionEvent');
const MissionInfoControlsSubscription =
    new Resource<Subscription>('MissionInfoControlsSubscription');
/**
 * Opens the mission-info dialog over the SPACEPORT (its 'i' key) and
 * resolves when it closes. MEASURED (reference "#324 mission BBS after an
 * accept, wave 21", finding 6): on the original, `i` on the spaceport's
 * main screen opens the mission dialog, and its Abort works there. With
 * nothing to list it does nothing at all — no dialog, no message ("The UI
 * screen x key matrix, wave 11", whose pilots had no missions; the venues
 * ignore `i` either way). While docked the player's entity is out of the
 * world, so the spaceport passes the hull it holds, and the Abort action
 * that edits the landing's working copy (spaceport.ts).
 */
export const OpenMissionInfoResource =
    new Resource<(entity: Entity, abort?: MissionInfoAbort) => Promise<void>>(
        'OpenMissionInfo');
function getPlayerShip(world: World) {
    for (const entity of world.entities.values()) {
        if (entity.components.has(PlayerShipSelector)) {
            return entity;
        }
    }
    return undefined;
}

/**
 * Mission ids whose deferred auto-abort this display world has already
 * sent (DeferredAutoAbortSystem's once-guard).
 */
export const DeferredAutoAbortSentResource =
    new Resource<Set<string>>('DeferredAutoAbortSent');

/**
 * Ends a deferred auto-abort mission (mïsn Flags 0x0001 on a board/rescue
 * goal offered by a përs whose ship the special ship replaced) AT THE
 * BOARD, in flight: the simulation marks it `autoAbortPending` the tick
 * the owner boards the special ship (mission_ship_plugin's
 * rescueBoarded); the owner's display sees the flag on its own mission
 * list and sends the player-local half — OnAbort, the removal,
 * DatePostInc — as an in-flight abort record (buildDeferredAutoAbort),
 * exactly as the 'i' dialog's Abort does. MEASURED (reference "The
 * deferred (përs) auto-abort (R16), wave 43"): one board ended the
 * mission at once ("You have no active missions." seconds later, no
 * landing or jump) and moved the date by its DatePostInc (June 28th ->
 * July 5th), with no dialog ("Target ship has been boarded." only), so
 * the abort's notices are dropped.
 *
 * Player-local: PlayerShipSelector is this client's own ship, so only the
 * owner sends. Once per mission per display world; a duplicate (a rebuilt
 * world before the apply) is a no-op in the apply (the mission must be on
 * the list), and so is a date advance getting there first
 * (runPendingAutoAborts, the fallback).
 */
export const DeferredAutoAbortSystem = new System({
    name: 'DeferredAutoAbortSystem',
    args: [DeferredAutoAbortSentResource, SimulationGameDataResource,
        PlayerShipSelector, MissionsComponent, GetEntity, GetWorld] as const,
    step(sent, gameData, _player, missions, entity, world) {
        for (const [missionId, active] of missions) {
            if (!active.autoAbortPending || sent.has(missionId)) {
                continue;
            }
            sent.add(missionId);
            void buildDeferredAutoAbort(entity, missionId, gameData,
                MissionUniverse.shared(gameData),
                {
                    systemId: world.resources.get(SystemIdResource),
                    displayAssets:
                        world.resources.get(DisplayAssetDataResource),
                })
                .then(async abort => {
                    if (abort) {
                        world.emit(AbortMissionEvent,
                            { record: abort.record });
                        await presentSetStringRequests(world,
                            abort.requests, entity);
                    }
                }).catch(e => {
                    console.warn('Deferred auto-abort failed:', e);
                });
        }
    },
});

export const MissionInfoPlugin: Plugin = {
    name: 'MissionInfoPlugin',
    build(world) {
        const simulationData = world.resources.get(SimulationGameDataResource);
        if (!simulationData) {
            throw new Error('Expected SimulationGameDataResource to exist');
        }
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        if (!displayAssets) {
            throw new Error('Expected DisplayAssetDataResource to exist');
        }
        const controls = world.resources.get(ControlsSubject);
        if (!controls) {
            throw new Error('Expected ControlsSubject to exist');
        }
        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected Stage to exist');
        }
        const screenSize = world.resources.get(ScreenSize);
        if (!screenSize) {
            throw new Error('Expected ScreenSize to exist');
        }

        const universe = MissionUniverse.shared(simulationData);
        void universe.load();
        const dialog = new MissionInfoDialog(displayAssets, universe,
            controls);
        let opening = false;
        stage.addChild(dialog.container);
        // Centred on the live UI size, and kept there through resizes
        // while open (CentredUiResource).
        keepCentred(world, dialog.container);
        world.resources.set(MissionInfoResource, dialog);
        // Abort goes through the simulation: resolved against the CURRENT
        // mirror of the player, as the button is clicked, and sent as an
        // input record (mission_accept.ts AbortedMissionType).
        const abortMission = async (missionId: string) => {
            const player = getPlayerShip(world);
            if (!player) {
                return false;
            }
            const abort = await buildMissionAbort(player, missionId,
                simulationData, universe, {
                    systemId: world.resources.get(SystemIdResource),
                    displayAssets,
                });
            if (!abort) {
                return false;
            }
            world.emit(AbortMissionEvent, { record: abort.record });
            // Its OnAbort's `Qxxx` line and `Pxxx` sound (an `Mxxx` rides
            // the record: arpia's mïsn 1038 OnAbort `... M500 ...`).
            void presentSetStringRequests(world, abort.requests, player);
            return true;
        };
        // Opens the dialog for a ship (in flight the world's player ship;
        // docked the hull the spaceport holds) and resolves when it
        // closes; no-ops while already open.
        const openMissionInfo = async (ship: Entity,
            abort: MissionInfoAbort | undefined): Promise<void> => {
            if (dialog.container.visible || opening) {
                return;
            }
            opening = true;
            try {
                // Re-adding moves the dialog to the top of the stage, over
                // anything added after this plugin.
                stage.addChild(dialog.container);
                playUiSound(world, { id: BEEP_MISSION_OPEN });
                await dialog.show(ship, abort);
            } finally {
                opening = false;
                // dialog.show resolves when the dialog closes.
                playUiSound(world, { id: BEEP_MISSION_CLOSE });
            }
        };
        // The original's in-flight 'i' with nothing to list prints "You have
        // no active missions." on the status line and opens no dialog (the
        // wave-11 UI key matrix; with a mission it opens the dialog). The
        // words are stock STR# 2002's; the built-in copy stands in until
        // they load.
        let noMissions = NO_MISSIONS;
        void displayAssets.data.StringTable.get(NO_MISSIONS_STRING_TABLE)
            .then(table => {
                noMissions = table.strings[NO_MISSIONS_STRING_INDEX]?.trim()
                    || NO_MISSIONS;
            }).catch(() => { /* Keep the stock wording. */ });
        const openInFlight = async () => {
            const ship = getPlayerShip(world);
            if (!ship || dialog.container.visible || opening) {
                return;
            }
            try {
                await universe.load();
            } catch (e) {
                // The dialog copes with an unloaded universe; so does
                // the count (nothing is known to be invisible).
                console.warn('Mission info failed to load universe:', e);
            }
            // Landed (or opened by another path) while the universe
            // loaded: the key no longer belongs to flight.
            if (MenuControls.focused || dialog.container.visible) {
                return;
            }
            if (listedMissions(ship, universe).length === 0) {
                showStatusMessage(world, noMissions);
                return;
            }
            await openMissionInfo(ship, abortMission);
        };
        world.resources.set(OpenMissionInfoResource,
            async (entity: Entity, abort?: MissionInfoAbort) => {
                if (dialog.container.visible || opening) {
                    return;
                }
                try {
                    await universe.load();
                } catch (e) {
                    console.warn('Mission info failed to load universe:', e);
                }
                // Nothing to list: the original's spaceport ignores 'i'.
                if (listedMissions(entity, universe).length === 0) {
                    return;
                }
                await openMissionInfo(entity, abort);
            });
        world.resources.set(MissionInfoControlsSubscription,
            controls.subscribe(({ action, state }) => {
                if (action !== 'missions' || state !== 'start') {
                    return;
                }
                // While a landed menu owns the keyboard, 'i' belongs to
                // that menu: the spaceport opens the dialog itself
                // (OpenMissionInfoResource), the venues ignore it, as the
                // original's do (the wave-11 UI key matrix).
                if (MenuControls.focused) {
                    return;
                }
                void openInFlight();
            }));
        world.resources.set(DeferredAutoAbortSentResource, new Set());
        world.addSystem(DeferredAutoAbortSystem);
        // Docking closes it (display/flight_overlays.ts): opened in flight
        // it shows the in-world ship and aborts through the simulation,
        // neither of which holds once the ship is out of the world.
        flightOverlays(world).register('mission info',
            () => dialog.dismiss());
    },
    remove(world) {
        flightOverlays(world).unregister('mission info');
        world.removeSystem(DeferredAutoAbortSystem);
        world.resources.delete(DeferredAutoAbortSentResource);
        world.resources.get(MissionInfoControlsSubscription)?.unsubscribe();
        const stage = world.resources.get(Stage);
        const dialog = world.resources.get(MissionInfoResource);
        // Release the keyboard if the dialog is still open while its world
        // is torn down (jumped with it up); see Menu.dismiss.
        dialog?.dismiss();
        if (dialog) {
            stopCentring(world, dialog.container);
        }
        if (stage && dialog) {
            stage.removeChild(dialog.container);
        }
        // Destroyed, children included: the dialog is per-world, and its
        // Text canvases and Graphics leaked with every transit (review
        // #40). Sprite textures are the asset cache's and are left alone.
        dialog?.container.destroy({ children: true });
        world.resources.delete(MissionInfoControlsSubscription);
        world.resources.delete(MissionInfoResource);
        world.resources.delete(OpenMissionInfoResource);
    }
}
