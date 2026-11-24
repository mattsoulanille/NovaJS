import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import type { ControlEvent } from '../nova_plugin/core/index.js';
import { overrideEnhancements } from '../enhancements.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { OfferPopup } from './offer_popup.js';
import { POPUP_LINE_HEIGHT, tiledPopupLayout } from './popup_layout.js';
import { ScrollArrow } from './scroll_arrow.js';
import { DOM_DELTA_PIXEL, MAC_WHEEL_NOTCH } from './starmap_gestures.js';

/**
 * A long mission text's scrolling, against the original's (reference
 * "Scrolling: long mission text and the shop scroll arrows, wave 12"):
 * Up / Down 10 px a press with no key repeat, PageUp / PageDown 250 px,
 * Home / End to the ends, an arrow gliding from its press with a click
 * moving 5 px, and the wheel only with the "Scroll wheel in text"
 * enhancement. Headless: this pins the offsets, not the look.
 */
describe('OfferPopup text scrolling (wave 12)', () => {
    beforeAll(() => installHeadlessPixi());

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            data: { Sound: { get: async () => undefined } },
        } as unknown as DisplayAssetDataInterface;
    }

    /** The popup's private scroll state, read for the offsets. */
    interface ScrollState {
        offset: number,
        maxOffset: number,
        up: ScrollArrow,
        down: ScrollArrow,
    }

    /** The hold's per-frame callback, captured instead of handed to the
     * shared Ticker (which would start requestAnimationFrame under node),
     * and a fake clock for the glide. */
    let ticks: (() => void)[];
    let now: number;
    /** Popups raised by the spec, taken down after it. */
    let raised: OfferPopup[] = [];
    beforeEach(() => {
        ticks = [];
        now = 1000;
        spyOn(PIXI.Ticker.shared, 'add').and.callFake(
            ((fn: () => void) => {
                ticks.push(fn);
                return PIXI.Ticker.shared;
            }) as typeof PIXI.Ticker.shared.add);
        spyOn(PIXI.Ticker.shared, 'remove').and.callFake(
            ((fn: () => void) => {
                ticks = ticks.filter(t => t !== fn);
                return PIXI.Ticker.shared;
            }) as typeof PIXI.Ticker.shared.remove);
        spyOn(performance, 'now').and.callFake(() => now);
    });

    afterEach(() => {
        raised.forEach(popup => popup.dismiss());
        raised = [];
        overrideEnhancements({});
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    function raise() {
        const controlEvents = new Subject<ControlEvent>();
        const popup = new OfferPopup(displayAssets(), controlEvents);
        raised.push(popup);
        const text = Array.from({ length: 60 },
            (_, i) => `Line ${i + 1}`).join('\n');
        void popup.show(text, { accept: 'Yes', refuse: 'No' });
        const scroll = () =>
            (popup as unknown as { scroll: ScrollState }).scroll;
        const key = (action: ControlEvent['action'],
            state: ControlEvent['state'] = 'start') =>
            controlEvents.next({ action, state });
        return { popup, scroll, key };
    }

    it('scrolls the whole overflow of a 60-line text', () => {
        const { scroll } = raise();
        expect(scroll().offset).toBe(0);
        expect(scroll().maxOffset).toBe(tiledPopupLayout(60).maxScroll);
        expect(scroll().maxOffset).toBeGreaterThan(30 * POPUP_LINE_HEIGHT);
    });

    it('moves 10 px per Up / Down press, and a held key does not repeat',
        () => {
            const { scroll, key } = raise();
            key('down');
            expect(scroll().offset).toBe(10);
            key('down', 'repeat');
            key('down', 'repeat');
            expect(scroll().offset).toBe(10);
            key('down');
            key('up');
            expect(scroll().offset).toBe(10);
        });

    it('pages 250 px and jumps to either end', () => {
        const { popup, scroll } = raise();
        popup.onPageKey('PageDown');
        expect(scroll().offset).toBe(250);
        popup.onPageKey('End');
        expect(scroll().offset).toBe(scroll().maxOffset);
        popup.onPageKey('PageUp');
        expect(scroll().offset).toBe(scroll().maxOffset - 250);
        popup.onPageKey('Home');
        expect(scroll().offset).toBe(0);
    });

    it('moves a quick click on an arrow 5 px, with no jump on the press',
        () => {
            const { scroll } = raise();
            const down = scroll().down.container;
            down.emit('pointerdown', {} as PIXI.FederatedPointerEvent);
            expect(scroll().offset).toBe(0);
            now += 60;
            ticks.forEach(tick => tick());
            down.emit('pointerup', {} as PIXI.FederatedPointerEvent);
            expect(scroll().offset).toBe(5);
            // The glide stopped with the release.
            expect(ticks).toEqual([]);
        });

    it('glides a held arrow at 60 px/s from the press, by the clock', () => {
        const { scroll } = raise();
        const down = scroll().down.container;
        down.emit('pointerdown', {} as PIXI.FederatedPointerEvent);
        expect(ticks.length).toBe(1);
        now += 500;
        ticks.forEach(tick => tick());
        expect(scroll().offset).toBeCloseTo(30, 6);
        // A late frame catches up with the clock.
        now += 1500;
        ticks.forEach(tick => tick());
        expect(scroll().offset).toBeCloseTo(120, 6);
        // Released past a click's 5 px: the glide's distance stands.
        now += 500;
        down.emit('pointerupoutside', {} as PIXI.FederatedPointerEvent);
        expect(scroll().offset).toBeCloseTo(150, 6);
        expect(ticks).toEqual([]);
    });

    it('glides the other way from the up arrow', () => {
        const { popup, scroll } = raise();
        popup.onPageKey('End');
        const max = scroll().maxOffset;
        const up = scroll().up.container;
        up.emit('pointerdown', {} as PIXI.FederatedPointerEvent);
        now += 1000;
        up.emit('pointerup', {} as PIXI.FederatedPointerEvent);
        expect(scroll().offset).toBeCloseTo(max - 60, 6);
    });

    it('takes the wheel only with the "Scroll wheel in text" enhancement',
        () => {
            const { popup, scroll } = raise();
            const notch = (timeStamp: number) => ({
                deltaX: 0, deltaY: MAC_WHEEL_NOTCH * 3,
                deltaMode: DOM_DELTA_PIXEL, ctrlKey: false, timeStamp,
            });
            overrideEnhancements({ enhTextScrollWheel: false });
            popup.onWheel(notch(0));
            expect(scroll().offset).toBe(0);
            overrideEnhancements({});
            popup.onWheel(notch(1000));
            expect(scroll().offset).toBe(3 * POPUP_LINE_HEIGHT);
        });
});
