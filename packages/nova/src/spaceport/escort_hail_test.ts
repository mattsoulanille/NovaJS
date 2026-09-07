import 'jasmine';
import {
    CANNOT_UPGRADE_TEXT, COMM_DEFERRED_COLOR, COMM_LABEL_COLOR,
    COMM_VALUE_COLOR, EscortManagement, escortPressAction, escortReadout,
    HailContext, HailPage, hailPress, identityRuns, SALE_QUEUED_TEXT,
    UPGRADE_QUEUED_TEXT,
} from './hail_dialog.js';
import { escortButtonSlots } from './hail_layout.js';

/**
 * ============================================================================
 * The escort management box, headless
 * ============================================================================
 *
 * PICT 8513's box is four pure pieces — the price readout
 * ({@link escortReadout}), the button column ({@link escortButtonSlots}),
 * the press resolver ({@link escortPressAction}) and the page machine
 * ({@link hailPress}) — so everything the four reference captures pin can
 * be checked without a canvas.
 *
 *   hail/hail_escort.png           a HIRED Terrapin. Readout: "Upgrade Cost:
 *                                  50,000 credits", a BLANK ROW, then "Pay:
 *                                  1,100 credits per day". Column: Upgrade
 *                                  Escort live, Sell Escort GREYED, Release
 *                                  live, Close Channel live.
 *   hail/hail_captured_escort.png  a CAPTURED Pirate Viper. Readout:
 *                                  "Upgrade Cost: 35,000 credits" and "Sell
 *                                  Price: 11,000 credits" on ADJACENT rows,
 *                                  no wage. Column: all four live.
 *   hail/hail_escort_upgrading.png the SAME hired Terrapin one press later:
 *                                  the channel is still open, row 1 of the
 *                                  readout now reads "Will be upgraded at
 *                                  next shipyard" in 0xc0c0c0, the wage line
 *                                  is unchanged, and the top button reads
 *                                  "Cancel Upgrade".
 *   hail/sell_captured_escort.png  the SAME captured Viper one press later:
 *                                  "Upgrade Cost: 35,000 credits" still
 *                                  stands on row 1, row 2 has become "Will
 *                                  be sold off at next shipyard" in
 *                                  0xc0c0c0, and row 2 of the column reads
 *                                  "Cancel Sale" — with "Upgrade Escort"
 *                                  above it STILL LIVE.
 *
 * (The figures NovaJS quotes for the wage differ — see escort_fees_test.ts's
 * documented divergence — but the layout, the greying and the toggles are
 * the original's. The two queued-deal strings are STR# 2002 291 and 294
 * verbatim; string_table_integration_test.ts pins them against the data.)
 */

/** hail/hail_escort.png's hired Terrapin, priced by escort_fees. */
const HIRED: EscortManagement = {
    provenance: 'hired',
    upgrade: { toShip: 'nova:137', cost: 50_000, canAfford: true },
    dailyFee: 1_500,
};

/** hail/hail_captured_escort.png's captured Pirate Viper. */
const CAPTURED: EscortManagement = {
    provenance: 'captured',
    upgrade: { toShip: 'nova:167', cost: 35_000, canAfford: true },
    sell: { value: 11_000 },
};

function context(escort: EscortManagement): HailContext {
    return {
        variant: 'escort', image: null, heading: 'Hired Escort:\n Terrapin',
        body: escortReadout(escort), escort,
    };
}

function page(escort: EscortManagement): HailPage {
    return { phase: 'main', context: context(escort) };
}

/** The escort context after a press, for the toggle specs. */
function pressed(escort: EscortManagement,
    kind: 'upgradeEscort' | 'sellEscort'): EscortManagement {
    const next = hailPress(page(escort), { kind });
    if (next === 'close') {
        throw new Error('the deal rows must NOT close the channel');
    }
    return next.context.escort!;
}

