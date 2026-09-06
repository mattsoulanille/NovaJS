import { Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Plugin } from 'nova_ecs/plugin';
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { DisplayAssetDataResource, SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { styleForTarget } from "../nova_plugin/hostility.js";
import { TargetCornerStyle } from "../nova_plugin/iff_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { TargetComponent } from "../nova_plugin/target_component.js";
import { mod } from "../util/mod.js";
import { AnimationGraphicComponent, ObjectDrawSystem } from "./animation_graphic_plugin.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { Space } from "./space_resource.js";
import { ZIndex } from "./z_index.js";


const NUM_CORNERS = 4;
const TIME_TO_TARGET = 100; // milliseconds

export class TargetCorners {
    private targetTime = 0;
    targetUuid?: string;
    /**
     * Set by the drawing system on every step it draws these corners, and
     * cleared by the sweep system that runs after it (see
     * cornersSweepSystem). It is how the corners find out the player left
     * the world — landing docks the player's entity OUT of the display
     * world, so the per-entity drawing system simply stops running and the
     * corners would otherwise hang frozen over the target's last position.
     */
    drawnThisStep = false;
    container = new PIXI.Container();
    private sprites: PIXI.Sprite[] = [];
    private textures = new Map<string, PIXI.Texture>();
    built: Promise<void>;

    constructor(displayAssets: DisplayAssetDataInterface, id = 'targetCorners') {
        this.visible = false;
        this.container.zIndex = ZIndex.OVERLAY;
        this.built = this.build(displayAssets, id);

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

    private async build(displayAssets: DisplayAssetDataInterface, id: string) {
        const targetCornersData = await displayAssets.data.TargetCorners.get(id);

        for (const [cornerName, imageId] of Object.entries(targetCornersData.images)) {
            const texture = await displayAssets.textureFromCicn(imageId);
            this.textures.set(cornerName, texture);
        }
        // The world may have been torn down while the cicns loaded; a
        // destroyed sprite must not be handed a texture (it would hang a
        // listener off the shared texture).
        if (this.container.destroyed) {
            return;
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

    setStyle(style: TargetCornerStyle) {
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

/**
 * The corner set for the player's current ship target. THE HOSTILITY
 * RULE now lives in nova_plugin/hostility.ts, because the simulation
 * needs it too (the 'r' key targets the nearest ship this rule calls
 * hostile); re-exported here so display code and the existing specs can
 * keep importing it from where it grew up.
 */
export { styleForTarget };

/**
 * Hides a corner set on any step nothing drew it. The drawing systems are
 * per-entity (they run on the player's ship), so when the player's entity
 * leaves the display world — landing at a spaceport, docking at a gate —
 * they stop running entirely and cannot hide their own corners. The
 * original has no reticle while you are landed and none when you take off
 * again, so a step with no player is a step with no corners.
 */
export function cornersSweepSystem(name: string,
    resource: Resource<TargetCorners>, drawSystem: System): System {
    return new System({
        name,
        args: [resource, SingletonComponent] as const,
        step(corners) {
            if (!corners.drawnThisStep) {
                corners.visible = false;
                corners.targetUuid = undefined;
            }
            corners.drawnThisStep = false;
        },
        after: [drawSystem],
    });
}

const DrawTargetCornersSystem = new System({
    name: "DrawTargetCornersSystem",
    args: [TargetComponent, TimeResource, SimulationTimeResource,
        TargetCornersResource, Entities, UUID, GetEntity,
        SimulationGameDataResource, PlayerShipSelector] as const,
    step({ target }, time, simulationTime, targetCorners, entities, playerUuid,
        playerEntity, gameData) {
        if (!target) {
            targetCorners.visible = false;
            targetCorners.targetUuid = undefined;
            return;
        }

        const targetEntity = entities.get(target);
        const targetGraphic = targetEntity?.components
            .get(AnimationGraphicComponent);
        if (!targetEntity || !targetGraphic) {
            targetCorners.visible = false;
            targetCorners.targetUuid = undefined;
            return;
        }

        targetCorners.setStyle(styleForTarget(target, targetEntity,
            playerUuid, playerEntity, gameData, uuid => entities.get(uuid),
            simulationTime.time));
        targetCorners.step(time.time, target, targetGraphic.size);
        targetCorners.setPosition(targetGraphic.container.position);
        targetCorners.visible = true;
        targetCorners.drawnThisStep = true;
    },
    after: [ObjectDrawSystem],
});

const SweepTargetCornersSystem = cornersSweepSystem('SweepTargetCornersSystem',
    TargetCornersResource, DrawTargetCornersSystem);

export const TargetCornersPlugin: Plugin = {
    name: 'TargetCornersPlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        if (!displayAssets) {
            throw new Error('Expected world to have display assets');
        }

        const space = world.resources.get(Space);
        if (!space) {
            throw new Error('Expected world to have Space resource');
        }

        // The corner rule's aggression tier compares against SIM
        // timestamps, so it reads the mirrored simulation clock rather
        // than this world's wall-clock TimeResource. Seed it so the
        // system can run before the first simulation frame arrives.
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }

        const targetCorners = new TargetCorners(displayAssets);
        space.addChild(targetCorners.container);
        world.resources.set(TargetCornersResource, targetCorners);
        world.addSystem(DrawTargetCornersSystem);
        world.addSystem(SweepTargetCornersSystem);
    },
    remove(world) {
        world.removeSystem(DrawTargetCornersSystem);
        world.removeSystem(SweepTargetCornersSystem);
        // Destroyed, children included: the corner sprites are per-world
        // and leaked with every transit (review #40). Their cicn textures
        // are the asset cache's and are left alone.
        world.resources.get(TargetCornersResource)?.container
            .destroy({ children: true });
        world.resources.delete(TargetCornersResource);
    }
}
