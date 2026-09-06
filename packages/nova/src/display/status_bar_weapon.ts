import { Optional } from "nova_ecs/optional";
import { System } from "nova_ecs/system";
import { displayName } from "../nova_plugin/display_name.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { OutfitsStateComponent } from "../nova_plugin/outfit_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { ActiveSecondaryWeapon, countAmmo } from "../nova_plugin/weapon_plugin.js";
import { StatusBarResource } from "./status_bar_resource.js";

// Runs every step (not just on ChangeSecondaryEvent) so the ammo count
// updates as the weapon fires. drawSecondary ignores unchanged text.
export const DrawStatusBarSecondaryWeapon = new System({
    name: 'DrawStatusBarSecondaryWeapon',
    args: [StatusBarResource, ActiveSecondaryWeapon,
        Optional(OutfitsStateComponent), SimulationGameDataResource,
        PlayerShipSelector] as const,
    step(statusBar, activeSecondary, outfits, gameData) {
        if (!activeSecondary.secondary) {
            statusBar.drawSecondary(null);
            return;
        }
        const weapon = gameData.data.Weapon.getCached(activeSecondary.secondary);
        if (!weapon) {
            // Not cached yet; getCached kicked off the load.
            return;
        }
        const { ammoType } = weapon;
        // Strip the "; note" author suffix ("Wraith Cannon;fire whilst
        // cloaked" -> "Wraith Cannon") the original never shows.
        const weaponName = displayName(weapon.name);
        if (outfits && ammoType instanceof Array && ammoType[0] === 'weapon') {
            // "Weapon Name - 37"; weapons without ammo show the bare name.
            statusBar.drawSecondary(
                `${weaponName} - ${countAmmo(ammoType[1], outfits, gameData)}`);
        } else {
            statusBar.drawSecondary(weaponName);
        }
    }
});
