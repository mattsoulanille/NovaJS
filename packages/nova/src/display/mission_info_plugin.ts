import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { World } from 'nova_ecs/world';
import { Subscription } from 'rxjs';
import {
    ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource,
    SystemIdResource,
} from '../nova_plugin/core/index.js';
import type { AbortedMission } from '../nova_plugin/missions/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import type { LandedTransaction } from '../spaceport/landed_transaction.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import {
    listedMissions, MissionInfoDialog, NO_MISSIONS, NO_MISSIONS_STRING_INDEX,
    NO_MISSIONS_STRING_TABLE,
} from '../spaceport/mission_info.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { buildMissionAbort } from '../spaceport/ship_mission_accept.js';
import {
    keepCentred, ScreenSize, stopCentring,
} from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { showStatusMessage } from './status_message_plugin.js';
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
 * Opens the mission-info dialog ('i') over whatever is on screen and
 * resolves when it closes. Landed menus (the spaceport) call this for
 * their 'missions' key, passing the docked ship entity — while docked
 * the player's entity is out of the world (the spaceport holds it), so
 * it can't be looked up — and the landing's transaction, which the
 * dialog's Abort edits. In flight the plugin's own subscription below
 * opens it for the world's player ship. No-ops while already open.
 */
export const OpenMissionInfoResource =
    new Resource<(entity?: Entity, planetId?: string,
        transaction?: LandedTransaction) => Promise<void>>('OpenMissionInfo');

function getPlayerShip(world: World) {
    for (const entity of world.entities.values()) {
        if (entity.components.has(PlayerShipSelector)) {
            return entity;
        }
    }
    return undefined;
}

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
        // A planetId marks a DOCKED open: it enables the functional
        // Abort button (session-backed, spaceport commit pattern).
        const openMissionInfo = async (entity?: Entity,
            planetId?: string, transaction?: LandedTransaction):
            Promise<void> => {
            if (dialog.container.visible || opening) {
                return;
            }
            const ship = entity ?? getPlayerShip(world);
            if (!ship) {
                return;
            }
            // In flight (no planetId) Abort goes through the simulation:
            // resolved against the CURRENT mirror of the player, as the
            // abort is clicked, and sent as an input record.
            const inFlightAbort = async (missionId: string) => {
                const player = getPlayerShip(world);
                if (!player) {
                    return false;
                }
                const abort = await buildMissionAbort(player, missionId,
                    simulationData, universe,
                    { systemId: world.resources.get(SystemIdResource) });
                if (!abort) {
                    return false;
                }
                world.emit(AbortMissionEvent, { record: abort.record });
                return true;
            };
            opening = true;
            try {
                // Re-adding moves the dialog to the top of the stage, so
                // it opens over the spaceport (whose container is added
                // after this plugin's).
                stage.addChild(dialog.container);
                playUiSound(world, { id: BEEP_MISSION_OPEN });
                await dialog.show(ship, planetId
                    ? { gameData: simulationData, planetId, transaction }
                    : inFlightAbort);
            } finally {
                opening = false;
                // dialog.show resolves when the dialog closes.
                playUiSound(world, { id: BEEP_MISSION_CLOSE });
            }
        };
        world.resources.set(OpenMissionInfoResource, openMissionInfo);
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
            await openMissionInfo();
        };
        world.resources.set(MissionInfoControlsSubscription,
            controls.subscribe(({ action, state }) => {
                if (action !== 'missions' || state !== 'start') {
                    return;
                }
                // While a landed menu owns the keyboard, 'i' belongs to
                // that menu (the spaceport opens the dialog itself;
                // deeper screens reserve the key but don't act on it).
                if (MenuControls.focused) {
                    return;
                }
                void openInFlight();
            }));
    },
    remove(world) {
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
