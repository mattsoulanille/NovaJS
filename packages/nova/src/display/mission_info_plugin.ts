import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { World } from 'nova_ecs/world';
import { Subscription } from 'rxjs';
import {
    ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/core/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import type { LandedTransaction } from '../spaceport/landed_transaction.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { MissionInfoDialog } from '../spaceport/mission_info.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { ScreenSize, screenCentre } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { BEEP_MISSION_CLOSE, BEEP_MISSION_OPEN, playUiSound } from './ui_sound.js';

const MissionInfoResource = new Resource<MissionInfoDialog>('MissionInfo');
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
            opening = true;
            try {
                // Re-adding moves the dialog to the top of the stage, so
                // it opens over the spaceport (whose container is added
                // after this plugin's).
                stage.addChild(dialog.container);
                dialog.container.position.set(
                    screenCentre(screenSize).x, screenCentre(screenSize).y);
                playUiSound(world, { id: BEEP_MISSION_OPEN });
                await dialog.show(ship, planetId
                    ? { gameData: simulationData, planetId, transaction }
                    : undefined);
            } finally {
                opening = false;
                // dialog.show resolves when the dialog closes.
                playUiSound(world, { id: BEEP_MISSION_CLOSE });
            }
        };
        world.resources.set(OpenMissionInfoResource, openMissionInfo);
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
                void openMissionInfo();
            }));
    },
    remove(world) {
        world.resources.get(MissionInfoControlsSubscription)?.unsubscribe();
        const stage = world.resources.get(Stage);
        const dialog = world.resources.get(MissionInfoResource);
        // Release the keyboard if the dialog is still open while its world
        // is torn down (jumped with it up); see Menu.dismiss.
        dialog?.dismiss();
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
