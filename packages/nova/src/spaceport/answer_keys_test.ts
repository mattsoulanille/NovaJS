import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { beginPixiTextEntry } from '../input_focus.js';
import type { ControlEvent } from '../nova_plugin/core/index.js';
import { overrideEnhancements } from '../enhancements.js';
import { AlertConfirmDialog } from './alert_confirm.js';
import { HailCallbacks, HailContext, HailDialog } from './hail_dialog.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { OfferPopup, PopupChoice } from './offer_popup.js';

/**
 * `y` and `n` answer a choice dialog (Matthew, 2026-11-28: "`y` and `n`
 * should apply to choice dialog boxes (including when choices are
 * renamed)"): `y` presses the accept / affirmative button and `n` the
 * refuse / negative one, whatever the buttons read. The keys reach the
 * dialog through the key relay's raw-key path
 * (MenuControls.pressAnswerKey), as Return and Escape do, and only the
 * dialog on top of the focus stack answers them.
 */
describe('y / n on a choice dialog', () => {
    beforeAll(() => installHeadlessPixi());

    const DISPLAY_ASSETS = {
        spriteFromPict: () => new PIXI.Sprite(),
        spriteFromPictAsync: async () => new PIXI.Sprite(),
        textureFromPict: () => PIXI.Texture.EMPTY,
        textureFromPictAsync: async () => PIXI.Texture.EMPTY,
        data: { Sound: { get: async () => undefined } },
    } as unknown as DisplayAssetDataInterface;

    const Y = { key: 'y' };
    const N = { key: 'n' };

    async function settle() {
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    let popups: OfferPopup[] = [];
    afterEach(() => {
        popups.forEach(popup => popup.dismiss());
        popups = [];
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    function raise(buttons: { accept: string, refuse?: string | null }) {
        const popup = new OfferPopup(DISPLAY_ASSETS,
            new Subject<ControlEvent>());
        popups.push(popup);
        let answer: PopupChoice | undefined;
        const shown = popup.show('Pirates have raided the convoy.', buttons)
            .then(choice => { answer = choice; });
        return { popup, shown, answer: () => answer };
    }

    describe('the key layer (MenuControls.pressAnswerKey)', () => {
        it('leaves y and n alone with nothing focused (y hails in flight)',
            () => {
                expect(MenuControls.focused).toBeUndefined();
                expect(MenuControls.pressAnswerKey(Y)).toBeFalse();
                expect(MenuControls.pressAnswerKey(N)).toBeFalse();
            });

        it('leaves them alone on a surface that is not a choice dialog '
            + '(the shipyard\'s y is Your Ships)', () => {
                const yourShips = jasmine.createSpy('Your Ships');
                const shipyard = new MenuControls(new Subject<ControlEvent>(),
                    { hail: yourShips });
                shipyard.bind();
                expect(MenuControls.pressAnswerKey(Y)).toBeFalse();
                expect(MenuControls.pressAnswerKey(N)).toBeFalse();
            });

        it('answers only the TOP surface', () => {
            const below = new MenuControls(new Subject<ControlEvent>());
            const yes = jasmine.createSpy('yes under');
            below.answerButtons = { yes };
            below.bind();
            const above = new MenuControls(new Subject<ControlEvent>());
            above.bind();
            expect(MenuControls.pressAnswerKey(Y)).toBeFalse();
            expect(yes).not.toHaveBeenCalled();
            above.unbind();
            expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
            expect(yes).toHaveBeenCalledTimes(1);
        });

        it('takes either case, but not with Command, Control or Option, '
            + 'not a key repeat and not under a text field', () => {
                const yes = jasmine.createSpy('yes');
                const no = jasmine.createSpy('no');
                const dialog = new MenuControls(new Subject<ControlEvent>());
                dialog.answerButtons = { yes, no };
                dialog.bind();
                expect(MenuControls.pressAnswerKey({ key: 'Y' })).toBeTrue();
                expect(MenuControls.pressAnswerKey({ key: 'N' })).toBeTrue();
                expect(yes).toHaveBeenCalledTimes(1);
                expect(no).toHaveBeenCalledTimes(1);

                for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
                    expect(MenuControls.pressAnswerKey(
                        { key: 'y', [modifier]: true })).toBeFalse();
                }
                // A held key is still the dialog's (consumed), but presses
                // nothing more: one press, one answer.
                expect(MenuControls.pressAnswerKey({ key: 'y', repeat: true }))
                    .toBeTrue();
                const release = beginPixiTextEntry();
                expect(MenuControls.pressAnswerKey(Y)).toBeFalse();
                release();
                expect(MenuControls.pressAnswerKey({ key: 'x' })).toBeFalse();
                expect(yes).toHaveBeenCalledTimes(1);
                expect(no).toHaveBeenCalledTimes(1);
                dialog.unbind();
            });
    });

    describe('a mission offer (OfferPopup)', () => {
        it('n presses a RENAMED refuse button, y a renamed accept button',
            async () => {
                const first = raise(
                    { accept: 'Go after them', refuse: 'Let it go' });
                expect(MenuControls.pressAnswerKey(N)).toBeTrue();
                await first.shown;
                expect(first.answer()).toBe('refuse');

                const second = raise(
                    { accept: 'Go after them', refuse: 'Let it go' });
                expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
                await second.shown;
                expect(second.answer()).toBe('accept');
            });

        it('answers the default Yes / No the same way', async () => {
            const no = raise({ accept: 'Yes', refuse: 'No' });
            expect(MenuControls.pressAnswerKey(N)).toBeTrue();
            await no.shown;
            expect(no.answer()).toBe('refuse');
            const yes = raise({ accept: 'Yes', refuse: 'No' });
            expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
            await yes.shown;
            expect(yes.answer()).toBe('accept');
        });

        it('with enhYesNoKeys OFF, y and n are game keys again (the '
            + 'dialog answers only clicks and Return)', async () => {
                overrideEnhancements({ enhYesNoKeys: false });
                try {
                    const offer = raise(
                        { accept: 'Go after them', refuse: 'Let it go' });
                    expect(MenuControls.pressAnswerKey(N)).toBeFalse();
                    expect(MenuControls.pressAnswerKey(Y)).toBeFalse();
                    await settle();
                    expect(offer.answer()).toBeUndefined();
                } finally {
                    overrideEnhancements({});
                }
            });

        it('a can\'t-refuse offer\'s lone Okay: n does nothing, y presses '
            + 'it', async () => {
                const offer = raise({ accept: 'Okay', refuse: null });
                expect(MenuControls.pressAnswerKey(N)).toBeTrue();
                await settle();
                expect(offer.answer()).toBeUndefined();
                expect(offer.popup.container.visible).toBeTrue();
                expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
                await offer.shown;
                expect(offer.answer()).toBe('accept');
            });

        it('a held y accepts one offer, not the one after it', async () => {
            const first = raise({ accept: 'Yes', refuse: 'No' });
            expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
            await first.shown;
            const second = raise({ accept: 'Yes', refuse: 'No' });
            expect(MenuControls.pressAnswerKey({ key: 'y', repeat: true }))
                .toBeTrue();
            await settle();
            expect(second.answer()).toBeUndefined();
        });

        it('a popup without control events (the About box) takes no keys',
            () => {
                const popup = new OfferPopup(DISPLAY_ASSETS);
                popups.push(popup);
                void popup.show('About', { accept: 'Okay' });
                expect(MenuControls.pressAnswerKey(Y)).toBeFalse();
            });
    });

    describe('the jettison confirm (AlertConfirmDialog)', () => {
        it('y is OK and n is Cancel', async () => {
            const alert = new AlertConfirmDialog(new Subject<ControlEvent>(),
                'JettisonConfirm');
            const cancelled = alert.show('Jettison?');
            expect(MenuControls.pressAnswerKey(N)).toBeTrue();
            expect(await cancelled).toBeFalse();
            const confirmed = alert.show('Jettison?');
            expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
            expect(await confirmed).toBeTrue();
            expect(MenuControls.focused).toBeUndefined();
        });
    });

    describe('the hail dialog', () => {
        let callbacks: jasmine.SpyObj<HailCallbacks>;
        let dialog: HailDialog;
        beforeEach(() => {
            callbacks = jasmine.createSpyObj<HailCallbacks>('callbacks', [
                'requestAssistance', 'bribe', 'messagePlayer',
                'escortAction', 'playSound', 'lowerPrice',
            ]);
            dialog = new HailDialog(DISPLAY_ASSETS,
                new Subject<ControlEvent>(), callbacks);
        });
        afterEach(() => dialog.dismiss());

        function drawn(): string[] {
            const out: string[] = [];
            const walk = (node: PIXI.DisplayObject) => {
                if (node instanceof PIXI.Text) {
                    out.push(node.text);
                }
                if (node instanceof PIXI.Container) {
                    node.children.forEach(walk);
                }
            };
            walk(dialog.container);
            return out;
        }

        async function haggle(bribe: NonNullable<HailContext['bribe']>) {
            void dialog.show({
                variant: 'ship', heading: 'Class: Fed Destroyer', image: null,
                body: 'What is it?', bribe,
            });
            await settle();
            dialog['phase'] = 'haggle';
            await dialog['render']();
        }

        it('the comm page keeps y and n as game keys (the original\'s y '
            + 'does nothing there, K5 wave 39)', async () => {
                void dialog.show({
                    variant: 'ship', heading: 'Class: Terrapin', image: null,
                    body: 'Channel open.', assist: { free: false },
                });
                await settle();
                expect(MenuControls.pressAnswerKey(Y)).toBeFalse();
                expect(MenuControls.pressAnswerKey(N)).toBeFalse();
                expect(dialog.container.visible).toBeTrue();
            });

        it('a price popup: y presses Accept Price, n presses nothing '
            + '(Lower Price is a counter-offer, not a no)', async () => {
                await haggle({ amount: 3000, canAfford: true,
                    purpose: 'mercy' });
                expect(drawn()).toContain('Accept Price');
                expect(MenuControls.pressAnswerKey(N)).toBeTrue();
                await settle();
                expect(callbacks.lowerPrice).not.toHaveBeenCalled();
                expect(callbacks.bribe).not.toHaveBeenCalled();
                expect(drawn()).toContain('Accept Price');
                expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
                await settle();
                expect(callbacks.bribe).toHaveBeenCalledTimes(1);
            });

        it('NovaJS\'s Pay / Never Mind popup: n is Never Mind, y pays',
            async () => {
                const assist = { amount: 3000, canAfford: true,
                    purpose: 'assist' as const };
                await haggle(assist);
                expect(drawn()).toContain('Never Mind');
                expect(MenuControls.pressAnswerKey(N)).toBeTrue();
                await settle();
                expect(drawn()).not.toContain('Never Mind');
                expect(callbacks.bribe).not.toHaveBeenCalled();
                // Back on the comm page, whose y / n are game keys again.
                expect(MenuControls.pressAnswerKey(Y)).toBeFalse();

                dialog['phase'] = 'haggle';
                await dialog['render']();
                expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
                await settle();
                expect(callbacks.bribe).toHaveBeenCalledTimes(1);
            });

        it('an unaffordable price\'s lone Never Mind: y does nothing, n '
            + 'backs out', async () => {
                await haggle({ amount: 3000, canAfford: false,
                    purpose: 'landing' });
                expect(drawn()).toContain('Never Mind');
                expect(MenuControls.pressAnswerKey(Y)).toBeTrue();
                await settle();
                expect(drawn()).toContain('Never Mind');
                expect(MenuControls.pressAnswerKey(N)).toBeTrue();
                await settle();
                expect(drawn()).not.toContain('Never Mind');
                expect(callbacks.bribe).not.toHaveBeenCalled();
            });
    });
});
