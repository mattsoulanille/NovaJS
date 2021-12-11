import { Plugin } from "nova_ecs/plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { System } from "nova_ecs/system";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { ShipComponent } from "../nova_plugin/ship_plugin";
import { WeaponsStateComponent } from "../nova_plugin/weapons_state";
import { AnimationGraphicComponent } from "./animation_graphic_plugin";


export const ShipAnimationSystem = new System({
    name: "ShipAnimationSystem",
    args: [ShipComponent, WeaponsStateComponent, GameDataResource, AnimationGraphicComponent, TimeResource] as const,
    step(ship, weaponStates, gameData, animation, time) {
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
    },
});

export const ShipAnimationPlugin: Plugin = {
    name: "ShipAnimationPlugin",
    build(world) {
        world.addSystem(ShipAnimationSystem);
    }
}
