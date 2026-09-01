import 'jasmine';
import * as PIXI from 'pixi.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import {
    applyRendererScale, clampScale, computeScaleLayout, describeDisplayScale,
    formatScale, MAX_SCALE, MAX_TEXT_RESOLUTION, MIN_SCALE,
    refreshTextResolution, ScalableView, setDefaultTextResolution, snapToPixel,
    stepScale,
} from './display_scale.js';
import { screenCentre, clientToUi, clientToWorld } from './screen_size_plugin.js';

/**
 * The blur Matthew reported on a 3440x1440 Linux display, and the two
 * scale settings that came out of chasing it.
 *
 * The three things that made text soft, and what pins each of them here:
 *
 *  1. **The renderer's resolution was frozen at load.** `RESOLUTION` was
 *     read from `devicePixelRatio` once, at module scope, and the resize
 *     handler only ever called `renderer.resize()`. Browser page zoom
 *     MOVES devicePixelRatio, so zooming left the backing store at the
 *     old ratio while the canvas kept the window's CSS size: the browser
 *     upsampled the whole frame. That is exactly "the page scale browser
 *     setting just makes the blurry text bigger". `computeScaleLayout` is
 *     now recomputed from the live ratio and `applyRendererScale` pushes
 *     it in.
 *  2. **Centred dialogs landed on half pixels.** Every dialog sits at
 *     `screenSize / 2`, and an odd window height (browser chrome eats an
 *     arbitrary number of rows) put the whole spaceport on x.5, where the
 *     LINEAR filter resamples every glyph. `screenCentre` rounds.
 *  3. **Scaled UI text was rasterized for the unscaled renderer.**
 *     PIXI.Text auto-resolution follows `renderer.resolution` and knows
 *     nothing about the container transform above it, so a UI layer at
 *     1.5x drew a 1x texture 1.5x large. `textResolution` folds the UI
 *     scale in, and `refreshTextResolution` re-rasterizes what already
 *     exists when the setting moves.
 */
