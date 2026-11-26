import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import { Button } from './button.js';
import {
    HAIL_SND_BUTTON, HailCallbacks, HailContext, HailDialog,
} from './hail_dialog.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';

/**
 * ============================================================================
 * THE HAIL DIALOG'S LETTER KEYS
 * ============================================================================
 *
 * Matthew's ruling: "In the hailing dialog, `g` should send greetings and
 * `r` should beg for mercy (if they're hostile. Otherwise, it requests
 * assistance)."
 *
 * The keys arrive the way every landed-UI key does — as ControlActions
 * matched on KeyboardEvent.code through settings/controls.json — so 'g' is
 * the 'gamble' action (KeyG) and 'r' is 'recharge' (KeyR). Matthew,
 * 2026-11-24: "'o' should offer bribe when hailing a planet", so 'o' (the
 * 'outfitter' action, KeyO) presses the offer slot, but only while it reads
 * Offer Bribe. Each key presses the BUTTON the dialog drew, so these specs
 * drive a real (headless) HailDialog
 * through its control stream and read back what it drew, rather than
 * pinning a parallel decision function.
 */

/** Everything a button / background asks the asset layer for: blanks. */
const DISPLAY_ASSETS = {
    spriteFromPict: () => new PIXI.Sprite(),
    spriteFromPictAsync: async () => new PIXI.Sprite(),
    textureFromPict: () => PIXI.Texture.EMPTY,
    textureFromPictAsync: async () => PIXI.Texture.EMPTY,
} as unknown as DisplayAssetDataInterface;

const SHIP: HailContext = {
    variant: 'ship', heading: 'Class: Terrapin', image: null,
    body: 'Channel open.', greeting: 'Good day, Captain.',
    assist: { free: false },
};
const HOSTILE: HailContext = {
    variant: 'ship', heading: 'Class: Fed Destroyer\nStatus: Hostile',
    image: null, body: 'What is it?',
    bribe: { amount: 3000, canAfford: true, purpose: 'mercy' },
};
const HOSTILE_UNBUYABLE: HailContext = {
    variant: 'ship', heading: 'Class: Fed Destroyer\nStatus: Hostile',
    image: null, body: 'What is it?', mercyRefused: 'In your dreams, pal.',
};
/** A port that takes bribes: its offer slot is a live Offer Bribe. */
const PORT_BRIBE: HailContext = {
    variant: 'planet', heading: 'Earth', image: null,
    body: 'Channel open to Earth.',
    bribe: { amount: 5000, canAfford: true, purpose: 'landing' },
};
/** A port with nothing to sell: its offer slot is a GREYED Demand Tribute. */
const PORT_TRIBUTE: HailContext = {
    variant: 'planet', heading: 'Earth', image: null,
    body: 'Channel open to Earth.',
};

