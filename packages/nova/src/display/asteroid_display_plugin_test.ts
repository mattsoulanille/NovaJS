import 'jasmine';
import * as PIXI from 'pixi.js';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { DebrisComponent, DEBRIS_LIFETIME_MS } from '../nova_plugin/combat/asteroid_plugin.js';
import { AnimationGraphic } from './animation_graphic.js';
import { AnimationGraphicComponent } from './animation_graphic_plugin.js';
import { DebrisDrawSystem, DEBRIS_FADE_MS, DEBRIS_SCALE } from './asteroid_display_plugin.js';
import { defaultSimulationTime, SimulationTimeResource } from './simulation_time.js';

/** Just the pieces DebrisDrawSystem touches. */
function fakeGraphic() {
    const container = new PIXI.Container();
    const pixiSprite = new PIXI.Sprite();
    container.addChild(pixiSprite);
    const graphic = {
        container,
        sprites: new Map([['baseImage', { pixiSprite }]]),
    };
    return graphic as unknown as AnimationGraphic;
}

function spriteAlpha(graphic: AnimationGraphic): number {
    return graphic.sprites.get('baseImage')!.pixiSprite.alpha;
}

describe('DebrisDrawSystem', () => {
    /**
     * A world whose mirrored simulation clock reads `simTimeMs`, with
     * one resource-box expiring at `expires` (both sim-clock ms).
     */
    function debrisWorld(simTimeMs: number, expires: number) {
        const world = new World('debris-display-test');
        world.resources.set(SimulationTimeResource,
            { ...defaultSimulationTime(), time: simTimeMs });
        world.addSystem(DebrisDrawSystem);
        const graphic = fakeGraphic();
        const debris = new Entity('box')
            .addComponent(DebrisComponent, { commodity: 'cargo:4', expires })
            .addComponent(AnimationGraphicComponent, graphic);
        world.entities.set('box', debris);
        return { world, graphic };
    }

    it('renders a fresh resource-box at full alpha', () => {
        // Regression: expires is a SIM-clock timestamp. When the fade
        // compared it against the display's wall clock (epoch ms),
        // `remaining` was hugely negative and the box was born
        // invisible.
        const { world, graphic } = debrisWorld(0, DEBRIS_LIFETIME_MS);
        world.step();
        expect(spriteAlpha(graphic)).toBe(1);
        expect(graphic.container.scale.x).toBe(DEBRIS_SCALE);
        // The container alpha belongs to MurkFadeSystem; the expiry
        // fade must not touch it.
        expect(graphic.container.alpha).toBe(1);
    });

    it('stays at full alpha until the final fade window', () => {
        const expires = DEBRIS_LIFETIME_MS;
        const { world, graphic } =
            debrisWorld(expires - DEBRIS_FADE_MS, expires);
        world.step();
        expect(spriteAlpha(graphic)).toBe(1);
    });

    it('fades across the final window', () => {
        const expires = DEBRIS_LIFETIME_MS;
        const { world, graphic } =
            debrisWorld(expires - DEBRIS_FADE_MS / 2, expires);
        world.step();
        expect(spriteAlpha(graphic)).toBeCloseTo(0.5);
        expect(graphic.container.alpha).toBe(1);
    });

    it('is fully transparent at and after expiry', () => {
        const expires = DEBRIS_LIFETIME_MS;
        const { world, graphic } = debrisWorld(expires + 1000, expires);
        world.step();
        expect(spriteAlpha(graphic)).toBe(0);
    });
});