describe('escortReadout (the escort box\'s upper well)', () => {
    it('lays a HIRED escort out as cost / BLANK / wage', () => {
        // The blank row is the reference's own: hail_escort.png's
        // "Upgrade Cost" and "Pay" lines sit two 15px rows apart because
        // the resale slot between them is empty for a hire.
        expect(escortReadout(HIRED)).toBe([
            'Upgrade Cost: 50,000 credits',
            '',
            'Pay: 1,500 credits per day',
        ].join('\n'));
    });

    it('lays a CAPTURED escort out as two ADJACENT rows, no wage', () => {
        expect(escortReadout(CAPTURED)).toBe([
            'Upgrade Cost: 35,000 credits',
            'Sell Price: 11,000 credits',
        ].join('\n'));
    });

    it('puts the UPGRADE row ABOVE the sell row, and both above Pay', () => {
        // The order STR# 2002 itself keeps them in: 292 "Upgrade Cost:",
        // 295 "Sell Price:", 296 "Pay:".
        expect(escortReadout({
            provenance: 'captured',
            upgrade: { toShip: 'x', cost: 1, canAfford: true },
            sell: { value: 2 },
            dailyFee: 3,
        }).split('\n')).toEqual([
            'Upgrade Cost: 1 credits',
            'Sell Price: 2 credits',
            'Pay: 3 credits per day',
        ]);
    });

    it('replaces the UPGRADE COST line with the original\'s deferred text '
        + 'once an upgrade is queued', () => {
            // hail/hail_escort_upgrading.png, verbatim: the price is no
            // longer the news, and the wage line below it is untouched.
            expect(escortReadout({ ...HIRED, pendingUpgrade: true }))
                .toBe([
                    'Will be upgraded at next shipyard',
                    '',
                    'Pay: 1,500 credits per day',
                ].join('\n'));
        });

    it('replaces the SELL PRICE line once a sale is queued, leaving the '
        + 'upgrade price standing', () => {
            // hail/sell_captured_escort.png, verbatim.
            expect(escortReadout({ ...CAPTURED, pendingSale: true }))
                .toBe([
                    'Upgrade Cost: 35,000 credits',
                    'Will be sold off at next shipyard',
                ].join('\n'));
        });

    it('says so when the class cannot be upgraded, rather than leaving the '
        + 'row blank', () => {
            expect(escortReadout({ provenance: 'hired', dailyFee: 200 }))
                .toBe([
                    'This ship class cannot be upgraded.',
                    '',
                    'Pay: 200 credits per day',
                ].join('\n'));
            // ...and a captured hull with no upgrade path says it too,
            // above its resale price.
            expect(escortReadout({
                provenance: 'captured', sell: { value: 11_000 },
            })).toBe([
                'This ship class cannot be upgraded.',
                'Sell Price: 11,000 credits',
            ].join('\n'));
        });

    it('trims the empty slot at the END', () => {
        // A captured hull with nothing but a sale is two rows, not three.
        expect(escortReadout({ provenance: 'captured' }))
            .toBe(CANNOT_UPGRADE_TEXT);
    });

    it('shows a FREE upgrade as 0 rather than hiding the line', () => {
        // The button belongs to the price, so a zero price still has one.
        expect(escortReadout({
            provenance: 'captured',
            upgrade: { toShip: 'x', cost: 0, canAfford: true },
        })).toBe('Upgrade Cost: 0 credits');
    });
});

describe('the readout\'s colours', () => {
    it('draws a queued-deal line DIM (0xc0c0c0), not white', () => {
        // Measured off hail/hail_escort_upgrading.png and
        // hail/sell_captured_escort.png: the deferred lines are exactly
        // 192,192,192 where a value is 255,255,255 and a label 128,128,128.
        for (const line of [UPGRADE_QUEUED_TEXT, SALE_QUEUED_TEXT,
            CANNOT_UPGRADE_TEXT]) {
            expect(identityRuns(line))
                .toEqual([[{ text: line, color: COMM_DEFERRED_COLOR }]]);
        }
    });

    it('still splits an ordinary price line into label and figure', () => {
        expect(identityRuns('Upgrade Cost: 50,000 credits')).toEqual([[
            { text: 'Upgrade Cost: ', color: COMM_LABEL_COLOR },
            { text: '50,000 credits', color: COMM_VALUE_COLOR },
        ]]);
    });
});