/** Lets the dialog's async renders (and show()'s bind) settle. */
async function settle() {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

/** Every string the dialog currently draws. */
function drawnText(dialog: HailDialog): string[] {
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

describe('the hail dialog\'s letter keys (g greets, r assists / begs, ' +
    'o bribes)', () => {
    let controls: Subject<ControlEvent>;
    let callbacks: jasmine.SpyObj<HailCallbacks>;
    let dialog: HailDialog;

    beforeAll(() => installHeadlessPixi());

    beforeEach(() => {
        controls = new Subject<ControlEvent>();
        callbacks = jasmine.createSpyObj<HailCallbacks>('callbacks', [
            'requestAssistance', 'bribe', 'messagePlayer', 'escortAction',
            'playSound',
        ]);
        callbacks.requestAssistance.and.returnValue(
            { answer: 'All right, I\'ll help you.', haggle: false });
        callbacks.messagePlayer.and.returnValue('Message sent.');
        dialog = new HailDialog(DISPLAY_ASSETS, controls, callbacks);
    });

    afterEach(() => {
        // Off the process-wide focus stack whatever the spec did.
        dialog.dismiss();
    });

    async function open(context: HailContext) {
        void dialog.show(context);
        await settle();
        expect(dialog.container.visible).toBeTrue();
    }

    async function press(action: ControlAction) {
        controls.next({ action, state: 'start' });
        await settle();
    }

    function buttonBeeps() {
        return callbacks.playSound.calls.allArgs()
            .filter(([id]) => id === HAIL_SND_BUTTON).length;
    }

    it('g (KeyG, the \'gamble\' action) presses Greetings', async () => {
        await open(SHIP);
        expect(drawnText(dialog)).not.toContain('Good day, Captain.');
        await press('gamble');
        expect(drawnText(dialog)).toContain('Good day, Captain.');
        expect(buttonBeeps()).toBe(1);
        expect(callbacks.requestAssistance).not.toHaveBeenCalled();
    });

    it('g in a channel to another player sends them a greeting', async () => {
        await open({ ...SHIP, playerChannel: { hostile: false } });
        await press('gamble');
        expect(callbacks.messagePlayer).toHaveBeenCalledOnceWith('greetings');
    });

    it('r (KeyR, the \'recharge\' action) requests assistance from a ' +
        'ship that is not hostile', async () => {
            await open(SHIP);
            await press('recharge');
            expect(callbacks.requestAssistance).toHaveBeenCalledTimes(1);
            expect(drawnText(dialog)).toContain('All right, I\'ll help you.');
            // Request Assistance stays in its slot, so r can ask again.
            expect(drawnText(dialog)).toContain('Request Assistance');
        });

    it('r begs a HOSTILE ship for mercy: onto the haggle page', async () => {
        await open(HOSTILE);
        expect(drawnText(dialog)).toContain('Beg For Mercy');
        await press('recharge');
        expect(callbacks.requestAssistance).not.toHaveBeenCalled();
        expect(drawnText(dialog))
            .toContain('They demand 3,000 credits to let you go.');
    });

    it('r begs a hostile ship that will not be bought, and hears no',
        async () => {
            await open(HOSTILE_UNBUYABLE);
            await press('recharge');
            expect(callbacks.requestAssistance).not.toHaveBeenCalled();
            expect(drawnText(dialog)).toContain('In your dreams, pal.');
        });

    it('r begs mercy of a hostile PLAYER (a message, not a request)',
        async () => {
            await open({ ...SHIP, assist: undefined,
                playerChannel: { hostile: true } });
            await press('recharge');
            expect(callbacks.messagePlayer).toHaveBeenCalledOnceWith('mercy');
            expect(callbacks.requestAssistance).not.toHaveBeenCalled();
        });

    it('a GREYED button ignores its key (a port\'s Demand Tribute)',
        async () => {
            await open(PORT_TRIBUTE);
            const before = drawnText(dialog);
            await press('recharge');
            expect(buttonBeeps()).toBe(0);
            expect(callbacks.bribe).not.toHaveBeenCalled();
            expect(callbacks.requestAssistance).not.toHaveBeenCalled();
            expect(drawnText(dialog)).toEqual(before);
        });

    it('o (KeyO, the \'outfitter\' action) presses a port\'s Offer Bribe',
        async () => {
            await open(PORT_BRIBE);
            expect(drawnText(dialog)).toContain('Offer Bribe');
            await press('outfitter');
            expect(buttonBeeps()).toBe(1);
            expect(drawnText(dialog))
                .toContain('They demand 5,000 credits to let you land.');
        });

    it('o is ignored by an Offer Bribe drawn greyed', async () => {
        await open(PORT_BRIBE);
        // No context greys Offer Bribe today; grey the drawn button itself,
        // which is all the key ever looks at.
        const bribe = dialog['keyedButtons'].bribe;
        expect(bribe).toBeDefined();
        bribe!.state = 'grey';
        const before = drawnText(dialog);
        await press('outfitter');
        expect(buttonBeeps()).toBe(0);
        expect(drawnText(dialog)).toEqual(before);
    });

    it('o does nothing when the offer slot is not Offer Bribe', async () => {
        // A ship's Request Assistance, a hostile ship's Beg For Mercy and a
        // port's greyed Demand Tribute all leave 'o' with nothing to press.
        for (const context of [SHIP, HOSTILE, PORT_TRIBUTE]) {
            await open(context);
            const before = drawnText(dialog);
            await press('outfitter');
            expect(drawnText(dialog)).toEqual(before);
            await press('depart');
        }
        expect(buttonBeeps()).toBe(0);
        expect(callbacks.requestAssistance).not.toHaveBeenCalled();
        expect(callbacks.bribe).not.toHaveBeenCalled();
    });

    it('neither key does anything on the haggle page, which has no ' +
        'Greetings or offer row', async () => {
            await open(HOSTILE);
            await press('recharge');
            const haggle = drawnText(dialog);
            const beeps = buttonBeeps();
            await press('gamble');
            await press('recharge');
            expect(drawnText(dialog)).toEqual(haggle);
            expect(buttonBeeps()).toBe(beeps);
        });

    it('keeps g and r from everything under it while open, and lets go ' +
        'when the channel closes', async () => {
            // Stand-in for any surface below the dialog that also uses
            // these keys (the bar's Gamble, the spaceport's Recharge).
            const below = new MenuControls(controls, {
                gamble: jasmine.createSpy('below gamble'),
                recharge: jasmine.createSpy('below recharge'),
            });
            below.bind();
            try {
                await open(SHIP);
                // The gate client/game_session.ts reads to keep a press
                // out of the simulation (so 'r' is not also nearestTarget).
                expect(MenuControls.focused).toBeDefined();
                expect(MenuControls.focused).not.toBe(below);
                await press('gamble');
                await press('recharge');
                expect(below.controls.gamble).not.toHaveBeenCalled();
                expect(below.controls.recharge).not.toHaveBeenCalled();
                await press('depart');
                expect(dialog.container.visible).toBeFalse();
                expect(MenuControls.focused).toBe(below);
            } finally {
                below.unbind();
            }
        });
});

describe('Button.activate (a keyboard press of a button)', () => {
    beforeAll(() => installHeadlessPixi());

    it('fires click exactly as a pointer click does', () => {
        const button = new Button(DISPLAY_ASSETS, 'Greetings', 100);
        const clicks: unknown[] = [];
        button.click.subscribe(click => clicks.push(click));
        expect(button.activate()).toBeTrue();
        expect(clicks).toEqual([{ option: false, shift: false }]);
    });

    it('is ignored by a greyed button', () => {
        const button = new Button(DISPLAY_ASSETS, 'Demand Tribute', 100);
        button.state = 'grey';
        const click = jasmine.createSpy('click');
        button.click.subscribe(click);
        expect(button.activate()).toBeFalse();
        expect(click).not.toHaveBeenCalled();
    });
});
