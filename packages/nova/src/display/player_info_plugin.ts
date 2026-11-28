import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { World } from 'nova_ecs/world';
import { Subscription } from 'rxjs';
import {
    ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource, SystemIdResource,
} from '../nova_plugin/core/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { PlayerInfoDialog, PlayerInfoJettison } from '../spaceport/player_info.js';
import { getActivePilot } from '../title/pilot_registry.js';
import {
    keepCentred, ScreenSize, stopCentring,
} from './screen_size_plugin.js';
import { flightOverlays } from './flight_overlays.js';
import { Stage } from './stage_resource.js';

export const PlayerInfoResource = new Resource<PlayerInfoDialog>('PlayerInfo');
/**
 * An in-flight Jettison Cargo the player confirmed, on its way to the
 * simulation bridge (game_session.ts -> bridge.jettisonCargo): the
 * `jettisonCargo` input record (nova_plugin/ship/jettison_cargo.ts).
 */
export const JettisonCargoRequestEvent =
    new EcsEvent<true>('JettisonCargoRequestEvent');
const PlayerInfoControlsSubscription =
    new Resource<Subscription>('PlayerInfoControlsSubscription');
/**
 * Opens the player-info dialog ('p') over whatever is on screen and
 * resolves when it closes. Landed menus (the spaceport) call this for
 * their 'properties' key, passing the docked ship entity — while
 * docked the player's entity is out of the world (the spaceport holds
 * it), so it can't be looked up — and the Jettison Cargo action that
 * edits the landing's working copy. In flight the plugin's own
 * subscription below opens it for the world's player ship, whose
 * jettison is the `jettisonCargo` input record. No-ops while the dialog
 * is already open.
 */
export const OpenPlayerInfoResource =
    new Resource<(entity?: Entity, jettison?: PlayerInfoJettison) => Promise<void>>(
        'OpenPlayerInfo');

function getPlayerShip(world: World) {
    for (const entity of world.entities.values()) {
        if (entity.components.has(PlayerShipSelector)) {
            return entity;
        }
    }
    return undefined;
}

export const PlayerInfoPlugin: Plugin = {
    name: 'PlayerInfoPlugin',
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

        const dialog = new PlayerInfoDialog(displayAssets, simulationData,
            controls, () => world.resources.get(SystemIdResource),
            () => screenSize);
        // A pilot whose profile has no name (a pre-title-screen save
        // adopted as "Pilot", say) shows its pilot-list label there rather
        // than nothing; nothing is written anywhere for it.
        dialog.pilotLabel = () => getActivePilot()?.name;
        let opening = false;
        stage.addChild(dialog.container);
        // Centred on the live UI size, and kept there through resizes
        // while open (CentredUiResource).
        keepCentred(world, dialog.container);
        world.resources.set(PlayerInfoResource, dialog);
        // In flight, Jettison Cargo goes through the simulation.
        const jettisonInFlight: PlayerInfoJettison = () => {
            world.emit(JettisonCargoRequestEvent, true);
            return true;
        };
        const openPlayerInfo = async (entity?: Entity,
            jettison?: PlayerInfoJettison): Promise<void> => {
            if (dialog.container.visible || opening) {
                return;
            }
            const ship = entity ?? getPlayerShip(world);
            if (!ship) {
                return;
            }
            opening = true;
            try {
                // Re-adding moves the dialog to the top of the stage,
                // so it opens over the spaceport (whose container is
                // added after this plugin's).
                stage.addChild(dialog.container);
                await dialog.show(ship,
                    entity ? jettison : jettisonInFlight);
            } finally {
                opening = false;
            }
        };
        world.resources.set(OpenPlayerInfoResource, openPlayerInfo);
        world.resources.set(PlayerInfoControlsSubscription,
            controls.subscribe(({ action, state }) => {
                if (action !== 'properties' || state !== 'start') {
                    return;
                }
                // While a landed menu owns the keyboard, 'p' belongs
                // to that menu (the spaceport opens the dialog itself;
                // deeper screens reserve the key but don't act on it).
                if (MenuControls.focused) {
                    return;
                }
                void openPlayerInfo();
            }));
        // Docking closes it, its Jettison confirmation with it
        // (display/flight_overlays.ts): opened in flight it shows the
        // in-world ship and jettisons through the simulation.
        flightOverlays(world).register('player info',
            () => dialog.dismiss());
    },
    remove(world) {
        flightOverlays(world).unregister('player info');
        world.resources.get(PlayerInfoControlsSubscription)?.unsubscribe();
        const stage = world.resources.get(Stage);
        const dialog = world.resources.get(PlayerInfoResource);
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
        world.resources.delete(PlayerInfoControlsSubscription);
        world.resources.delete(PlayerInfoResource);
        world.resources.delete(OpenPlayerInfoResource);
    }
}