describe('escortButtonSlots (the escort box\'s four fixed rows)', () => {
    it('always draws the same four rows, in the reference\'s order', () => {
        for (const escort of [HIRED, CAPTURED]) {
            expect(escortButtonSlots(escort).map(({ slot }) => slot))
                .toEqual(['upgradeEscort', 'sellEscort', 'release', 'close']);
        }
    });

    it('GREYS Sell Escort for a hired escort — its ship was never the '
        + 'player\'s to sell', () => {
            expect(escortButtonSlots(HIRED)).toEqual([
                { slot: 'upgradeEscort', enabled: true },
                { slot: 'sellEscort', enabled: false },
                { slot: 'release', enabled: true },
                { slot: 'close', enabled: true },
            ]);
        });

    it('lights all four for a captured escort', () => {
        expect(escortButtonSlots(CAPTURED)).toEqual([
            { slot: 'upgradeEscort', enabled: true },
            { slot: 'sellEscort', enabled: true },
            { slot: 'release', enabled: true },
            { slot: 'close', enabled: true },
        ]);
    });

    it('turns the upgrade row into a LIVE Cancel Upgrade while one is '
        + 'queued', () => {
            // hail/hail_escort_upgrading.png. Live even for a player who
            // could not afford to queue it again: un-queueing must never
            // be refusable.
            const broke: EscortManagement = {
                ...HIRED, pendingUpgrade: true,
                upgrade: {
                    toShip: 'nova:137', cost: 50_000, canAfford: false,
                },
            };
            expect(escortButtonSlots(broke)[0])
                .toEqual({ slot: 'cancelUpgrade', enabled: true });
        });

    it('turns the sale row into a LIVE Cancel Sale while one is queued, and '
        + 'leaves Upgrade Escort LIVE beside it', () => {
            // hail/sell_captured_escort.png: mutual exclusion is enforced
            // by the press cancelling the other deal, NOT by greying.
            const slots = escortButtonSlots({ ...CAPTURED, pendingSale: true });
            expect(slots[1]).toEqual({ slot: 'cancelSale', enabled: true });
            expect(slots[0]).toEqual({ slot: 'upgradeEscort', enabled: true });
        });

    it('greys an upgrade the player cannot AFFORD, keeping the row', () => {
        // Greyed rather than hidden, so the price in the readout above
        // still has a button to belong to. Affordability is re-checked
        // when the deal actually settles, as the player leaves a spaceport.
        const broke: EscortManagement = {
            ...CAPTURED,
            upgrade: { toShip: 'nova:167', cost: 35_000, canAfford: false },
        };
        expect(escortButtonSlots(broke)[0])
            .toEqual({ slot: 'upgradeEscort', enabled: false });
        // Everything else is untouched: being poor does not stop a sale.
        expect(escortButtonSlots(broke)[1])
            .toEqual({ slot: 'sellEscort', enabled: true });
    });

    it('greys an upgrade a class has no offer for', () => {
        expect(escortButtonSlots({ provenance: 'captured' })[0])
            .toEqual({ slot: 'upgradeEscort', enabled: false });
    });

    it('keeps Release and Close Channel live in every case', () => {
        for (const escort of [HIRED, CAPTURED, { provenance: 'hired' as const },
            { provenance: 'captured' as const },
            { ...CAPTURED, pendingSale: true },
            { ...CAPTURED, pendingUpgrade: true }]) {
            const slots = escortButtonSlots(escort);
            expect(slots[2]).toEqual({ slot: 'release', enabled: true });
            expect(slots[3]).toEqual({ slot: 'close', enabled: true });
        }
    });
});

describe('escortPressAction (which action a row means right now)', () => {
    it('queues, then cancels, on the same button', () => {
        expect(escortPressAction(HIRED, 'upgrade')).toBe('queueUpgrade');
        expect(escortPressAction({ ...HIRED, pendingUpgrade: true },
            'upgrade')).toBe('cancelUpgrade');
        expect(escortPressAction(CAPTURED, 'sell')).toBe('queueSale');
        expect(escortPressAction({ ...CAPTURED, pendingSale: true }, 'sell'))
            .toBe('cancelSale');
    });

    it('offers nothing on a row that has nothing to offer', () => {
        // A hired escort has no sale...
        expect(escortPressAction(HIRED, 'sell')).toBeUndefined();
        // ...a class with no upgrade offer has no upgrade...
        expect(escortPressAction({ provenance: 'captured' }, 'upgrade'))
            .toBeUndefined();
        // ...and neither does an unaffordable one.
        expect(escortPressAction({
            ...HIRED,
            upgrade: { toShip: 'x', cost: 1, canAfford: false },
        }, 'upgrade')).toBeUndefined();
    });

    it('CANCELS regardless of affordability — un-queueing always works',
        () => {
            expect(escortPressAction({
                ...HIRED, pendingUpgrade: true,
                upgrade: { toShip: 'x', cost: 1, canAfford: false },
            }, 'upgrade')).toBe('cancelUpgrade');
        });

    it('always releases', () => {
        expect(escortPressAction({ provenance: 'hired' }, 'release'))
            .toBe('release');
    });
});

