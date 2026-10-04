import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import type { ControlEvent } from '../nova_plugin/core/index.js';
import {
    DESYNC_NOTICE_BUTTON, DESYNC_NOTICE_TEXT, showDesyncNotice,
} from './desync_notice.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';

/**
 * The lost-sync dialog (#333, ruling admin1): a single 'Reload' button
 * that reloads the page, and nothing — Escape above all — that dismisses
 * it into the frozen world behind it. Headless: this pins the display
 * list and the key routing, not the look (NOT run in a browser).
 */
describe('the lost-sync dialog (#333)', () => {
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

    afterEach(() => {
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    function raise() {
        const stage = new PIXI.Container();
        const controlEvents = new Subject<ControlEvent>();
        const reload = jasmine.createSpy('reload');
        // Another surface (a spaceport menu, say) had the keyboard.
        const underneath = jasmine.createSpy('underneath depart');
        const owner = new MenuControls(controlEvents, { depart: underneath });
        owner.bind();
        const notice = showDesyncNotice({
            displayAssets: displayAssets(), stage,
            centre: { x: 400, y: 300 }, controlEvents, reload,
        });
        const press = (action: ControlEvent['action']) =>
            controlEvents.next({ action, state: 'start' });
        return { stage, reload, underneath, notice, press, owner };
    }

    const texts = (container: PIXI.Container): string[] =>
        container.children.flatMap(child => [
            ...(child instanceof PIXI.Text ? [child.text] : []),
            ...(child instanceof PIXI.Container ? texts(child) : []),
        ]);

    it('says what happened, with one Reload button', () => {
        const { stage, notice } = raise();
        expect(stage.children).toContain(notice.popup.container);
        expect(notice.popup.container.visible).toBeTrue();
        const shown = texts(notice.popup.container);
        expect(shown.some(text => text.includes('lost sync with the server')))
            .toBeTrue();
        expect(shown.some(text => text.includes('could not recover')))
            .toBeTrue();
        expect(DESYNC_NOTICE_TEXT).toContain('could not recover');
        expect(shown.filter(text => text === DESYNC_NOTICE_BUTTON).length)
            .toBe(1);
        expect(shown).not.toContain('Refuse');
    });

    it('Escape (and every key but accept) neither closes it nor reaches '
        + 'what is underneath', async () => {
        const { reload, underneath, notice, press } = raise();
        expect(MenuControls.focused).toBe(notice.keys);
        for (const action of ['depart', 'up', 'down', 'left'] as const) {
            press(action);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(notice.popup.container.visible).toBeTrue();
        expect(reload).not.toHaveBeenCalled();
        expect(underneath).not.toHaveBeenCalled();
    });

    it('accept reloads', () => {
        const { reload, press } = raise();
        press('accept');
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('the Reload button reloads, and the notice stays up', async () => {
        const { reload, notice } = raise();
        const choice = (notice.popup as unknown as {
            choice: Subject<'accept' | 'refuse'>,
        }).choice;
        // The button's click feeds the popup's choice (offer_popup.ts
        // addButtons); a press goes the same way.
        choice.next('accept');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(reload).toHaveBeenCalledTimes(1);
        // Should the page still be here, the frozen world stays covered.
        expect(notice.popup.container.visible).toBeTrue();
    });
});
