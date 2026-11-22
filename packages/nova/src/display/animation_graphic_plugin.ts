import { Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { AddEvent, DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent, MovementSystem } from "nova_ecs/plugins/movement_plugin";
import { Provide } from "nova_ecs/provide";
import { AsyncProviderResource, originalIfDraft, ProvideAsync } from "nova_ecs/provide_async";
import { Optional } from "nova_ecs/optional";
import { Entity } from "nova_ecs/entity";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import {
    DisplayAssetDataResource, AnimationComponent, ExplosionAnimationProvider,
    TumbleAnimationComponent, ProjectileComponent,
} from '../nova_plugin/core/index.js';
import { currentIfDraft } from "../util/deimmerify.js";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { AsteroidComponent, DebrisComponent } from "../nova_plugin/combat/index.js";
import { PlanetComponent } from "../nova_plugin/travel/index.js";
import { PlayerShipSelector } from "../nova_plugin/player/index.js";
import { ShipComponent } from "../nova_plugin/ship/index.js";
import { wrapNearestDelta } from "nova_ecs/datatypes/position";
import { AnimationGraphic } from "./animation_graphic.js";
import { AnimationGraphicPool, AnimationGraphicPoolResource } from "./animation_graphic_pool.js";
import { CameraFocus, Space } from "./space_resource.js";
import { ZIndex } from "./z_index.js";
import { stepShipMotionDisplay } from "./ship_motion_display.js";

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
        return prepareGraphic(graphic, entity);
    },
    // #156 pin (shared: entity): AnimationGraphicPlugin registers after the
    // core AnimationPlugin.
    after: [ExplosionAnimationProvider],
});

/**
 * Readies a graphic for the entity it was just handed to: at the entity's
 * position (so a reused graphic does not flash where its previous entity
 * died) and in the entity's draw layer.
 */
function prepareGraphic(graphic: AnimationGraphic, entity: Entity) {
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
}

/**
 * Hands an entity its graphic on the display step it arrives, whenever
 * that needs no waiting: a pooled graphic of its animation, or a new one
 * whose sprite sheets are already loaded (AnimationGraphic.isReady).
 *
 * AnimationGraphicLoader is a ProvideAsync, and a ProvideAsync applies its
 * result a microtask AFTER the step that ran it, so on its own every new
 * entity was invisible for its first display frame and first drawn on the
 * next: a projectile one frame of flight clear of the muzzle (measured in
 * the browser: every shot; maintainer's ruling: a shot appears AT the
 * muzzle). What this cannot provide (a sheet never loaded yet) falls
 * through to the loader, as before.
 */
