import 'jasmine';
import * as PIXI from 'pixi.js';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { Animation, getDefaultAnimation, getDefaultAnimationImage } from 'novadatainterface/animation';
import { Gettable } from 'novadatainterface/gettable';
import { SpriteSheetFramesData } from 'novadatainterface/sprite_sheet_data';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    AnimationComponent, DisplayAssetDataResource, ProjectileComponent,
} from '../nova_plugin/core/index.js';
import {
    AnimationGraphicComponent, AnimationGraphicPlugin,
} from './animation_graphic_plugin.js';
import { AnimationGraphicPoolResource } from './animation_graphic_pool.js';
import { CameraFocus, Space } from './space_resource.js';

/**
 * A projectile is drawn AT THE MUZZLE (maintainer's ruling): on the display
 * step its entity enters the display world, at the position its snapshot
 * put it. The graphic used to come only from AnimationGraphicLoader, a
 * ProvideAsync, which applies its result a microtask AFTER the step that
 * ran it, so a new shot was invisible on its first frame and first drawn
 * on the next — one frame of flight clear of the muzzle — even when a
 * pooled graphic was sitting ready (measured in the browser: 24/24 shots
 * first visible exactly one display frame after they arrived).
 *
 * Headless: PIXI display objects only, no renderer; sheets have no frames.
 */
function animation(id: string, sheet = `${id} sheet`): Animation {
    const a = getDefaultAnimation();
    a.id = id;
    a.images = { baseImage: { ...getDefaultAnimationImage(), id: sheet } };
    return a;
}

async function flush() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function displayWorld() {
    const sheetLoads: string[] = [];
    const frames = new Gettable<SpriteSheetFramesData>(async id => {
        sheetLoads.push(id);
        await flush();
        return { frames: {} } as unknown as SpriteSheetFramesData;
    });
    const displayAssets = {
        data: { SpriteSheetFrames: frames },
    } as unknown as DisplayAssetDataInterface;
    const world = new World('first frame display');
    await world.addPlugin(TimePlugin);
    world.resources.set(DisplayAssetDataResource, displayAssets);
    const space = new PIXI.Container();
    world.resources.set(Space, space);
    world.resources.set(CameraFocus, { x: 0, y: 0 });
    await world.addPlugin(AnimationGraphicPlugin);
    return { world, space, frames, sheetLoads };
}

function projectile(anim: Animation, x: number, y: number) {
    return new Entity('projectile')
        .addComponent(ProjectileComponent, { id: anim.id })
        .addComponent(AnimationComponent, anim)
        .addComponent(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(400, 0),
            rotation: new Angle(0),
            turning: 0, turnBack: false, accelerating: 0,
        });
}

function drawn(entity: Entity, space: PIXI.Container) {
    const graphic = entity.components.get(AnimationGraphicComponent);
    if (!graphic || !graphic.container.visible
        || graphic.container.parent !== space) {
        return undefined;
    }
    return graphic;
}

describe('a projectile\'s first display frame', () => {
    it('is drawn on the step it arrives, at its snapshot position, when a '
        + 'pooled graphic is ready', async () => {
            const { world, space } = await displayWorld();
            const blaster = animation('blaster');
            // An earlier shot builds the graphic and hands it back.
            const first = projectile(blaster, 0, 0);
            world.entities.set('shot:0', first);
            world.step();
            await flush(); await flush();
            world.step();
            expect(drawn(first, space)).toBeDefined();
            world.entities.delete('shot:0');
            world.step();
            const pooled = first.components.get(AnimationGraphicComponent)!;
            expect(pooled.container.visible).toBeFalse();

            const shot = projectile(blaster, 120, -40);
            world.entities.set('shot:1', shot);
            world.step();
            const graphic = drawn(shot, space);
            expect(graphic).withContext('visible on its first step')
                .toBe(pooled);
            expect(graphic?.container.position.x).toBe(120);
            expect(graphic?.container.position.y).toBe(-40);
        });

    it('is drawn on the step it arrives when its sprite sheet is already '
        + 'loaded, even with nothing pooled', async () => {
            const { world, space, frames } = await displayWorld();
            const blaster = animation('blaster');
            await frames.get(blaster.images.baseImage!.id);
            expect(world.resources.get(AnimationGraphicPoolResource)!
                .acquire(blaster)).toBeUndefined();

            const shot = projectile(blaster, 30, 5);
            world.entities.set('shot:0', shot);
            world.step();
            const graphic = drawn(shot, space);
            expect(graphic).withContext('visible on its first step')
                .toBeDefined();
            expect(graphic?.builtAnimation?.id).toBe('blaster');
            expect(graphic?.built).toBeTrue();
            expect(graphic?.container.position.x).toBe(30);
        });

    it('still loads a sheet it has never seen, and draws once it has '
        + '(the only case left a frame late)', async () => {
            const { world, space, sheetLoads } = await displayWorld();
            const shot = projectile(animation('torpedo'), 0, 0);
            world.entities.set('shot:0', shot);
            world.step();
            expect(drawn(shot, space)).toBeUndefined();
            await flush(); await flush();
            expect(sheetLoads).toEqual(['torpedo sheet']);
            world.step();
            expect(drawn(shot, space)?.builtAnimation?.id).toBe('torpedo');
        });
});

/**
 * Projectile uuids come from the system's IdFactory
 * (`nova:184:projectile:143`), whose counter is simulation state and is
 * RESTORED by a rollback. Resimulating with corrected inputs can mint the
 * same uuid for a different shot — the player's blaster where the
 * prediction had an NPC's missile, or the secondary before the primary.
 * The display diffs by uuid, so it sees an existing entity whose
 * AnimationComponent changed, and the graphic (built once per entity, its
 * sprites captured at construction) went on drawing the first weapon for
 * the whole of the new shot's flight.
 */
describe('a projectile whose uuid is re-minted for another weapon', () => {
    it('draws the new weapon and files the old graphic under its own '
        + 'weapon', async () => {
            const { world, space, frames } = await displayWorld();
            const blaster = animation('blaster');
            const missile = animation('missile');
            await frames.get(blaster.images.baseImage!.id);
            await frames.get(missile.images.baseImage!.id);
            const shot = projectile(blaster, 0, 0);
            world.entities.set('nova:184:projectile:143', shot);
            world.step();
            const old = drawn(shot, space)!;
            expect(old.builtAnimation?.id).toBe('blaster');

            // The resimulated snapshot: same uuid, another weapon.
            shot.components.set(AnimationComponent, missile);
            world.step();
            const now = drawn(shot, space);
            expect(now?.builtAnimation?.id).withContext('drawn weapon')
                .toBe('missile');
            expect(old.container.visible).toBeFalse();
            const pool = world.resources.get(AnimationGraphicPoolResource)!;
            expect(pool.acquire(missile)).toBeUndefined();
            expect(pool.acquire(blaster)).toBe(old);
        });
});
