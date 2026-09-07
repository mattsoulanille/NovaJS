import { Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { AddEvent, DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent, MovementSystem } from "nova_ecs/plugins/movement_plugin";
import { Provide } from "nova_ecs/provide";
import { originalIfDraft, ProvideAsync } from "nova_ecs/provide_async";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { DisplayAssetDataResource } from "../nova_plugin/core/game_data_resource.js";
import { currentIfDraft } from "../util/deimmerify.js";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { AnimationComponent, ExplosionAnimationProvider, TumbleAnimationComponent } from "../nova_plugin/core/animation_plugin.js";
import { AsteroidComponent, DebrisComponent } from "../nova_plugin/combat/asteroid_plugin.js";
import { PlanetComponent } from "../nova_plugin/travel/planet_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import { ProjectileComponent } from "../nova_plugin/core/projectile_data.js";
import { ShipComponent } from "../nova_plugin/ship/ship_plugin.js";
import { wrapNearestDelta } from "nova_ecs/datatypes/position";
import { AnimationGraphic } from "./animation_graphic.js";
import { AnimationGraphicPool, AnimationGraphicPoolResource } from "./animation_graphic_pool.js";
import { CameraFocus, Space } from "./space_resource.js";
import { ZIndex } from "./z_index.js";

export const AnimationGraphicComponent = new Component<AnimationGraphic>('AnimationGraphic');
const AnimationGraphicLoadedComponent = new Component<AnimationGraphic>('AnimationGraphicLoaded');
const AnimationGraphicLoader = ProvideAsync({
    name: "AnimationGraphicLoader",
    provided: AnimationGraphicLoadedComponent,
    args: [AnimationComponent, DisplayAssetDataResource, GetEntity,
        AnimationGraphicPoolResource] as const,
    async factory(animation, displayAssets, entity, poolResource) {
        const pool = originalIfDraft(poolResource);
        const currentAnimation = currentIfDraft(animation)!;

        // Reuse a pooled graphic if one is available. Otherwise, build a
        // new one, which allocates PIXI display objects.
        let graphic = pool.acquire(currentAnimation);
        if (graphic) {
            graphic.reset();
        } else {
            graphic = new AnimationGraphic({
                displayAssets: currentIfDraft(displayAssets)!,
                animation: currentAnimation,
            });
            await graphic.buildPromise;
        }

        // Move the graphic to the entity's position before it becomes
        // visible so a reused graphic does not flash at the position where
        // its previous entity died.
        const movement = entity.components.get(MovementStateComponent);
        if (movement) {
            graphic.container.position.x = movement.position.x;
            graphic.container.position.y = movement.position.y;
            graphic.rotation = movement.rotation.angle;
        }

        // Order sprites. Projectiles are checked FIRST: a shot draws
        // above every ship, the firer's own included, so it is not
        // swallowed by the hull it leaves from (see ZIndex).
        if (entity.components.has(ProjectileComponent)) {
            graphic.container.zIndex = ZIndex.PROJECTILE;
        } else if (entity.components.has(PlayerShipSelector)) {
            graphic.container.zIndex = ZIndex.PLAYER_SHIP;
        } else if (entity.components.has(ShipComponent)) {
            graphic.container.zIndex = ZIndex.SHIP;
        } else if (entity.components.has(AsteroidComponent)) {
            graphic.container.zIndex = ZIndex.ASTEROID;
        } else if (entity.components.has(DebrisComponent)) {
            graphic.container.zIndex = ZIndex.DEBRIS;
        } else if (entity.components.has(PlanetComponent)) {
            graphic.container.zIndex = ZIndex.PLANET;
        }

        return graphic;
    },
    // #156 pin (shared: entity): AnimationGraphicPlugin registers after the
    // core AnimationPlugin.
    after: [ExplosionAnimationProvider],
});

// Attaches a graphic to the space container and makes it visible. Pooled
// graphics stay attached (hidden) to the space container when their entity
// dies, so skip addChild for them to avoid removeChild/addChild splicing.
function attachGraphic(graphic: AnimationGraphic, space: PIXI.Container) {
    if (graphic.container.parent !== space) {
        space.addChild(graphic.container);
    }
    graphic.container.visible = true;
}

// Add the graphic to the PIXI container in a synchronous system. Othewise,
// the check that makes sure the entity is still in the world may be
// invalid.
export const AnimationGraphicProvider = Provide({
    name: "AnimationGraphicProvider",
    provided: AnimationGraphicComponent,
    args: [AnimationGraphicLoadedComponent, Space, Entities, UUID] as const,
    factory(graphic, space, entities, uuid) {
        // Only add the graphic to the container if the entity still exists
        if (entities.has(uuid)) {
            attachGraphic(graphic, space);
        } else {
            console.log(`Not adding graphic for ${uuid} since it is no longer in the system`);
            // The graphic may be a pooled one that is still attached to the
            // space container. Detach it since nothing will clean it up.
            space.removeChild(graphic.container);
        }
        return graphic;
    },
    // #156 pin (shared: *).
    after: [AnimationGraphicLoader],
});

export const ObjectDrawSystem = new System({
    name: "ObjectDrawSystem",
    args: [MovementStateComponent, AnimationGraphicComponent, CameraFocus] as const,
    step: (movementState, graphic, cameraFocus) => {
        if (movementState.turning < 0) {
            graphic.setFramesToUse('left');
        } else if (movementState.turning > 0) {
            graphic.setFramesToUse('right');
        } else {
            graphic.setFramesToUse('normal');
        }

        graphic.glowAlpha = movementState.accelerating *
            (1 - (Math.random() * 0.2));

        // Draw at the toroidal copy of the position nearest the camera, so an
        // object just across the loop boundary (e.g. the Sol wormhole) is
        // drawn on the near side of the seam rather than a world away. The
        // player's own ship (the focus) resolves to its literal position.
        graphic.container.position.x = cameraFocus.x
            + wrapNearestDelta(movementState.position.x - cameraFocus.x);
        graphic.container.position.y = cameraFocus.y
            + wrapNearestDelta(movementState.position.y - cameraFocus.y);
        graphic.rotation = movementState.rotation.angle;
    },
    // AnimationGraphicProvider is a #156 pin (shared: *).
    after: [MovementSystem, AnimationGraphicProvider],
});

/**
 * Draws entities whose sprite frames are a pre-rendered animation (3D
 * asteroid tumbles, spinning weapon graphics) rather than view
 * rotations. Frames advance at TumbleAnimation.frameRate on logical
 * time; the entity's sim rotation is deliberately ignored — mapping it
 * to a frame or applying it as a screen-space sprite rotation (what
 * ObjectDrawSystem does, correct for ships) would compose two
 * unrelated rotations. Runs after ObjectDrawSystem to override it.
 * See TumbleAnimationComponent for the wëap/shän flags of future
 * consumers.
 */
export const TumbleDrawSystem = new System({
    name: 'TumbleDrawSystem',
    args: [TumbleAnimationComponent, AnimationGraphicComponent,
        TimeResource] as const,
    step(tumble, graphic, time) {
        const seconds = time.time / 1000;
        for (const sprite of graphic.sprites.values()) {
            if (sprite.frames <= 0) {
                continue; // Textures still loading.
            }
            const cycles = tumble.phase
                + seconds * tumble.frameRate / sprite.frames;
            const phase = ((cycles % 1) + 1) % 1;
            sprite.frame = Math.min(sprite.frames - 1,
                Math.floor(phase * sprite.frames));
            sprite.pixiSprite.rotation = 0;
        }
    },
    after: [ObjectDrawSystem],
});

export const AnimationGraphicCleanup = new System({
    name: 'AnimationGraphicCleanup',
    events: [DeleteEvent],
    args: [AnimationGraphicComponent, AnimationGraphicPoolResource,
        Space] as const,
    step: (graphic, pool, space) => {
        // The pool keys the graphic by what it was BUILT from, not by the
        // entity's current AnimationComponent — those can differ (see
        // AnimationGraphicPool.release).
        if (pool.release(graphic)) {
            // Keep the graphic attached to the space container but hidden so
            // that reusing it does not pay for removeChild / addChild, which
            // splice the container's children array.
            graphic.container.visible = false;
        } else {
            space.removeChild(graphic.container);
        }
    }
});

export const AnimationGraphicInsert = new System({
    name: 'AnimationGraphicInsert',
    events: [AddEvent],
    args: [AnimationGraphicComponent, Space] as const,
    step(graphic, space) {
        attachGraphic(graphic, space);
    }
});

export const AnimationGraphicPlugin: Plugin = {
    name: 'AnimationGraphicPlugin',
    build(world) {
        world.resources.set(AnimationGraphicPoolResource,
            new AnimationGraphicPool());
        world.addSystem(AnimationGraphicLoader);
        world.addSystem(AnimationGraphicProvider);
        world.addSystem(ObjectDrawSystem);
        world.addSystem(TumbleDrawSystem);
        world.addSystem(AnimationGraphicCleanup);
        world.addSystem(AnimationGraphicInsert);
    },
    remove(world) {
        world.removeSystem(AnimationGraphicLoader);
        world.removeSystem(AnimationGraphicProvider);
        world.removeSystem(ObjectDrawSystem);
        world.removeSystem(TumbleDrawSystem);
        world.removeSystem(AnimationGraphicCleanup);
        world.removeSystem(AnimationGraphicInsert);
        world.resources.delete(AnimationGraphicPoolResource);
    }
}
