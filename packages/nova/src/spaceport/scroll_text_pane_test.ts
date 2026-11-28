import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { overrideEnhancements } from '../enhancements.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { POPUP_WHEEL_NOTCH_PX } from './popup_layout.js';
import {
    clampOffset, offsetForThumb, pageStep, SCROLL_BAR, SCROLL_BAR_GUTTER,
    scrollThumb, ScrollTextPane, SHOP_DESCRIPTION_PANE, shopDescriptionPane,
    textScrollRange,
} from './scroll_text_pane.js';

/**
 * The clipped, scrolling text pane (scroll_text_pane.ts): its pure
 * geometry, and the pane driven headlessly — a notched wheel, the page
 * keys, the bar, a new text going back to the top.
 */
describe('scroll text pane', () => {
    beforeAll(() => installHeadlessPixi());

    describe('geometry', () => {
        it('scrolls only the part of the text below the pane', () => {
            expect(textScrollRange(100, 270)).toBe(0);
            expect(textScrollRange(270, 270)).toBe(0);
            expect(textScrollRange(500.5, 270)).toBe(231);
        });

        it('clamps offsets into the range', () => {
            expect(clampOffset(-5, 100)).toBe(0);
            expect(clampOffset(50, 100)).toBe(50);
            expect(clampOffset(150, 100)).toBe(100);
            expect(clampOffset(10, 0)).toBe(0);
        });

        it('sizes the thumb by the visible share and moves it through '
            + 'the rest of the track', () => {
                // 270 of 1080 px visible: a quarter of a 266 px track.
                const top = scrollThumb(0, 810, 270, 266);
                expect(top.y).toBe(0);
                expect(top.height).toBeCloseTo(66.5, 5);
                const end = scrollThumb(810, 810, 270, 266);
                expect(end.y + end.height).toBeCloseTo(266, 5);
                const mid = scrollThumb(405, 810, 270, 266);
                expect(mid.y).toBeCloseTo((266 - 66.5) / 2, 5);
                // A text that fits fills the track.
                expect(scrollThumb(0, 0, 270, 266))
                    .toEqual({ y: 0, height: 266 });
            });

        it('never shrinks the thumb under its minimum', () => {
            expect(scrollThumb(0, 100_000, 270, 266).height)
                .toBe(SCROLL_BAR.minThumb);
        });

        it('turns a thumb position back into the offset it shows', () => {
            for (const offset of [0, 100, 405, 810]) {
                const { y } = scrollThumb(offset, 810, 270, 266);
                expect(offsetForThumb(y, 810, 270, 266))
                    .toBeCloseTo(offset, 5);
            }
            expect(offsetForThumb(-40, 810, 270, 266)).toBe(0);
            expect(offsetForThumb(9_999, 810, 270, 266)).toBe(810);
            expect(offsetForThumb(50, 0, 270, 266)).toBe(0);
        });

        it('pages by the pane less one line', () => {
            expect(pageStep(270)).toBe(258);
            expect(pageStep(5)).toBe(12);
        });
    });

    describe('pane', () => {
        const FRAME = { x: -34, y: -153, width: 201, height: 270 };
        const FONT = {
            fontFamily: 'Geneva', fontSize: 9.4, lineHeight: 12,
            wordWrap: true, wordWrapWidth: 190,
        };
        const lines = (n: number) => Array.from({ length: n },
            (_, i) => `line ${i + 1}`).join('\n');
        const notch = (deltaY: number, timeStamp = 0) => ({
            deltaX: 0, deltaY, deltaMode: 1, ctrlKey: false, timeStamp,
        });

        function make(scrollable?: () => boolean) {
            const text = new PIXI.Text('', FONT);
            text.position.set(-27, -150);
            return { text, pane: new ScrollTextPane(text, {
                frame: FRAME, name: 'Probe', scrollable }) };
        }

        it('clips the text to its frame', () => {
            const { text, pane } = make();
            expect(text.mask).toBeInstanceOf(PIXI.Graphics);
            expect(pane.container.name).toBe('Probe');
            expect(pane.container.children).toContain(text);
        });

        it('a text that fits does not scroll and shows no bar', () => {
            const { text, pane } = make();
            pane.setText(lines(5));
            expect(pane.maxOffset).toBe(0);
            expect(pane.onWheel(notch(1))).toBeFalse();
            expect(text.y).toBe(-150);
            expect(text.style.wordWrapWidth).toBe(190);
        });

        it('an overflowing text scrolls to its last line and no further, '
            + 'its lines narrowed for the bar', () => {
                const { text, pane } = make();
                pane.setText(lines(60));
                const max = pane.maxOffset;
                expect(max).toBeGreaterThan(0);
                expect(text.style.wordWrapWidth)
                    .toBe(190 - SCROLL_BAR_GUTTER);
                expect(pane.onWheel(notch(1))).toBeTrue();
                expect(pane.offset).toBe(POPUP_WHEEL_NOTCH_PX);
                expect(text.y).toBe(-150 - POPUP_WHEEL_NOTCH_PX);
                for (let i = 0; i < 100; i++) {
                    pane.onWheel(notch(1, i));
                }
                expect(pane.offset).toBe(max);
                // The text's bottom sits on the pane's bottom.
                expect(text.y + text.height)
                    .toBeCloseTo(FRAME.y + FRAME.height, 0);
                pane.onWheel(notch(-1, 200));
                expect(pane.offset).toBe(max - POPUP_WHEEL_NOTCH_PX);
            });

        it('a new text starts at its top', () => {
            const { text, pane } = make();
            pane.setText(lines(60));
            pane.scrollTo(200);
            expect(pane.offset).toBe(200);
            pane.setText(lines(61));
            expect(pane.offset).toBe(0);
            expect(text.y).toBe(-150);
        });

        it('Home / End / PageUp / PageDown move the text', () => {
            const { pane } = make();
            pane.setText(lines(80));
            pane.onPageKey('End');
            expect(pane.offset).toBe(pane.maxOffset);
            pane.onPageKey('PageUp');
            expect(pane.offset).toBe(pane.maxOffset - pageStep(270));
            pane.onPageKey('Home');
            expect(pane.offset).toBe(0);
            pane.onPageKey('PageDown');
            expect(pane.offset).toBe(pageStep(270));
        });

        it('takes the page keys only while its owner is focused', () => {
            const listeners: ((event: KeyboardEvent) => void)[] = [];
            const doc = globalThis as unknown as { document?: unknown };
            const had = 'document' in doc;
            const previous = doc.document;
            doc.document = {
                addEventListener: (_: string, l: (e: KeyboardEvent) => void) =>
                    listeners.push(l),
                removeEventListener: (_: string, l: (e: KeyboardEvent) => void) =>
                    listeners.splice(listeners.indexOf(l), 1),
            };
            try {
                const { pane } = make();
                pane.setText(lines(80));
                const controls = new MenuControls(new Subject<ControlEvent>(), {});
                const key = (k: string) => listeners.forEach(l => l({
                    key: k, preventDefault: () => undefined,
                } as KeyboardEvent));
                pane.bindPageKeys(controls);
                // Bound but not focused: the key is someone else's.
                key('End');
                expect(pane.offset).toBe(0);
                controls.bind();
                key('End');
                expect(pane.offset).toBe(pane.maxOffset);
                controls.unbind();
                key('Home');
                expect(pane.offset).toBe(pane.maxOffset);
                pane.unbindPageKeys();
                expect(listeners.length).toBe(0);
            } finally {
                if (had) {
                    doc.document = previous;
                } else {
                    delete doc.document;
                }
            }
        });

        it('a smaller frame leaves more to scroll', () => {
            const { pane } = make();
            pane.setText(lines(60));
            const full = pane.maxOffset;
            pane.setFrame({ ...FRAME, height: 200 });
            expect(pane.maxOffset).toBe(full + 70);
        });

        it('does not scroll while its owner says it may not, but clips',
            () => {
                let on = false;
                const { text, pane } = make(() => on);
                pane.setText(lines(60));
                expect(pane.maxOffset).toBe(0);
                expect(pane.onWheel(notch(1))).toBeFalse();
                expect(text.mask).toBeTruthy();
                on = true;
                expect(pane.onWheel(notch(1, 1))).toBeTrue();
            });
    });

    describe('shop description pane', () => {
        afterEach(() => overrideEnhancements({}));

        function shop() {
            const text = new PIXI.Text('', {
                fontFamily: 'Geneva', fontSize: 9.4, lineHeight: 12,
                wordWrap: true, wordWrapWidth: 190,
            });
            text.position.set(-27, -150);
            return shopDescriptionPane(text, 'OutfitterDescription');
        }
        const long = Array.from({ length: 29 }, (_, i) => `l${i}`).join('\n');

        it('clips to the pane, and scrolls with "Scroll wheel in text" on',
            () => {
                const pane = shop();
                expect(pane.frame).toEqual(SHOP_DESCRIPTION_PANE);
                pane.setText(long);
                expect(pane.text.mask).toBeTruthy();
                expect(pane.maxOffset).toBeGreaterThan(0);
                pane.onPageKey('End');
                expect(pane.offset).toBe(pane.maxOffset);
            });

        it('only clips, at the top, with it off (the original)', () => {
            overrideEnhancements({ enhTextScrollWheel: false });
            const pane = shop();
            pane.setText(long);
            expect(pane.text.mask).toBeTruthy();
            expect(pane.maxOffset).toBe(0);
            pane.onPageKey('End');
            expect(pane.offset).toBe(0);
            // Its lines keep the full wrap: no bar to make room for.
            expect(pane.text.style.wordWrapWidth).toBe(190);
        });
    });
});
