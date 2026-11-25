import 'jasmine';
import {
    ASSIST_FOR_PAY_FALLBACK, FUEL_SALE_BAD_MOOD_FALLBACK,
    FUEL_SALE_MOOD_FALLBACK, payMeText,
} from '../nova_plugin/reputation/index.js';
import { HailContext, HailPage, hailPress, haggleText } from './hail_dialog.js';
import {
    COMM_HAGGLE, COMM_LINE_HEIGHT, COMM_SHIP, CommFrameLayout,
    commWrapWidth, responseLinesAboveButtons,
} from './hail_layout.js';

/**
 * THE HAGGLE POPUP'S TEXT NEVER RUNS UNDER ITS BUTTONS.
 *
 * PICT 8514 is a fixed 262x107 frame: its text box starts at frame y 8 and
 * Lower Price's pill at 39, so at the comm dialogs' 15px leading it holds
 * two lines. NovaJS used to put the ship's mood line on the popup above the
 * price; "I'm in a terrible mood today, so it's going to cost you extra."
 * wraps to two lines there, and "Pay me N credits." landed on a third, under
 * Lower Price. The original (hail/beg_mercy.png) puts the mood line in the
 * comm's well BEHIND the popup and the popup says only the demand.
 *
 * Line counts here come from a greedy word wrap over the advance widths of
 * our Geneva at 9.4px (BODY_FONT), measured with canvas measureText in
 * Chrome on macOS and rounded up to 0.01px. Node has no canvas to measure
 * with (headless_pixi_fixture's widths are made up), so the table is the
 * measurement.
 */
const GENEVA_9_4: ReadonlyArray<[number, string]> = [
    [2.21, 'il'], [2.28, 'I'], [2.32, '|'], [2.60, 'j'], [2.85, '!\',.:;'],
    [3.14, ' '], [3.56, '-'], [3.63, 'r'], [3.67, 'f'], [4.17, 't'],
    [4.20, '()[]'], [4.24, '{}'], [4.63, 'J'], [4.70, '"'], [4.77, '*'],
    [4.79, 's'], [4.98, 'x'], [5.06, '/\\k'], [5.13, 'c'], [5.20, 'Faz'],
    [5.31, 'v'], [5.34, '?'], [5.37, 'y'], [5.41, 'EZe'], [5.48, 'LPhnu'],
    [5.55, '`'], [5.66, 'dpq'], [5.69, 'RSo'], [5.73, 'XYbg'], [5.98, 'B'],
    [6.02, 'T'], [6.12, 'C'], [6.23, 'K'],
    [6.26, '0123456789#$+<=>U^_~'], [6.34, 'G'], [6.48, 'H'], [6.58, 'D'],
    [6.66, 'N'], [6.83, '&AV'], [6.91, 'OQ'], [7.33, 'w'], [7.41, 'M'],
    [8.18, '@'], [8.40, 'm'], [8.51, '%'], [8.90, 'W'],
];
const ADVANCE = new Map<string, number>(
    GENEVA_9_4.flatMap(([width, chars]) =>
        [...chars].map(char => [char, width] as [string, number])));

function width(text: string): number {
    let total = 0;
    for (const char of text) {
        const advance = ADVANCE.get(char);
        if (advance === undefined) {
            throw new Error(`no measured advance for ${JSON.stringify(char)}`);
        }
        total += advance;
    }
    return total;
}

/** Lines PIXI's word wrap breaks `text` into at `wrapWidth`. */
function wrappedLines(text: string, wrapWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
        let line = '';
        for (const word of paragraph.split(' ')) {
            const candidate = line === '' ? word : `${line} ${word}`;
            if (line !== '' && width(candidate) > wrapWidth) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        lines.push(line);
    }
    return lines;
}

/** Frame-local bottom of the response text's box. */
function textBottom(frame: CommFrameLayout, text: string): number {
    return frame.responseText.y
        + wrappedLines(text, commWrapWidth(frame)).length * COMM_LINE_HEIGHT;
}

/**
 * The longest words a ship says as it names a price: its mood lines (STR#
 * 3000 115-124) and its terms for help (140-144), as the parser reads them
 * out of the game's data, plus the fallbacks.
 */
const PRICE_LINES = [
    "I'm in a terrible mood today, so it's going to cost you extra.",
    "I'm in a bad mood today, so it's going to cost you extra.",
    "You're in luck, I'm in a good mood today.",
    'You can get some help if you give me some credits.',
    'You can have some help if you pay me first.',
    ASSIST_FOR_PAY_FALLBACK, FUEL_SALE_BAD_MOOD_FALLBACK,
    FUEL_SALE_MOOD_FALLBACK,
];

/** Every price a haggle can name: up to the 20,000 cap, the +1,000 a plea
 * past it, and a planet's growth with a billionaire's cash. */
const PRICES = [100, 1000, 3000, 20_000, 122_000, 1_234_000, 999_999_000];

type Bribe = NonNullable<HailContext['bribe']>;