describe('display scale', () => {
    beforeAll(() => installHeadlessPixi());

    describe('clampScale', () => {
        it('leaves an in-range step alone', () => {
            expect(clampScale(1)).toBe(1);
            expect(clampScale(1.25)).toBe(1.25);
            expect(clampScale(2.5)).toBe(2.5);
        });

        it('snaps to the quarter step', () => {
            expect(clampScale(1.3)).toBe(1.25);
            expect(clampScale(1.4)).toBe(1.5);
        });

        it('clamps to the legal range', () => {
            expect(clampScale(0.1)).toBe(MIN_SCALE);
            expect(clampScale(99)).toBe(MAX_SCALE);
        });

        it('falls back to 1 for anything unusable', () => {
            // A corrupt localStorage value must never leave the player
            // with a window they cannot navigate to fix it.
            expect(clampScale(undefined)).toBe(1);
            expect(clampScale('2')).toBe(1);
            expect(clampScale(NaN)).toBe(1);
            expect(clampScale(Infinity)).toBe(1);
        });

        it('leaves no floating point dust', () => {
            // 1.75 via `Math.round(v / 0.25) * 0.25` is
            // 1.7500000000000002 without the final rounding, which then
            // reaches the slider's `value` and the "%" readout.
            expect(clampScale(1.75)).toBe(1.75);
            expect(String(clampScale(1.75))).toBe('1.75');
        });
    });

    describe('stepScale', () => {
        it('moves by one quarter step per press', () => {
            expect(stepScale(1, 1)).toBe(1.25);
            expect(stepScale(1, -1)).toBe(0.75);
        });

        it('stops at the ends rather than wrapping', () => {
            expect(stepScale(MAX_SCALE, 1)).toBe(MAX_SCALE);
            expect(stepScale(MIN_SCALE, -1)).toBe(MIN_SCALE);
        });
    });

    describe('computeScaleLayout', () => {
        it('reproduces the pre-setting rendering at 1x on a 1x display',
            () => {
                // The visual-compare harness runs exactly here (1920x1080,
                // deviceScaleFactor 1), so this is the byte-for-byte case.
                const layout = computeScaleLayout({
                    devicePixelRatio: 1, cssWidth: 1920, cssHeight: 1080,
                    globalScale: 1, uiScale: 1,
                });
                expect(layout.resolution).toBe(1);
                expect(layout.worldWidth).toBe(1920);
                expect(layout.worldHeight).toBe(1080);
                expect(layout.uiWidth).toBe(1920);
                expect(layout.uiHeight).toBe(1080);
                expect(layout.uiScale).toBe(1);
                expect(layout.textResolution).toBe(1);
            });

        it('keeps one texel per physical pixel under page zoom', () => {
            // Page zoom to 150%: devicePixelRatio goes to 1.5 and the CSS
            // viewport shrinks by the same factor. The backing store must
            // still come out at the display's real 3440 pixels.
            const layout = computeScaleLayout({
                devicePixelRatio: 1.5, cssWidth: 3440 / 1.5, cssHeight: 960,
                globalScale: 1, uiScale: 1,
            });
            expect(layout.resolution).toBe(1.5);
            expect(layout.worldWidth * layout.resolution)
                .toBeCloseTo(3440, 6);
            expect(layout.textResolution).toBe(1.5);
        });

        it('makes the global scale a zoom, not an upsample', () => {
            const layout = computeScaleLayout({
                devicePixelRatio: 1, cssWidth: 3440, cssHeight: 1440,
                globalScale: 2, uiScale: 1,
            });
            // Half as much of the system on screen...
            expect(layout.worldWidth).toBe(1720);
            expect(layout.worldHeight).toBe(720);
            // ...but the backing store still covers every physical pixel,
            // and glyphs are rasterized for it.
            expect(layout.resolution).toBe(2);
            expect(layout.worldWidth * layout.resolution).toBe(3440);
            expect(layout.textResolution).toBe(2);
            // The canvas keeps filling the window.
            expect(layout.cssWidth).toBe(3440);
            expect(layout.cssHeight).toBe(1440);
        });

        it('shrinks only the UI viewport for the UI scale', () => {
            const layout = computeScaleLayout({
                devicePixelRatio: 1, cssWidth: 3440, cssHeight: 1440,
                globalScale: 1, uiScale: 2,
            });
            expect(layout.worldWidth).toBe(3440);
            expect(layout.worldHeight).toBe(1440);
            expect(layout.uiWidth).toBe(1720);
            expect(layout.uiHeight).toBe(720);
            expect(layout.uiScale).toBe(2);
            // The UI layer draws at 2x, so its glyphs need 2x the texels.
            expect(layout.textResolution).toBe(2);
        });

        it('composes the two scales', () => {
            const layout = computeScaleLayout({
                devicePixelRatio: 2, cssWidth: 1600, cssHeight: 900,
                globalScale: 1.5, uiScale: 1.25,
            });
            expect(layout.resolution).toBe(3);
            expect(layout.worldWidth).toBeCloseTo(1600 / 1.5, 9);
            expect(layout.uiWidth).toBeCloseTo(1600 / 1.5 / 1.25, 9);
            // Capped: 2 * 1.5 * 1.25 = 3.75, under the ceiling.
            expect(layout.textResolution).toBeCloseTo(3.75, 9);
        });

        it('caps the text resolution so a big scale cannot blow up memory',
            () => {
                const layout = computeScaleLayout({
                    devicePixelRatio: 2, cssWidth: 1600, cssHeight: 900,
                    globalScale: 3, uiScale: 3,
                });
                expect(layout.textResolution).toBe(MAX_TEXT_RESOLUTION);
            });

        it('survives a nonsense devicePixelRatio', () => {
            const layout = computeScaleLayout({
                devicePixelRatio: 0, cssWidth: 800, cssHeight: 600,
                globalScale: 1, uiScale: 1,
            });
            expect(layout.resolution).toBe(1);
        });
    });

    describe('screenCentre', () => {
        it('rounds an odd viewport off the half pixel', () => {
            // 1329 is what a 1440-tall window leaves after browser chrome
            // on Matthew's machine; 664.5 is where every dialog used to
            // sit, and where LINEAR filtering softens every glyph.
            expect(screenCentre({ x: 3440, y: 1329 })).toEqual(
                { x: 1720, y: 665 });
        });

        it('leaves an even viewport exactly centred', () => {
            expect(screenCentre({ x: 1920, y: 1080 })).toEqual(
                { x: 960, y: 540 });
        });
    });

    describe('snapToPixel', () => {
        it('snaps to the physical pixel grid at a fractional resolution',
            () => {
                expect(snapToPixel(664.5, 1)).toBe(665);
                expect(snapToPixel(664.4, 2)).toBe(664.5);
                expect(snapToPixel(10.1, 1.5)).toBeCloseTo(10, 9);
            });

        it('returns the value unchanged for a useless factor', () => {
            expect(snapToPixel(3.5, 0)).toBe(3.5);
            expect(snapToPixel(3.5, NaN)).toBe(3.5);
        });
    });

    describe('client coordinate conversion', () => {
        it('divides pointer CSS pixels by the scales they cross', () => {
            const scale = { ui: 2, global: 1.5 };
            // The world layer only sees the global scale (the renderer's
            // resolution carries it, and the DOM knows nothing about it).
            expect(clientToWorld(300, scale)).toBe(200);
            // The UI layer sees both.
            expect(clientToUi(300, scale)).toBe(100);
        });

        it('is the identity at 1x, which is what it was before', () => {
            expect(clientToWorld(742, { ui: 1, global: 1 })).toBe(742);
            expect(clientToUi(742, { ui: 1, global: 1 })).toBe(742);
        });
    });

    describe('applyRendererScale', () => {
        it('resizes to the LOGICAL viewport but pins the canvas to the '
            + 'window', () => {
                // PIXI's autoDensity writes the logical size into
                // style.width, which is only the window's width at 1x
                // global scale. Overwriting it is what keeps the canvas
                // covering the window while the coordinate space shrinks.
                const calls: [number, number][] = [];
                const view = { style: { width: '', height: '' } };
                const renderer: ScalableView = {
                    resolution: 1,
                    resize: (w, h) => { calls.push([w, h]); },
                    view,
                };
                applyRendererScale(renderer, computeScaleLayout({
                    devicePixelRatio: 1, cssWidth: 3440, cssHeight: 1440,
                    globalScale: 2, uiScale: 1,
                }));
                expect(renderer.resolution).toBe(2);
                expect(calls).toEqual([[1720, 720]]);
                expect(view.style.width).toBe('3440px');
                expect(view.style.height).toBe('1440px');
            });
    });

    describe('text resolution', () => {
        afterEach(() => {
            // The defaults are process-wide; put them back so the rest of
            // the suite builds text the way it always did.
            PIXI.Text.defaultAutoResolution = true;
            PIXI.Text.defaultResolution = null as unknown as number;
        });

        it('gives newly built text the scaled resolution', () => {
            setDefaultTextResolution(3);
            const text = new PIXI.Text('Sigma Shipyards');
            expect(text.resolution).toBe(3);
        });

        it('turns auto-resolution off, so the renderer cannot undo it',
            () => {
                // With auto-resolution left on, Text._render overwrites
                // _resolution with renderer.resolution on the next frame
                // and the UI scale factor is thrown away again.
                setDefaultTextResolution(3);
                expect(PIXI.Text.defaultAutoResolution).toBeFalse();
            });

        it('re-rasterizes text that already exists', () => {
            setDefaultTextResolution(1);
            const root = new PIXI.Container();
            const panel = new PIXI.Container();
            const a = new PIXI.Text('Credits');
            const b = new PIXI.Text('Fuel');
            panel.addChild(b);
            root.addChild(a, panel, new PIXI.Sprite());
            expect(refreshTextResolution(root, 2)).toBe(2);
            expect(a.resolution).toBe(2);
            expect(b.resolution).toBe(2);
        });
    });

    describe('readouts', () => {
        it('shows a scale as a percentage', () => {
            expect(formatScale(1)).toBe('100%');
            expect(formatScale(1.25)).toBe('125%');
            expect(formatScale(0.5)).toBe('50%');
        });

        it('describes both scales for the status line', () => {
            expect(describeDisplayScale({ uiScale: 1.5, globalScale: 1 }))
                .toBe('UI scale 150%, global scale 100%.');
        });
    });
});
