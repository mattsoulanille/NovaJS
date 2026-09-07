import { System } from "nova_ecs/system";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { DisplayAssetDataResource, SimulationGameDataResource } from "../nova_plugin/core/index.js";
import { PlayerShipSelector } from "../nova_plugin/player/index.js";
import { ShipComponent } from "../nova_plugin/ship/index.js";
import { ResizeEvent, ScreenSize } from "./screen_size_plugin.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { DrawRadar } from "./status_bar_radar.js";
import { DrawStatusBarStats } from "./status_bar_gauges.js";

export const StatusBarResize = new System({
    name: 'StatusBarResize',
    events: [ResizeEvent],
    args: [StatusBarResource, ResizeEvent] as const,
    step({ container }, { x }) {
        // Flush with the right edge. The old `+ 1` pushed the whole bar one
        // pixel right of the original's (which occupies x 1726..1919 at
        // 1920x1080) and cropped its rightmost column off the screen.
        container.position.x = x - container.width;
        container.position.y = 0;
    }
});

/** The civilian status bar (ïntf 128 / PICT 700), used when nothing else picks. */
export const DEFAULT_STATUS_BAR_ID = 'nova:128';

/**
 * Which ïntf resource the status bar should be drawn from while the player
 * flies `shipId`.
 *
 * EVN Bible, gövt section: the Interface field is "ID of an ïntf resource to
 * use when the player is flying a ship whose inherent attributes govt or
 * inherent combat govt is equal to this govt type", and the shïp section gives
 * InherentGovt the three ranges `interfaceGovt` already folds together
 * (novaparse ship_parse). In stock data this is what puts the Federation bar
 * (ïntf 130 / PICT 702) under a Fed Viper and the Polaris one (129 / 701)
 * under a Raven, while the ~93 classes with no inherent government and the
 * governments whose Interface is below 128 keep the default civilian bar.
 *
 * Returns undefined while the ship's or government's data is still loading
 * (getCached kicks the load off), so the caller can simply try again next
 * step rather than flashing the default bar in between.
 */
export function statusBarIdForShip(shipId: string,
    gameData: SimulationGameDataInterface): string | undefined {
    const shipData = gameData.data.Ship.getCached(shipId);
    if (!shipData) {
        return undefined;
    }
    if (!shipData.interfaceGovt) {
        return DEFAULT_STATUS_BAR_ID;
    }
    const govt = gameData.data.Govt.getCached(shipData.interfaceGovt);
    if (!govt) {
        return undefined;
    }
    return govt.statusBar ?? DEFAULT_STATUS_BAR_ID;
}

/**
 * Keeps the bar's ïntf resource in step with the ship the player flies. It
 * runs every step (rather than only at build) because the player's ship class
 * changes at the shipyard, and because the ship/govt data it needs streams in
 * asynchronously — the bar builds from the default interface and swaps to the
 * ship's own as soon as both resources are cached.
 */
export const SelectStatusBarInterface = new System({
    name: 'SelectStatusBarInterface',
    args: [StatusBarResource, ShipComponent, SimulationGameDataResource,
        DisplayAssetDataResource, ScreenSize, PlayerShipSelector] as const,
    step(statusBar, ship, gameData, displayAssets, screen) {
        const wanted = statusBarIdForShip(ship.id, gameData);
        if (wanted === undefined || wanted === statusBar.statusBarId
            || statusBar.reloading) {
            return;
        }
        statusBar.reloading = true;
        void (async () => {
            try {
                await statusBar.reload(
                    await displayAssets.data.StatusBar.get(wanted));
                // A different interface may use a differently sized backdrop.
                statusBar.container.position.x =
                    screen.x - statusBar.container.width;
                statusBar.container.position.y = 0;
            } finally {
                statusBar.reloading = false;
            }
        })();
    },
    // #156 pin (shared: Ship, ShipControl, SimulationGameData, StatusBar):
    // StatusBarPlugin's registration order.
    after: [DrawRadar],
    before: [DrawStatusBarStats],
});