describe('the deal rows TOGGLE and the channel stays open', () => {
    it('queues an upgrade and re-renders the readout, keeping the channel',
        () => {
            const next = pressed(HIRED, 'upgradeEscort');
            expect(next.pendingUpgrade).toBeTrue();
            // ...and the body the dialog draws moves with it.
            const page1 = hailPress(page(HIRED), { kind: 'upgradeEscort' });
            expect(page1).not.toBe('close');
            expect((page1 as HailPage).context.body)
                .toBe(escortReadout(next));
            expect((page1 as HailPage).context.body.split('\n')[0])
                .toBe(UPGRADE_QUEUED_TEXT);
        });

    it('un-queues on the next press, restoring the price line', () => {
        const queued = pressed(HIRED, 'upgradeEscort');
        const cancelled = pressed(queued, 'upgradeEscort');
        expect(cancelled.pendingUpgrade).toBeFalse();
        expect(escortReadout(cancelled)).toBe(escortReadout(HIRED));
    });

    it('queues a sale and re-renders the sell row', () => {
        const next = pressed(CAPTURED, 'sellEscort');
        expect(next.pendingSale).toBeTrue();
        expect(escortReadout(next).split('\n')[1]).toBe(SALE_QUEUED_TEXT);
        expect(pressed(next, 'sellEscort').pendingSale).toBeFalse();
    });

    it('queueing one CANCELS the other', () => {
        const sold = pressed(CAPTURED, 'sellEscort');
        const upgrading = pressed(sold, 'upgradeEscort');
        expect(upgrading.pendingUpgrade).toBeTrue();
        expect(upgrading.pendingSale).toBeFalse();
        const soldAgain = pressed(upgrading, 'sellEscort');
        expect(soldAgain.pendingSale).toBeTrue();
        expect(soldAgain.pendingUpgrade).toBeFalse();
    });

    it('IGNORES a press the context does not offer', () => {
        // The same rule the assist and bribe slots follow: a press cannot
        // conjure a function the box did not draw a live button for. A
        // hired escort has no sale...
        const hired = page(HIRED);
        expect(hailPress(hired, { kind: 'sellEscort' })).toBe(hired);
        // ...and a class with no upgrade offer has no upgrade.
        const plain = page({ provenance: 'captured', sell: { value: 10 } });
        expect(hailPress(plain, { kind: 'upgradeEscort' })).toBe(plain);
    });

    it('IGNORES every escort press on a non-escort context', () => {
        // A ship or planet comm has no escort box at all.
        const ship: HailPage = {
            phase: 'main',
            context: {
                variant: 'ship', image: null, heading: 'Class: Terrapin',
                body: 'Channel open.',
            },
        };
        for (const kind of
            ['upgradeEscort', 'sellEscort', 'releaseEscort'] as const) {
            expect(hailPress(ship, { kind })).toBe(ship);
        }
    });
});

describe('Release is the one press that ends the conversation', () => {
    it('closes the channel on Release, for both kinds of escort', () => {
        expect(hailPress(page(HIRED), { kind: 'releaseEscort' }))
            .toBe('close');
        expect(hailPress(page(CAPTURED), { kind: 'releaseEscort' }))
            .toBe('close');
    });

    it('closes even with a deal queued — the escort takes it with it', () => {
        expect(hailPress(page({ ...CAPTURED, pendingSale: true }),
            { kind: 'releaseEscort' })).toBe('close');
    });
});
