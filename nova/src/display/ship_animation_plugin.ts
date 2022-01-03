import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Provide } from "nova_ecs/provider";
import { System } from "nova_ecs/system";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { IonizationColorComponent } from "../nova_plugin/health_plugin";
import { IsIonizedComponent } from "../nova_plugin/ionization_plugin";
import { ShipComponent } from "../nova_plugin/ship_plugin";
import { WeaponsStateComponent } from "../nova_plugin/weapons_state";
import { AnimationGraphicComponent } from "./animation_graphic_plugin";
import * as PIXI from "pixi.js";
import { ColorMatrixFilter } from '@pixi/filter-color-matrix';

const IonizationTintComponent = new Component<ColorMatrixFilter>('IonizationTintComponent');
const IonizationTintProvider = Provide({
    name: 'IonizationTintProvider',
    provided: IonizationTintComponent,
    args: [AnimationGraphicComponent] as const,
    update: [AnimationGraphicComponent],
    factory(graphic) {
        const filter = new PIXI.filters.ColorMatrixFilter();
        graphic.container.filters = [filter];
        return filter;
    }
});

export const ShipAnimationSystem = new System({
    name: "ShipAnimationSystem",
    args: [ShipComponent, WeaponsStateComponent, GameDataResource, AnimationGraphicComponent, TimeResource, IsIonizedComponent, IonizationColorComponent, IonizationTintComponent] as const,
    step(ship, weaponStates, gameData, animation, time, ionized, ionizationColor, tintFilter) {
        // For now, always hide the ship's shield.
        // TODO: Blink this when hit.
        const shield = animation.sprites.get('shieldImage');
        if (shield) {
            shield.pixiSprite.visible = false;
        }

        // Show the ship's weapon image iff a weapon is firing.
        const weaponImage = animation.sprites.get('weapImage');
        if (weaponImage) {
            weaponImage.pixiSprite.visible = false;
            for (const [id, weaponState] of weaponStates) {
                if (weaponState.firing && gameData.data.Weapon.getCached(id)?.useFiringAnimation) {
                    weaponImage.pixiSprite.visible = true;
                    break;
                }
            }
        }

        // Blink running lights every two seconds.
        const runningLights = animation.sprites.get('lightImage');
        if (runningLights) {
            runningLights.pixiSprite.visible = time.time % 2000 < 1000;
        }

        if (ionized) {
            const rgb = PIXI.utils.hex2rgb(ionizationColor.color);
            const normalShifted = rgb.map(a => 2 * a + 1);
            tintFilter.matrix[0] = normalShifted[0];
            tintFilter.matrix[6] = normalShifted[1];
            tintFilter.matrix[12] = normalShifted[2];
            tintFilter.enabled = true;
        } else {
            tintFilter.enabled = false;
        }
    },
});

export const ShipAnimationPlugin: Plugin = {
    name: "ShipAnimationPlugin",
    build(world) {
        world.addSystem(ShipAnimationSystem);
        world.addSystem(IonizationTintProvider);
    }
}
