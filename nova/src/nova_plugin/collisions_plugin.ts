import { ConvexHulls } from "novadatainterface/SpriteSheetData";
import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { ProvideAsync } from "nova_ecs/provider";
import { System } from "nova_ecs/system";
import { FirstAnimation } from "./animation_plugin";
import { GameDataResource } from "./game_data_resource";

export const HullComponent = new Component<{
    hulls: ConvexHulls,
}>('HullComponent');

export const HullProvider = ProvideAsync({
    provided: HullComponent,
    args: [FirstAnimation, GameDataResource] as const,
    async factory(animation, gameData) {
        const spriteSheet = await gameData.data.SpriteSheet
            .get(animation.images.baseImage.id);
        animation.images.baseImage.frames
        return {
            hulls: spriteSheet.convexHulls
        }
    }
});

const CollisionSystem = new System({
    name: "CollisionSystem",
    args: [HullProvider, MovementStateComponent] as const,
    step(_hull, _movement) {

    }
});



export const CollisionsPlugin: Plugin = {
    name: 'CollisionsPlugin',
    build(world) {
        world.addComponent(HullComponent);
        world.addSystem(CollisionSystem);
    }
};
