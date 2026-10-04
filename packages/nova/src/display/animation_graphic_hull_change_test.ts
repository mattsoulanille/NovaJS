import 'jasmine';
import * as PIXI from 'pixi.js';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { Animation } from 'novadatainterface/animation';
import { AnimationComponent } from '../nova_plugin/core/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import { AnimationGraphic } from './animation_graphic.js';
import {
    AnimationGraphicComponent, AnimationGraphicHullChangeSystem,
} from './animation_graphic_plugin.js';
import { AnimationGraphicPool, AnimationGraphicPoolResource } from './animation_graphic_pool.js';
import { Space } from './space_resource.js';

/**
 * An in-flight `Cxxx` / `Exxx` / `Hxxx` replaces the player's ship at the
 * SAME uuid (nova_plugin/missions/mission_ship_change.ts), so the display
 * entity is updated in place with the new hull's AnimationComponent — and
 * AnimationGraphicLoader, which builds a graphic once per entity, would go
 * on drawing the old hull. AnimationGraphicHullChangeSystem hands the old
 * graphic back and drops it so the loader builds the new one.
 *
 * Headless: only PIXI.Container is touched, no renderer.
 */
describe('a ship whose hull changed under its graphic', () => {
    function animation(id: string): Animation {
        return { id, name: id, images: {} } as unknown as Animation;
    }

    function world() {
        const world = new World('hull change graphic test');
        const pool = new AnimationGraphicPool();
        const space = new PIXI.Container();
        world.resources.set(AnimationGraphicPoolResource, pool);
        world.resources.set(Space, space);
        world.addSystem(AnimationGraphicHullChangeSystem);
        return { world, pool, space };
    }

    function ship(built: string, carried: string) {
        const graphic = {
            container: new PIXI.Container(),
            builtAnimation: animation(built),
        } as unknown as AnimationGraphic;
        const entity = new Entity('player');
        entity.components.set(ShipComponent, { id: 'nova:130' });
        entity.components.set(AnimationComponent, animation(carried));
        entity.components.set(AnimationGraphicComponent, graphic);
        return { entity, graphic };
    }

    it('drops the old hull\'s graphic, back into the pool, so a new one is '
        + 'built', () => {
        const { world: w, space } = world();
        const { entity, graphic } = ship('skiff', 'warden');
        space.addChild(graphic.container);
        w.entities.set('player', entity);
        w.step();
        expect(entity.components.has(AnimationGraphicComponent)).toBeFalse();
        expect(graphic.container.visible).toBeFalse();
    });

    it('leaves a ship whose animation has not changed alone', () => {
        const { world: w } = world();
        const { entity, graphic } = ship('warden', 'warden');
        w.entities.set('player', entity);
        w.step();
        expect(entity.components.get(AnimationGraphicComponent)).toBe(graphic);
    });
});
