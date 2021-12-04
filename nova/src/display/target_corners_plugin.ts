import { Entities } from "nova_ecs/arg_types";
import { Plugin } from 'nova_ecs/plugin';
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { GameData } from "../client/gamedata/GameData";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin";
import { TargetComponent } from "../nova_plugin/target_component";
import { mod } from "../util/mod";
import { AnimationGraphicComponent, ObjectDrawSystem } from "./animation_graphic_plugin";
import { Space } from "./space_resource";


const NUM_CORNERS = 4;
const TIME_TO_TARGET = 100; // milliseconds

export class TargetCorners {
    private targetTime = 0;
    targetUuid?: string;
    container = new PIXI.Container();
    private sprites: PIXI.Sprite[] = [];
    private textures = new Map<string, PIXI.Texture>();
    built: Promise<void>;

    constructor(gameData: GameData, id = 'targetCorners') {
        this.visible = false;
        this.container.zIndex = 1000;
        this.built = this.build(gameData, id);

        for (let i = 0; i < NUM_CORNERS; i++) {
            const sprite = new PIXI.Sprite();

            // The texture we have is the top left corner of a square. Unrotate it by
            // adding pi/4. Then re-rotate it by subtracting pi/NUM_CORNERS.
            // Except the correction is flipped because the coordinate system is.
            sprite.rotation = mod(i * 2 * Math.PI / NUM_CORNERS
                - Math.PI / 4 + Math.PI / NUM_CORNERS
                + Math.PI, 2 * Math.PI);
            this.container.addChild(sprite);
            this.sprites.push(sprite);
        }
    }

    private async build(gameData: GameData, id: string) {
        const targetCornersData = await gameData.data.TargetCorners.get(id);

        for (const [cornerName, imageId] of Object.entries(targetCornersData.images)) {
            const texture = await gameData.textureFromCicn(imageId);
            this.textures.set(cornerName, texture);
        }
        this.setStyle("neutral");
    }

    setPosition({ x, y }: { x: number, y: number }) {
        this.container.position.x = x;
        this.container.position.y = y;
    }

    get visible() {
        return this.container.visible;
    }

    set visible(v: boolean) {
        this.container.visible = v;
    }

    setStyle(style: string) {
        const texture = this.textures.get(style);
        if (texture) {
            for (const sprite of this.sprites) {
                sprite.texture = texture;
            }
        }
    }

    step(time: number, targetUuid: string | undefined,
        targetSize: { x: number, y: number }) {

        if (targetUuid !== this.targetUuid) {
            this.targetUuid = targetUuid;
            this.targetTime = time;
        }

        const timeSinceStart = time - this.targetTime;
        const timeLeft = Math.max(0, TIME_TO_TARGET - timeSinceStart)
        const scale = 1 + timeLeft / 20;

        for (let i = 0; i < NUM_CORNERS; i++) {
            const sprite = this.sprites[i];
            const angle = mod((i * 2 * Math.PI / NUM_CORNERS)
                + (Math.PI / NUM_CORNERS), 2 * Math.PI);
            sprite.position.x = Math.cos(angle) * targetSize.x / 2 * scale;
            sprite.position.y = Math.sin(angle) * targetSize.y / 2 * scale;
        }
    }
}

const TargetCornersResource = new Resource<TargetCorners>('TargetCornersResource');

const DrawTargetCornersSystem = new System({
    name: "DrawTargetCornersSystem",
    args: [TargetComponent, TimeResource, TargetCornersResource, Entities,
        PlayerShipSelector] as const,
    step({ target }, time, targetCorners, entities) {
        if (!target) {
            targetCorners.visible = false;
            targetCorners.targetUuid = undefined;
            return;
        }

        const targetGraphic = entities.get(target)?.components
            .get(AnimationGraphicComponent);
        if (!targetGraphic) {
            targetCorners.visible = false;
            targetCorners.targetUuid = undefined;
            return;
        }

        targetCorners.step(time.time, target, targetGraphic.size);
        targetCorners.setPosition(targetGraphic.container.position);
        targetCorners.visible = true;
    },
    after: [ObjectDrawSystem],
});

export const TargetCornersPlugin: Plugin = {
    name: 'TargetCornersPlugin',
    build(world) {
        const gameData = world.resources.get(GameDataResource);
        if (!gameData) {
            throw new Error('Expected world to have gameData');
        }

        const space = world.resources.get(Space);
        if (!space) {
            throw new Error('Expected world to have Space resource');
        }

        const targetCorners = new TargetCorners(gameData as GameData);
        space.addChild(targetCorners.container);
        world.resources.set(TargetCornersResource, targetCorners);
        world.addSystem(DrawTargetCornersSystem);
    },
    remove(world) {
        world.removeSystem(DrawTargetCornersSystem);
        const space = world.resources.get(Space);
        const targetCorners = world.resources.get(TargetCornersResource);
        if (space && targetCorners) {
            space.removeChild(targetCorners.container);
        }
        world.resources.delete(TargetCornersResource);
    }
}