export const AnimationGraphicSyncLoader = new System({
    name: 'AnimationGraphicSyncLoader',
    args: [AnimationComponent, Optional(AnimationGraphicLoadedComponent),
        DisplayAssetDataResource, AnimationGraphicPoolResource,
        AsyncProviderResource, GetEntity, UUID] as const,
    step(animation, loaded, displayAssets, pool, asyncProviders, entity,
        uuid) {
        if (loaded || asyncProviders.get(AnimationGraphicLoader.name)
            ?.get(uuid)) {
            // Already provided, or a build is in flight for it.
            return;
        }
        let graphic = pool.acquire(animation);
        if (graphic) {
            graphic.reset();
        } else if (AnimationGraphic.isReady(displayAssets, animation)) {
            graphic = new AnimationGraphic({ displayAssets, animation });
            if (!graphic.built) {
                // isReady promised otherwise; the loader takes it.
                return;
            }
        } else {
            return;
        }
        entity.components.set(AnimationGraphicLoadedComponent,
            prepareGraphic(graphic, entity));
    },
    after: [ExplosionAnimationProvider],
    before: [AnimationGraphicLoader],
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
    args: [MovementStateComponent, AnimationGraphicComponent, CameraFocus,
        TimeResource, UUID] as const,
    step: (movementState, graphic, cameraFocus, time, uuid) => {
        // The bank set and the engine glow are smoothed on the display
        // clock (#357): a ship banks only after turning the same way for
        // BANK_DELAY_MS, and its glow ramps over GLOW_FADE_MS, so single-
        // tick steering flickers no longer flip its sprite set or blink
        // its glow. Every layer of the graphic (hull, glow, lights, weapon
        // overlay) takes the same set, and the target-pane thumbnail
        // renders this same graphic, so they all agree.
        const motion = stepShipMotionDisplay(graphic.motionDisplay, uuid,
            movementState.turning, movementState.accelerating, time.time);
        graphic.motionDisplay = motion.state;
        graphic.setFramesToUse(motion.frames);

        // The shimmer rides on top of the smoothed level.
        graphic.glowAlpha = motion.glow * (1 - (Math.random() * 0.2));

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

/**
 * An entity whose animation changed under its graphic gets a new graphic.
 *
 * AnimationGraphicLoader builds a graphic once per entity (it has no
 * `update:` list) and the graphic captures its sprites at construction, so
 * an entity that keeps its uuid but changes what it draws would go on
 * drawing the old one:
 *
 * - a SHIP that changes hull: an in-flight `Cxxx` / `Exxx` / `Hxxx`
 *   (nova_plugin/missions/mission_ship_change.ts) replaces the player's
 *   ship at the same uuid, and the display entity is updated in place;
 * - a PROJECTILE whose uuid a rollback re-mints for another weapon.
 *   Projectile uuids come from the system's IdFactory
 *   (`nova:184:projectile:143`), whose counter is simulation state that a
 *   rollback restores, so the resimulation can hand the same uuid to a
 *   different shot (an NPC's missile where the prediction had the
 *   player's blaster). The display diffs by uuid: it sees the old entity
 *   with a new AnimationComponent, and the shot flew with the other
 *   weapon's sprite for its whole life.
 *
 * This hands the old graphic back exactly as AnimationGraphicCleanup does
 * when an entity is deleted (filed under what it was BUILT from, so the
 * pool stays clean), and drops the graphic components so the entity gets
 * one for the animation it carries now, on this same step when
 * AnimationGraphicSyncLoader can provide it.
 *
 * Compared by animation id: two hulls sharing a shän draw the same
 * sprites, and the decoded component of an unchanged entity is a fresh
 * object every frame.
 */
export const AnimationGraphicAnimationChangeSystem = new System({
    name: 'AnimationGraphicAnimationChange',
    args: [AnimationComponent, AnimationGraphicComponent,
        AnimationGraphicPoolResource, Space, GetEntity] as const,
    step(animation, graphic, poolResource, space, entity) {
        const current = currentIfDraft(animation);
        const graphicNow = originalIfDraft(graphic);
        const built = graphicNow.builtAnimation;
        if (!built || !current || built.id === current.id) {
            return;
        }
        const pool = originalIfDraft(poolResource);
        if (pool.release(graphicNow)) {
            graphicNow.container.visible = false;
        } else {
            originalIfDraft(space).removeChild(graphicNow.container);
        }
        entity.components.delete(AnimationGraphicComponent);
        entity.components.delete(AnimationGraphicLoadedComponent);
    },
    before: [AnimationGraphicSyncLoader, AnimationGraphicLoader],
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
        world.addSystem(AnimationGraphicSyncLoader);
        world.addSystem(AnimationGraphicProvider);
        world.addSystem(ObjectDrawSystem);
        world.addSystem(TumbleDrawSystem);
        world.addSystem(AnimationGraphicCleanup);
        world.addSystem(AnimationGraphicInsert);
        world.addSystem(AnimationGraphicAnimationChangeSystem);
    },
    remove(world) {
        world.removeSystem(AnimationGraphicLoader);
        world.removeSystem(AnimationGraphicSyncLoader);
        world.removeSystem(AnimationGraphicProvider);
        world.removeSystem(ObjectDrawSystem);
        world.removeSystem(TumbleDrawSystem);
        world.removeSystem(AnimationGraphicCleanup);
        world.removeSystem(AnimationGraphicInsert);
        world.removeSystem(AnimationGraphicAnimationChangeSystem);
        world.resources.delete(AnimationGraphicPoolResource);
    }
}
