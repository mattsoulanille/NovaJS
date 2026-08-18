import 'jasmine';
import {
    EscortManagement, escortReadout, HailContext, HailPage, hailPress,
} from './hail_dialog.js';
import { escortButtonSlots } from './hail_layout.js';

/**
 * ============================================================================
 * The escort management box, headless
 * ============================================================================
 *
 * PICT 8513's box is three pure pieces — the price readout
 * ({@link escortReadout}), the button column ({@link escortButtonSlots}) and
 * the page machine ({@link hailPress}) — so everything the two reference
 * captures pin can be checked without a canvas.
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
 *
 * (The figures NovaJS quotes for the wage differ — see escort_fees_test.ts's
 * documented divergence — but the layout and the greying are the original's.)
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

    it('trims the empty slots at the ENDS', () => {
        // A hired escort whose class cannot be upgraded gets ONE line, not
        // two blank rows and a wage.
        expect(escortReadout({ provenance: 'hired', dailyFee: 200 }))
            .toBe('Pay: 200 credits per day');
        // ...and a captured hull with no upgrade path gets just its price.
        expect(escortReadout({
            provenance: 'captured', sell: { value: 11_000 },
        })).toBe('Sell Price: 11,000 credits');
    });

    it('is empty when there is nothing at all to report', () => {
        expect(escortReadout({ provenance: 'captured' })).toBe('');
    });

    it('shows a FREE upgrade as 0 rather than hiding the line', () => {
        // The button belongs to the price, so a zero price still has one.
        expect(escortReadout({
            provenance: 'captured',
            upgrade: { toShip: 'x', cost: 0, canAfford: true },
        })).toBe('Upgrade Cost: 0 credits');
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

    it('greys an upgrade the player cannot AFFORD, keeping the row', () => {
        // Greyed rather than hidden, so the price in the readout above
        // still has a button to belong to.
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

    it('greys an upgrade a class has no target for', () => {
        expect(escortButtonSlots({ provenance: 'captured' })[0])
            .toEqual({ slot: 'upgradeEscort', enabled: false });
    });

    it('keeps Release and Close Channel live in every case', () => {
        for (const escort of [HIRED, CAPTURED, { provenance: 'hired' as const },
            { provenance: 'captured' as const }]) {
            const slots = escortButtonSlots(escort);
            expect(slots[2]).toEqual({ slot: 'release', enabled: true });
            expect(slots[3]).toEqual({ slot: 'close', enabled: true });
        }
    });
});

describe('the escort box\'s presses all end the conversation', () => {
    it('closes the channel on Release, for both kinds of escort', () => {
        expect(hailPress(page(HIRED), { kind: 'releaseEscort' }))
            .toBe('close');
        expect(hailPress(page(CAPTURED), { kind: 'releaseEscort' }))
            .toBe('close');
    });

    it('closes the channel on Sell — a sold hull is not the player\'s to '
        + 'manage any more', () => {
            expect(hailPress(page(CAPTURED), { kind: 'sellEscort' }))
                .toBe('close');
        });

    it('closes the channel on Upgrade — the escort is a DIFFERENT CLASS '
        + 'now, so every figure the box quoted is stale', () => {
            expect(hailPress(page(HIRED), { kind: 'upgradeEscort' }))
                .toBe('close');
        });

    it('IGNORES a press the context does not offer', () => {
        // The same rule the assist and bribe slots follow: a press cannot
        // conjure a function the box did not draw a live button for. A
        // hired escort has no sale...
        const hired = page(HIRED);
        expect(hailPress(hired, { kind: 'sellEscort' })).toBe(hired);
        // ...and a class with no UpgradeTo has no upgrade.
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
