import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { beginPixiTextEntry } from '../input_focus.js';
import type { ControlEvent } from '../nova_plugin/core/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { OfferPopup, PopupChoice } from './offer_popup.js';

/**
 * Return on a mission-text popup presses its accept button, the
 * original's default: Yes on a mission offer (catalogue K2, confirmed for
 * AvailLoc 3 in wave 5) and Okay on a one-button notice (wave 16: the
 * empty BBS's "There are no missions available here." Okay takes the
 * next Return). Option+Return is fullscreen and presses nothing, a key
 * repeat presses nothing, and neither does Return while a text field
 * has the keyboard.
 */
describe('OfferPopup Return key', () => {
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

    let raised: OfferPopup[] = [];
    afterEach(() => {
        raised.forEach(popup => popup.dismiss());
        raised = [];
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    function raise(buttons: { accept: string, refuse?: string }) {
        const popup = new OfferPopup(displayAssets(),
            new Subject<ControlEvent>());
        raised.push(popup);
        let answer: PopupChoice | undefined;
        const shown = popup.show('Will you carry the cargo?', buttons)
            .then(choice => { answer = choice; });
        return { shown, answer: () => answer };
    }

    async function settle() {
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    it('accepts a mission offer (Yes), and only on plain Return',
        async () => {
            const { shown, answer } = raise({ accept: 'Yes', refuse: 'No' });
            expect(MenuControls.pressDefaultButton(
                { key: 'Enter', altKey: true })).toBeFalse();
            expect(MenuControls.pressDefaultButton(
                { key: 'Enter', repeat: true })).toBeFalse();
            const release = beginPixiTextEntry();
            expect(MenuControls.pressDefaultButton({ key: 'Enter' }))
                .toBeFalse();
            release();
            await settle();
            expect(answer()).toBeUndefined();

            expect(MenuControls.pressDefaultButton({ key: 'Enter' }))
                .toBeTrue();
            await shown;
            expect(answer()).toBe('accept');
        });

    it('dismisses a notice (Okay)', async () => {
        const { shown, answer } = raise({ accept: 'Okay' });
        expect(MenuControls.pressDefaultButton({ key: 'Enter', altKey: true }))
            .toBeFalse();
        await settle();
        expect(answer()).toBeUndefined();
        expect(MenuControls.pressDefaultButton({ key: 'Enter' })).toBeTrue();
        await shown;
        expect(answer()).toBe('accept');
    });

    it('is pointer-only without control events (no default button)',
        async () => {
            // The About box and the headless harness build popups without
            // control events: they never take the keyboard.
            const popup = new OfferPopup(displayAssets());
            raised.push(popup);
            const before = MenuControls.focused;
            void popup.show('About', { accept: 'Okay' });
            expect(MenuControls.focused).toBe(before);
        });
});