function everyBribe(): Bribe[] {
    const bribes: Bribe[] = [];
    for (const amount of PRICES) {
        for (const canAfford of [true, false]) {
            const base = { amount, canAfford };
            bribes.push(
                { ...base, purpose: 'fuel',
                    demand: payMeText(undefined, amount) },
                { ...base, purpose: 'mercy', offer: PRICE_LINES[0],
                    demand: payMeText(undefined, amount) },
                { ...base, purpose: 'landing',
                    demand: payMeText(undefined, amount, 'us') },
                { ...base, purpose: 'assist', offer: ASSIST_FOR_PAY_FALLBACK },
                // The wordings for a caller with no demand line of its own.
                { ...base, purpose: 'mercy' },
                { ...base, purpose: 'landing' },
            );
        }
    }
    return bribes;
}

describe('the haggle popup layout (PICT 8514)', () => {
    it('holds two lines of text above Lower Price', () => {
        expect(COMM_HAGGLE.responseText.y).toBe(8);
        expect(COMM_HAGGLE.buttonTop).toBe(39);
        expect(responseLinesAboveButtons(COMM_HAGGLE)).toBe(2);
        expect(commWrapWidth(COMM_HAGGLE)).toBe(240);
    });

    it('measures the bug: the mood line and the price made three lines', () => {
        // The pre-fix popup text, against the table, so the table is known
        // to reproduce what the browser drew.
        const text = `${PRICE_LINES[0]}\n${payMeText(undefined, 21_000)}`;
        expect(wrappedLines(text, commWrapWidth(COMM_HAGGLE))).toEqual([
            "I'm in a terrible mood today, so it's going to cost",
            'you extra.',
            'Pay me 21,000 credits.',
        ]);
        expect(textBottom(COMM_HAGGLE, text))
            .toBeGreaterThan(COMM_HAGGLE.buttonTop);
    });

    it('puts every demand, at every price, above the buttons', () => {
        for (const bribe of everyBribe()) {
            const text = haggleText(bribe);
            expect(textBottom(COMM_HAGGLE, text))
                .withContext(`${bribe.purpose} ${bribe.amount} ${text}`)
                .toBeLessThanOrEqual(COMM_HAGGLE.buttonTop);
        }
        expect(textBottom(COMM_HAGGLE, haggleText(undefined)))
            .toBeLessThanOrEqual(COMM_HAGGLE.buttonTop);
    });

    it('draws a Lower Price / Accept Price demand on ONE line, as '
        + 'hail/beg_mercy.png does', () => {
        // The popups with the original's two buttons: fuel at any price,
        // a planet's or a ship's mercy price the pilot can pay.
        for (const bribe of everyBribe()) {
            if (bribe.purpose === 'assist' || !bribe.demand
                || (bribe.purpose !== 'fuel' && !bribe.canAfford)) {
                continue;
            }
            expect(wrappedLines(haggleText(bribe),
                commWrapWidth(COMM_HAGGLE)).length)
                .withContext(haggleText(bribe)).toBe(1);
        }
    });

    it('never puts the ship\'s own words on the popup', () => {
        for (const bribe of everyBribe()) {
            if (bribe.offer) {
                expect(haggleText(bribe)).not.toContain(bribe.offer);
            }
        }
    });
});

describe('the ship\'s words as it names a price', () => {
    const SHIP: HailContext = {
        variant: 'ship', heading: 'Fed Anaconda', body: 'No! You die!',
        image: null,
        bribe: {
            amount: 21_000, canAfford: true, purpose: 'mercy',
            offer: PRICE_LINES[0], demand: payMeText(undefined, 21_000),
        },
    };

    it('go in the comm\'s well behind the popup on Beg For Mercy '
        + '(hail/beg_mercy.png)', () => {
        const page = hailPress({ phase: 'main', context: SHIP },
            { kind: 'beg' }, SHIP) as HailPage;
        expect(page.phase).toBe('haggle');
        expect(page.context.body).toBe(PRICE_LINES[0]);
        expect(haggleText(page.context.bribe)).toBe('Pay me 21,000 credits.');
    });

    it('leave a planet\'s well alone (it says nothing as it names one)',
        () => {
            const planet: HailContext = {
                ...SHIP, variant: 'planet', body: 'Channel open to Earth.',
                bribe: { amount: 3000, canAfford: true, purpose: 'landing',
                    demand: payMeText(undefined, 3000, 'us') },
            };
            const page = hailPress({ phase: 'main', context: planet },
                { kind: 'beg' }, planet) as HailPage;
            expect(page.phase).toBe('haggle');
            expect(page.context.body).toBe('Channel open to Earth.');
        });

    it('fit the ship comm\'s well, the longest included', () => {
        const wellBottom = COMM_SHIP.responseWell.y
            + COMM_SHIP.responseWell.height;
        for (const line of PRICE_LINES) {
            expect(textBottom(COMM_SHIP, line)).withContext(line)
                .toBeLessThanOrEqual(wellBottom);
        }
        // The reference's own break: "I'm in a bad mood today, so it's
        // going to" / "cost extra." (hail/beg_mercy.png).
        expect(wrappedLines(
            "I'm in a bad mood today, so it's going to cost extra.",
            commWrapWidth(COMM_SHIP))).toEqual([
            "I'm in a bad mood today, so it's going to",
            'cost extra.',
        ]);
    });
});
