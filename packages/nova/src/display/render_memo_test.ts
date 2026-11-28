import 'jasmine';
import * as PIXI from 'pixi.js';
import { StatusBarData } from 'novadatainterface/status_bar_data';
import { Stat } from '../nova_plugin/core/index.js';
import { AnimationGraphic } from './animation_graphic.js';
import { GaugesPane } from './status_bar_gauges.js';
import { TargetPane } from './status_bar_target.js';

function fakeStatusBarData(): StatusBarData {
    return {
        id: 'test',
        image: 'test',
        colors: {
            brightText: 0xffffff,
            dimText: 0x888888,
            brightRadar: 0xffffff,
            dimRadar: 0x888888,
            shield: 0x00ff00,
            armor: 0x888888,
            fuelFull: 0x0088ff,
            fuelPartial: 0x004488,
        },
        dataAreas: {
            radar: { position: [0, 0], size: [100, 100] },
            shield: { position: [10, 10], size: [100, 8] },
            armor: { position: [10, 22], size: [100, 8] },
            fuel: { position: [10, 34], size: [100, 8] },
            navigation: { position: [0, 0], size: [100, 50] },
            weapons: { position: [0, 0], size: [100, 50] },
            targeting: { position: [0, 0], size: [120, 120] },
            cargo: { position: [0, 0], size: [100, 50] },
        },
        font: { name: 'sans-serif', size: 12 },
    } as unknown as StatusBarData;
}

describe('GaugesPane memoization', () => {
    it('skips graphics.clear() and redraws when stats are unchanged, and redraws on change or reset', () => {
        const data = fakeStatusBarData();
        let clears = 0;
        const fakeGraphics = {
            clear() { clears++; },
            lineStyle() { },
            moveTo() { },
            lineTo() { },
        } as unknown as PIXI.Graphics;
        const pane = new GaugesPane(data, fakeGraphics);

        const shield = new Stat({ current: 100, max: 100, recharge: 0 });
        const armor = new Stat({ current: 50, max: 100, recharge: 0 });
        const fuel = { current: 250, max: 400 };

        pane.drawStats(shield, armor, fuel);
        expect(clears).toBe(1);

        // Identical values on subsequent frames: no redraw.
        pane.drawStats(shield, armor, fuel);
        pane.drawStats(shield, armor, fuel);
        expect(clears).toBe(1);

        // Shield drops -> redraws once.
        shield.current = 80;
        pane.drawStats(shield, armor, fuel);
        expect(clears).toBe(2);
        pane.drawStats(shield, armor, fuel);
        expect(clears).toBe(2);

        // Interface reload via reset() invalidates memo -> redraws once.
        pane.reset(fakeStatusBarData());
        pane.drawStats(shield, armor, fuel);
        expect(clears).toBe(3);
    });
});

describe('TargetPane live FBO memoization', () => {
    function stubText() {
        return { text: '', visible: true, destroy() { } };
    }

    function makePaneWithSpyRenderer() {
        let renderCalls = 0;
        let visibleDuringRender: boolean | undefined;
        const renderer = {
            render(displayObject: PIXI.DisplayObject) {
                renderCalls++;
                visibleDuringRender = displayObject.visible;
            },
        } as unknown as PIXI.IRenderer;
        const pane = new TargetPane(renderer);
        // Bypass PIXI.Text (needs DOM canvas) with lightweight text stubs.
        (pane as unknown as { texts: Record<string, unknown> }).texts = {
            shield: stubText(),
            armor: stubText(),
            percent: stubText(),
            disabled: stubText(),
            noTarget: stubText(),
            name: stubText(),
            subtitle: stubText(),
            govt: stubText(),
            imagePlaceholder: stubText(),
        };
        return {
            pane,
            get renderCalls() { return renderCalls; },
            get visibleDuringRender() { return visibleDuringRender; },
        };
    }

    function fakeShipGraphic(textureA: PIXI.Texture) {
        const container = new PIXI.Container();
        container.position.set(1234, -5678);
        container.scale.set(1, 1);
        container.visible = false; // Simulate an offscreen-culled target ship.
        const baseSprite = {
            visible: true,
            texture: textureA,
            rotation: 0,
            tint: 0xffffff,
            alpha: 1,
        } as unknown as PIXI.Sprite;
        const glowSprite = {
            visible: true,
            texture: textureA,
            rotation: 0,
            tint: 0xffffff,
            alpha: 0.9,
        } as unknown as PIXI.Sprite;
        const sprites = new Map([
            ['baseImage', { pixiSprite: baseSprite }],
            ['glowImage', { pixiSprite: glowSprite }],
        ]);
        return {
            graphic: {
                container,
                sprites,
                size: { x: 64, y: 64 },
            } as unknown as AnimationGraphic,
            container,
            baseSprite,
            glowSprite,
        };
    }

    it('renders once when unchanged, tolerates small glow shimmer, redraws on frame/rotation change, and restores offscreen visibility & position', () => {
        const harness = makePaneWithSpyRenderer();
        const { pane } = harness;
        const tex1 = { id: 'frame1' } as unknown as PIXI.Texture;
        const tex2 = { id: 'frame2' } as unknown as PIXI.Texture;
        const { graphic, container, baseSprite, glowSprite } = fakeShipGraphic(tex1);

        pane.drawTarget('Pirate Viper', 100, 100, graphic);
        expect(harness.renderCalls).toBe(1);
        // Even though the ship container was offscreen-culled (visible=false),
        // TargetPane unhid it for the FBO pass and restored its original state.
        expect(harness.visibleDuringRender).toBeTrue();
        expect(container.visible).toBeFalse();
        expect(container.position.x).toBe(1234);
        expect(container.position.y).toBe(-5678);

        // Identical frame: skips FBO render completely.
        pane.drawTarget('Pirate Viper', 100, 100, graphic);
        expect(harness.renderCalls).toBe(1);

        // Small engine glow shimmer while thrusting: still skips FBO render.
        glowSprite.alpha = 0.82;
        pane.drawTarget('Pirate Viper', 100, 100, graphic);
        expect(harness.renderCalls).toBe(1);

        // Texture frame changes (ship turned to a new sprite frame): redraws.
        baseSprite.texture = tex2;
        pane.drawTarget('Pirate Viper', 100, 100, graphic);
        expect(harness.renderCalls).toBe(2);

        // Engine glow turns off: redraws.
        glowSprite.alpha = 0;
        pane.drawTarget('Pirate Viper', 100, 100, graphic);
        expect(harness.renderCalls).toBe(3);

        // Clearing and re-locking target invalidates cache -> redraws.
        pane.clearTarget();
        pane.drawTarget('Pirate Viper', 100, 100, graphic);
        expect(harness.renderCalls).toBe(4);
    });
});
