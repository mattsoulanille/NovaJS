import { StatusBarData } from "novadatainterface/status_bar_data";
import { Optional } from "nova_ecs/optional";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { displayName } from "../nova_plugin/core/display_name.js";
import { SimulationGameDataResource } from "../nova_plugin/core/game_data_resource.js";
import { OutfitsStateComponent } from "../nova_plugin/ship/outfit_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import { ActiveSecondaryWeapon, countAmmo } from "../nova_plugin/combat/weapon_plugin.js";
import { StatusBarFonts } from "./status_bar_layout.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { DrawStatusBarStats } from "./status_bar_gauges.js";

/**
 * The secondary-weapon readout: the weapon's name (and ammo count) in
 * bright text, or a dim "No Secondary Weapon".
 */
export class WeaponPane {
    /** Per-build; undefined between an ïntf reload's teardown and rebuild. */
    private texts?: { noWeapon: PIXI.Text, weapon: PIXI.Text };
    private lastSecondary: string | null | undefined;

    build(parent: PIXI.Container, data: StatusBarData, fonts: StatusBarFonts) {
        const container = new PIXI.Container();
        parent.addChild(container);
        container.position.x = data.dataAreas.weapons.position[0];
        container.position.y = data.dataAreas.weapons.position[1];

        const noWeapon = new PIXI.Text("No Secondary Weapon", fonts.dim);
        noWeapon.anchor.x = 0.5;
        noWeapon.anchor.y = 0.5;
        noWeapon.position.x = data.dataAreas.weapons.size[0] / 2;
        noWeapon.position.y = data.dataAreas.weapons.size[1] / 2;
        container.addChild(noWeapon);

        const weapon = new PIXI.Text("", fonts.bright);
        weapon.anchor.x = 0.5;
        weapon.anchor.y = 0.5;
        weapon.position.x = data.dataAreas.weapons.size[0] / 2;
        weapon.position.y = data.dataAreas.weapons.size[1] / 2;
        container.addChild(weapon);

        this.texts = { noWeapon, weapon };
    }

    /**
     * Destroys this build's texts (each owns a canvas texture) ahead of a
     * rebuild; the container they sat in is destroyed by StatusBar.reload
     * with the rest of the outgoing tree.
     */
    reset() {
        for (const text of Object.values(this.texts ?? {})) {
            text.destroy();
        }
        this.texts = undefined;
        this.lastSecondary = undefined;
    }

    destroy() {
        for (const text of Object.values(this.texts ?? {})) {
            if (!text.destroyed) {
                text.destroy();
            }
        }
        this.texts = undefined;
    }

    drawSecondary(name: string | null | undefined) {
        if (!this.texts || name === this.lastSecondary) {
            return;
        }
        this.lastSecondary = name;
        if (name) {
            this.texts.weapon.text = name;
            this.texts.weapon.visible = true;
            this.texts.noWeapon.visible = false;
        } else {
            this.texts.weapon.visible = false;
            this.texts.noWeapon.visible = true;
        }
    }
}

// Runs every step (not just on ChangeSecondaryEvent) so the ammo count
// updates as the weapon fires. drawSecondary ignores unchanged text.
export const DrawStatusBarSecondaryWeapon = new System({
    name: 'DrawStatusBarSecondaryWeapon',
    args: [StatusBarResource, ActiveSecondaryWeapon,
        Optional(OutfitsStateComponent), SimulationGameDataResource,
        PlayerShipSelector] as const,
    step(statusBar, activeSecondary, outfits, gameData) {
        if (!activeSecondary.secondary) {
            statusBar.weapon.drawSecondary(null);
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
            statusBar.weapon.drawSecondary(
                `${weaponName} - ${countAmmo(ammoType[1], outfits, gameData)}`);
        } else {
            statusBar.weapon.drawSecondary(weaponName);
        }
    },
    // #156 pin (shared: ShipControl, StatusBar): StatusBarPlugin's
    // registration order.
    after: [DrawStatusBarStats],
});
