import { GovtData, getDefaultGovtData } from 'novadatainterface/govt_data';
import {
    assistForPayText,
    assistIsFree,
    assistPaidText,
    assistRefusedText,
    assistWillingness,
    assistNeed,
    disabledRefusalText,
    fuelOfferWithdrawnText,
    fuelSaleMoodText,
    FUEL_OFFER_WITHDRAWN_FALLBACK,
    FUEL_SALE_BAD_MOOD_FALLBACK,
    FUEL_SALE_MOOD_FALLBACK,
    FUEL_SALE_PRICE_STEP,
    fuelCounterPrice,
    fuelHaggleAfterAccept,
    fuelLowerPriceCounters,
    fuelSalePrice,
    fuelSaleTerms, fuelAskingBase, FUEL_SALE_CASH_DIVISOR, cantAffordText,
    CANT_AFFORD_FALLBACK, CANT_AFFORD_FIRST_INDEX, CANT_AFFORD_COUNT,
    isTraderAiType,
    laterFuelHaggle,
    lowerFuelPrice,
    NO_FUEL_HAGGLE,
    rankBattleAssistance,
    LOW_FUEL_THRESHOLD,
    payMeText,
    ASSIST_FOR_PAY_FIRST_INDEX,
    ASSIST_PAID_FIRST_INDEX,
    ASSIST_REFUSED_FIRST_INDEX,
    justAnEscortText,
    rudeGreetingText,
    askingCashCap,
    bribeGrowth,
    BRIBE_GROWTH_CASH_DIVISOR,
    LARGER_SHIP_BRIBE,
    PLANET_BRIBE_REFUSAL_ONE_IN,
    planetRefusesBribe,
    bribeDay,
    laterStellarHaggle,
    lowerPlanetBribe,
    planetBribeAsk,
    planetBribeRefused,
    planetLowerPriceCounters,
    stellarBribeDeclinedText,
    STELLAR_BRIBE_DECLINED_FALLBACK,
    stellarHaggleFrom,
    stellarHaggleProgress,
    SHIP_BRIBE_CAP,
    planetBribePrice,
    PLANET_BRIBE_BASE,
    PLANET_LARGER_BRIBE_BASE,
    shipBribePrice,
    PAY_US_INDEX,
    busyResponseText,
    BUSY_RESPONSE_COUNT,
    BUSY_RESPONSE_FALLBACK,
    BUSY_RESPONSE_FIRST_INDEX,
    shipIsFighting,
    BRIBE_MINIMUM,
    canRequestAssistance,
    greetingText,
    hashString,
    hostileResponseText,
    HOSTILE_RESPONSE_COUNT,
    HOSTILE_RESPONSE_FALLBACK,
    HOSTILE_RESPONSE_FIRST_INDEX,
    noNeedResponseText,
    NO_NEED_RESPONSE_COUNT,
    NO_NEED_RESPONSE_FALLBACK,
    NO_NEED_RESPONSE_FIRST_INDEX,
    planetTakesBribes,
    shipAnswersHails,
    shipHailResponse,
    shipTakesBribes,
} from './hail.js';

function govt(overrides: Partial<GovtData> = {}): GovtData {
    return { ...getDefaultGovtData(), id: 'nova:128', ...overrides };
}
function withFlags(flags: Partial<GovtData['flags']>): GovtData {
    return govt({ flags: { ...getDefaultGovtData().flags, ...flags } });
}
function withFlags2(flags2: Partial<GovtData['flags2']>): GovtData {
    return govt({ flags2: { ...getDefaultGovtData().flags2, ...flags2 } });
}

describe('shipTakesBribes', () => {
    it('warships take bribes only with the warship flag', () => {
        expect(shipTakesBribes(withFlags({ warshipsTakeBribes: true }), 3))
            .toBe(true);
        expect(shipTakesBribes(withFlags({ warshipsTakeBribes: false }), 3))
            .toBe(false);
    });
    it('freighters take bribes only with the freighter flag', () => {
        expect(shipTakesBribes(withFlags({ freightersTakeBribes: true }), 1))
            .toBe(true);
        expect(shipTakesBribes(withFlags({ warshipsTakeBribes: true }), 2))
            .toBe(false);
    });
    it('0x8000 (larger bribes) alone does NOT make a ship take bribes '
        + '(MEASURED, R7 wave 22, finding 5)', () => {
            expect(shipTakesBribes(withFlags({ largerBribes: true }), 1))
                .toBe(false);
            expect(shipTakesBribes(withFlags({ largerBribes: true }), 3))
                .toBe(false);
            // With the aiType's own flag it does.
            expect(shipTakesBribes(withFlags({
                largerBribes: true, warshipsTakeBribes: true,
            }), 3)).toBe(true);
            expect(shipTakesBribes(withFlags({
                largerBribes: true, freightersTakeBribes: true,
            }), 1)).toBe(true);
        });
    it('no govt never takes bribes', () => {
        expect(shipTakesBribes(undefined, 3)).toBe(false);
    });
});

/**
 * Reference "R7 bribe price, wave 22": thousands, not a share of the cash;
 * a third of the cash caps it and 1,000 is the floor; a ship's price is the
 * fuel sale's, a 0x8000 govt's ship a flat 20,000; a planet 3,000 / 4,000;
 * growth above about 1M.
 */
describe('the bribe price', () => {
    /** Ship ids by fuel-sale mood and base (fuelSaleTerms, pinned in the
     * fuel sale's specs below). */
    const GOOD = 'ship3'; // 1,000
    const NEUTRAL_LOW = 'ship0'; // 2,000
    const BAD_HIGH = 'ship13'; // 4,000
    const ships = Array.from({ length: 400 }, (_, i) => `ship ${i}`);

    it('the cash cap: a third, in 1,000s, never under 1,000 (finding 2)',
        () => {
            expect(askingCashCap(10_000)).toBe(3_000);
            expect(askingCashCap(9_000)).toBe(3_000);
            expect(askingCashCap(8_999)).toBe(2_000);
            expect(askingCashCap(300)).toBe(1_000);
            expect(askingCashCap(0)).toBe(1_000);
            expect(askingCashCap(-5)).toBe(1_000);
            expect(askingCashCap(NaN)).toBe(1_000);
            expect(BRIBE_MINIMUM).toBe(1_000);
        });

    it('a ship asks its fuel-sale price up to 1M: good 1,000, neutral '
        + '2,000-3,000, bad 3,000-4,000 (finding 3)', () => {
            for (const credits of [100_000, 1_000_000]) {
                expect(shipBribePrice(GOOD, 'player', credits, false))
                    .toBe(1_000);
                expect(shipBribePrice(NEUTRAL_LOW, 'player', credits, false))
                    .toBe(2_000);
                expect(shipBribePrice(BAD_HIGH, 'player', credits, false))
                    .toBe(4_000);
            }
            for (const ship of ships) {
                expect(shipBribePrice(ship, 'player', 1_000_000, false))
                    .toBe(fuelSaleTerms(ship).base);
            }
        });

    it('capped by a third of the cash, and 1,000 even at 300 credits '
        + '(finding 2: 10,000 -> 3,000, 300 -> 1,000)', () => {
            expect(shipBribePrice(BAD_HIGH, 'player', 10_000, false))
                .toBe(3_000);
            expect(shipBribePrice(GOOD, 'player', 10_000, false)).toBe(1_000);
            for (const ship of ships) {
                expect(shipBribePrice(ship, 'player', 300, false)).toBe(1_000);
                expect(shipBribePrice(ship, 'player', 10_000, false))
                    .toBeLessThanOrEqual(3_000);
            }
        });

    it('a 0x8000 govt\'s ship asks a flat 20,000 whatever its mood, capped '
        + '(finding 5: 1M and 20M 20,000; 10k 3,000)', () => {
            expect(LARGER_SHIP_BRIBE).toBe(20_000);
            for (const ship of [GOOD, NEUTRAL_LOW, BAD_HIGH, ...ships]) {
                expect(shipBribePrice(ship, 'player', 1_000_000, true))
                    .toBe(20_000);
                expect(shipBribePrice(ship, 'player', 20_000_000, true))
                    .toBe(20_000);
                expect(shipBribePrice(ship, 'player', 10_000, true))
                    .toBe(3_000);
                expect(shipBribePrice(ship, 'player', 300, true))
                    .toBe(1_000);
            }
        });

    it('a planet asks 3,000, or 4,000 for 0x8000, up to 1M (finding 4)',
        () => {
            expect(PLANET_BRIBE_BASE).toBe(3_000);
            expect(PLANET_LARGER_BRIBE_BASE).toBe(4_000);
            for (const planet of ships) {
                expect(planetBribePrice(planet, 'player', 1_000_000, false))
                    .toBe(3_000);
                expect(planetBribePrice(planet, 'player', 1_000_000, true))
                    .toBe(4_000);
                // 10,000 credits: 3,000 for both (the cap).
                expect(planetBribePrice(planet, 'player', 10_000, true))
                    .toBe(3_000);
                expect(planetBribePrice(planet, 'player', 300, false))
                    .toBe(1_000);
            }
        });

    it('above about 1M it grows with the cash, in 1,000s, inside the '
        + 'measured spreads (5M: 2,000-6,000; 20M: 1,000-18,000; 100M: '
        + '3,000-99,000)', () => {
            expect(BRIBE_GROWTH_CASH_DIVISOR).toBe(1_000);
            const spread = (credits: number, price: (id: string) => number) => {
                const asks = ships.map(price);
                for (const ask of asks) {
                    expect(ask % 1_000).toBe(0);
                }
                return { min: Math.min(...asks), max: Math.max(...asks) };
            };
            // Ships: the base plus [0, cash / 1,000), floored to 1,000s.
            const s20 = spread(20e6, id =>
                shipBribePrice(id, 'player', 20e6, false));
            expect(s20.min).toBe(1_000);
            expect(s20.max).toBeGreaterThanOrEqual(18_000);
            expect(s20.max).toBeLessThanOrEqual(4_000 + 19_000);
            // ... up to the ships' 20,000 cap (wave 27: 100M's 3,000,
            // 8,000 and 14,000 sit under it).
            const s100 = spread(100e6, id =>
                shipBribePrice(id, 'player', 100e6, false));
            expect(s100.max).toBe(SHIP_BRIBE_CAP);
            // Planets: 5M asked 6,000, 20M 9,000-18,000 (and 4,000 for
            // 0x8000), 100M 25,000 and 99,000 (0x8000).
            const p5 = spread(5e6, id =>
                planetBribePrice(id, 'player', 5e6, false));
            expect(p5.min).toBe(3_000);
            expect(p5.max).toBe(7_000);
            const p100 = spread(100e6, id =>
                planetBribePrice(id, 'player', 100e6, true));
            expect(p100.min).toBe(4_000);
            expect(p100.max).toBeGreaterThanOrEqual(99_000);
            // Under 1M nothing grows; at 1M-2M 0 or 1,000.
            for (const id of ships) {
                expect(bribeGrowth(999_999, id, 'player')).toBe(0);
                expect(bribeGrowth(1_000_000, id, 'player')).toBe(0);
                expect([0, 1_000]).toContain(bribeGrowth(1_999_999, id,
                    'player'));
            }
        });

    it('a ship never asks more than 20,000, at any cash (reference "R7 '
        + 'bribe price above 1M, wave 27": four 20,000s at 50M and 200M, '
        + '4,000 under them)', () => {
            expect(SHIP_BRIBE_CAP).toBe(20_000);
            for (const credits of [50e6, 200e6, 1e12]) {
                const asks = ships.map(id =>
                    shipBribePrice(id, 'player', credits, false));
                expect(Math.max(...asks)).toBe(20_000);
                // Most asks reach the cap.
                expect(asks.filter(a => a === 20_000).length)
                    .toBeGreaterThan(ships.length / 2);
            }
            // At 50M some stay under it (4,000 was asked).
            expect(Math.min(...ships.map(id =>
                shipBribePrice(id, 'player', 50e6, false))))
                .toBeLessThan(20_000);
            // At 50M a ship could otherwise ask up to 52,000 (the base
            // plus 50,000): the cap is what binds.
            expect(Math.max(...ships.map(id =>
                fuelSaleTerms(id).base + bribeGrowth(50e6, id, 'player'))))
                .toBeGreaterThan(20_000);
            // A 0x8000 govt's ship asks the cap flat.
            expect(shipBribePrice(GOOD, 'player', 200e6, true)).toBe(20_000);
        });

    it('a planet has no such cap (wave 27: 183,000 at 200M)', () => {
        const asks = ships.map(id =>
            planetBribePrice(id, 'player', 200e6, false));
        expect(Math.max(...asks)).toBeGreaterThan(183_000);
        expect(Math.min(...asks)).toBeLessThan(20_000);
    });

    it('an ordinary planet refuses outright about one time in four, at '
        + 'any cash; a 0x8000 planet never (waves 22-30: 6 in 26)', () => {
            expect(PLANET_BRIBE_REFUSAL_ONE_IN).toBe(4);
            const visit = 0;
            for (const pilot of ['player', 'p2', 'p3']) {
                const refused = ships.filter(id =>
                    planetRefusesBribe(id, pilot, false, visit));
                // 400 planets: 100 expected; a generous binomial band.
                expect(refused.length).withContext(pilot)
                    .toBeGreaterThan(65);
                expect(refused.length).withContext(pilot)
                    .toBeLessThan(135);
                expect(ships.some(id => planetRefusesBribe(id, pilot,
                    true, visit))).toBeFalse();
            }
            // A pure hash: the same verdict for the same planet, pilot
            // and system visit ...
            for (const id of ships.slice(0, 50)) {
                expect(planetRefusesBribe(id, 'p', false, visit))
                    .toBe(planetRefusesBribe(id, 'p', false, visit));
            }
            // ... re-drawn on the next visit (the crossing into another
            // system advances the ordinal).
            const refusedNow = ships.filter(id =>
                planetRefusesBribe(id, 'p', false, visit));
            expect(refusedNow.filter(id =>
                planetRefusesBribe(id, 'p', false, visit + 1)).length)
                .toBeLessThan(refusedNow.length);
            // No ordinal is the first visit's.
            for (const id of ships.slice(0, 50)) {
                expect(planetRefusesBribe(id, 'p', false))
                    .toBe(planetRefusesBribe(id, 'p', false, 0));
            }
        });

    describe('a planet\'s haggle (reference "R7 planet bribe, wave 28" '
        + 'and "R7 planet bribe withdrawal, wave 29")',
        () => {
            const day = bribeDay({ day: 1, month: 1, year: 1177 });

            it('keys the day as year-month-day, \'\' without a date', () => {
                expect(day).toBe('1177-1-1');
                expect(bribeDay()).toBe('');
            });

            it('an entry is the haggle whatever its day; none is no '
                + 'haggle (reference "R7 planet bribe withdrawal, wave 29": '
                + 'the scope is the system visit, not the day)', () => {
                    expect(stellarHaggleFrom(undefined)).toEqual(
                        { countered: false, withdrawn: false });
                    expect(stellarHaggleFrom(
                        { countered: true, withdrawn: false })).toEqual(
                        { countered: true, withdrawn: false });
                    expect(stellarHaggleFrom(
                        { countered: false, withdrawn: true })).toEqual(
                        { countered: false, withdrawn: true });
                    // A pre-wave-29 entry still carrying its day reads the
                    // same (the field is ignored, not compared).
                    expect(stellarHaggleFrom({ day: '1177-1-0',
                        countered: false, withdrawn: true } as never))
                        .toEqual({ countered: false, withdrawn: true });
                });

            it('the first Lower Price counters about one press in four, '
                + 'a second always withdraws (wave 29: "Yeah, you wish."), '
                + 'and a withdrawal sticks', () => {
                    const fresh = stellarHaggleFrom(undefined);
                    const outcomes = ships.map(id =>
                        lowerPlanetBribe(fresh, id, 'player', day));
                    const counters = outcomes.filter(o =>
                        o.outcome === 'counter').length;
                    // 400 planets: 100 expected.
                    expect(counters).toBeGreaterThan(60);
                    expect(counters).toBeLessThan(140);
                    for (const [i, o] of outcomes.entries()) {
                        expect(o.outcome === 'counter').toBe(
                            planetLowerPriceCounters(ships[i], 'player',
                                day));
                        const again = lowerPlanetBribe(o.haggle, ships[i],
                            'player', day);
                        expect(again.outcome).toBe('withdraw');
                        expect(again.haggle).toEqual(
                            { countered: false, withdrawn: true });
                        expect(lowerPlanetBribe(again.haggle, ships[i],
                            'player', day).outcome).toBe('withdraw');
                    }
                });

            it('a second Lower Price on a counter withdraws on ANY day '
                + '(the counter\'s draw is not repeated)', () => {
                    const countered = { countered: true, withdrawn: false };
                    for (const id of ships.slice(0, 50)) {
                        for (const d of [day, '1177-1-2', '']) {
                            expect(lowerPlanetBribe(countered, id, 'player',
                                d)).toEqual({
                                haggle: { countered: false,
                                    withdrawn: true },
                                outcome: 'withdraw',
                            });
                        }
                    }
                });

            it('the first Lower Price draws on the day it is pressed', () => {
                const fresh = stellarHaggleFrom(undefined);
                const nextDay = bribeDay({ day: 2, month: 1, year: 1177 });
                const differs = ships.filter(id =>
                    lowerPlanetBribe(fresh, id, 'p', day).outcome
                    !== lowerPlanetBribe(fresh, id, 'p', nextDay).outcome);
                expect(differs.length).toBeGreaterThan(0);
            });

            it('asks the 3/4 counter while it is on the table (wave 22: '
                + '3,000 -> 2,200, 10,000 -> 7,500)', () => {
                    const countered = { countered: true, withdrawn: false };
                    expect(planetBribeAsk(3000, countered)).toBe(2200);
                    expect(planetBribeAsk(10_000, countered)).toBe(7500);
                    expect(planetBribeAsk(3000,
                        stellarHaggleFrom(undefined))).toBe(3000);
                });

            it('refuses after a withdrawal whatever the visit\'s draw, a '
                + '0x8000 planet included, and otherwise only on the '
                + 'fresh draw of the visit', () => {
                    const withdrawn = { countered: false, withdrawn: true };
                    for (const id of ships.slice(0, 50)) {
                        for (const visit of [0, 1, 7]) {
                            expect(planetBribeRefused(id, 'p', false,
                                withdrawn, visit)).toBeTrue();
                            expect(planetBribeRefused(id, 'p', true,
                                withdrawn, visit)).toBeTrue();
                            expect(planetBribeRefused(id, 'p', false,
                                stellarHaggleFrom(undefined), visit))
                                .toBe(planetRefusesBribe(id, 'p', false,
                                    visit));
                        }
                    }
                });

            it('the dialog\'s view and the mirror merge to the further '
                + 'along', () => {
                    const none = stellarHaggleFrom(undefined);
                    const countered = { countered: true, withdrawn: false };
                    const withdrawn = { countered: false, withdrawn: true };
                    expect(laterStellarHaggle(countered, none))
                        .toEqual(countered);
                    expect(laterStellarHaggle(none, countered))
                        .toEqual(countered);
                    expect(laterStellarHaggle(countered, withdrawn))
                        .toEqual(withdrawn);
                    expect(laterStellarHaggle(withdrawn, countered))
                        .toEqual(withdrawn);
                    expect(laterStellarHaggle(undefined, undefined))
                        .toEqual(none);
                    expect(stellarHaggleProgress(none)).toBe(0);
                    expect(stellarHaggleProgress(countered)).toBe(1);
                    expect(stellarHaggleProgress(withdrawn)).toBe(2);
                });

            it('answers from STR# 3002 45-49', () => {
                const lines: string[] = [];
                lines[45] = 'Yeah, right.';
                lines[46] = 'You wish.';
                lines[47] = 'Are you trying to insult us?';
                lines[48] = "We don't take kindly to insults.";
                lines[49] = 'Stop being an insulting little ferret.';
                const seen = new Set(Array.from({ length: 40 },
                    (_, seed) => stellarBribeDeclinedText(lines, seed)));
                expect(seen.size).toBe(5);
                expect(stellarBribeDeclinedText(undefined))
                    .toBe(STELLAR_BRIBE_DECLINED_FALLBACK);
            });
        });

    it('the growth draw is a fixed hash of the target and the pilot (no '
        + 'PRNG), and moves with neither the record nor the rating', () => {
            for (const id of ships.slice(0, 50)) {
                expect(bribeGrowth(50e6, id, 'player'))
                    .toBe(bribeGrowth(50e6, id, 'player'));
                expect(shipBribePrice(id, 'p', 50e6, false))
                    .toBe(shipBribePrice(id, 'p', 50e6, false));
            }
            // Different pilots can be asked different prices.
            const prices = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(p =>
                bribeGrowth(50e6, 'ship 1', p)));
            expect(prices.size).toBeGreaterThan(1);
            // Huge or nonsense cash stays an exact multiple of 1,000.
            expect(bribeGrowth(1e12, 'ship 1', 'p') % 1_000).toBe(0);
            expect(bribeGrowth(NaN, 'ship 1', 'p')).toBe(0);
            expect(bribeGrowth(-1e9, 'ship 1', 'p')).toBe(0);
        });

    it('a planet demands "Pay us N credits." (STR# 2002 187)', () => {
        const misc: string[] = [];
        misc[186] = 'Pay me';
        misc[PAY_US_INDEX] = 'Pay us';
        misc[32] = 'credits';
        expect(payMeText(misc, 3000, 'us')).toBe('Pay us 3,000 credits.');
        expect(payMeText(misc, 20000)).toBe('Pay me 20,000 credits.');
        expect(payMeText(undefined, 1000, 'us')).toBe('Pay us 1,000 credits.');
    });
});

describe('shipHailResponse', () => {
    it('cantBeHailed govts do not answer', () => {
        expect(shipHailResponse(withFlags({ cantBeHailed: true }),
            false, 3)).toEqual({ kind: 'cantHail' });
    });
    it('an IFF-hostile ship offers Beg For Mercy, priced when the govt '
        + 'bargains', () => {
        expect(shipHailResponse(withFlags({ warshipsTakeBribes: true }),
            true, 3)).toEqual({ kind: 'hostile', canBeg: true, canBribe: true });
    });
    it('an IFF-hostile ship of a non-bribing govt STILL offers Beg For '
        + 'Mercy - the plea is refused, not hidden (ruling #297)', () => {
        expect(shipHailResponse(govt(), true, 3))
            .toEqual({ kind: 'hostile', canBeg: true, canBribe: false });
    });
    it('noAssistOrMercy disables Beg For Mercy even for a bribing govt',
        () => {
            const g = withFlags({ warshipsTakeBribes: true });
            g.flags2 = { ...g.flags2, noAssistOrMercy: true };
            expect(shipHailResponse(g, true, 3))
                .toEqual({ kind: 'hostile', canBeg: false, canBribe: false });
        });
    it('friendly / neutral ships greet and are talkative by default', () => {
        expect(shipHailResponse(govt(), false, 3))
            .toEqual({ kind: 'greeting', talkative: true });
        expect(shipHailResponse(govt(), false, 1))
            .toEqual({ kind: 'greeting', talkative: true });
    });
    it('noDistressMessages govts answer but are not talkative', () => {
        expect(shipHailResponse(withFlags2({ noDistressMessages: true }),
            false, 3)).toEqual({ kind: 'greeting', talkative: false });
    });
    it('a class that INHERITS no-greetings answers but is not talkative',
        () => {
            expect(shipHailResponse(govt(), false, 3,
                { inheritedNoGreetings: true }))
                .toEqual({ kind: 'greeting', talkative: false });
        });
    it('a govt-less ship greets talkatively', () => {
        expect(shipHailResponse(undefined, false, undefined))
            .toEqual({ kind: 'greeting', talkative: true });
    });
    it('hostility is the IFF verdict, NOT the government stance', () => {
        // Ruling #297: "Hostility in the hailing channel should reflect the
        // iff of that ship, not the government stance." A xenophobic govt
        // whose ship is not IFF-hostile (bought off, say) answers like any
        // other; a peaceful one whose ship is IFF-hostile answers hostile.
        expect(shipHailResponse(withFlags({ xenophobic: true }), false, 3))
            .toEqual({ kind: 'greeting', talkative: true });
        expect(shipHailResponse(govt(), true, 3).kind).toBe('hostile');
    });
    it('a cantBeHailed ship stays silent even while attacking the player',
        () => {
            expect(shipHailResponse(withFlags({ cantBeHailed: true }),
                true, 3)).toEqual({ kind: 'cantHail' });
        });
    it('a class that INHERITS cantBeHailed stays silent', () => {
        expect(shipHailResponse(govt(), false, 3,
            { inheritedCantBeHailed: true })).toEqual({ kind: 'cantHail' });
    });
});

/**
 * Ruling #297: "Some ships don't respond to hails at all (no hailing channel
 * appears), like the krypt pod and wraith, and some don't have a 'request
 * assistance' button (Polaris (often) and Dechtakar)." The flag words below
 * are the stock data's, read off the real files (see shipAnswersHails).
 */
describe('shipAnswersHails', () => {
    /** A govt carrying a raw Flags2 word, decoded the way the parser does. */
    function withRawFlags2(raw: number, cantBeHailed = false): GovtData {
        const g = withFlags({ cantBeHailed });
        g.flags2 = {
            ...g.flags2,
            noAssistOrMercy: Boolean(raw & 0x0001),
            noDistressMessages: Boolean(raw & 0x0008),
            roadsideAssistance: Boolean(raw & 0x0010),
        };
        return g;
    }

    it('silences the Krypt (govt 140 Flags2 0x002b, 163 0x0029) and the '
        + 'Wraith (138/139 Flags2 0x00ab): nothing to say, nothing to offer',
        () => {
            expect(shipAnswersHails(withRawFlags2(0x002b))).toBeFalse();
            expect(shipAnswersHails(withRawFlags2(0x0029))).toBeFalse();
            expect(shipAnswersHails(withRawFlags2(0x00ab))).toBeFalse();
        });

    it('silences 0x0400, on the govt or inherited by the class', () => {
        // Wraith govt 159 (Flags 0x0c80); Wraith (Adult) nova:185 inherits
        // it through InherentGovt 159.
        expect(shipAnswersHails(withRawFlags2(0, true))).toBeFalse();
        expect(shipAnswersHails(govt(), { inheritedCantBeHailed: true }))
            .toBeFalse();
    });

    it('silences a no-assist govt whose CLASS inherits no-greetings', () => {
        expect(shipAnswersHails(withRawFlags2(0x0001),
            { inheritedNoGreetings: true })).toBeFalse();
    });

    it('lets the Dechtakar answer (govt 142 Rimerta, Flags2 0x0027): the '
        + 'channel opens, there is just no Request Assistance', () => {
        const dechtakar = withRawFlags2(0x0027);
        expect(shipAnswersHails(dechtakar)).toBeTrue();
        expect(canRequestAssistance({ govt: dechtakar })).toBeFalse();
        expect(shipHailResponse(dechtakar, false, 3))
            .toEqual({ kind: 'greeting', talkative: false });
    });

    it('lets the Polaris answer, with assistance only where the govt allows',
        () => {
            // Polaris (130, Flags2 0x0020) assists; the Nil-kemorya, who
            // also answer as "Polaris" (147, Flags2 0x0003), do not: the
            // "often" of the ruling.
            const polaris = withRawFlags2(0x0020);
            const nilkemorya = withRawFlags2(0x0003);
            expect(shipAnswersHails(polaris)).toBeTrue();
            expect(shipAnswersHails(nilkemorya)).toBeTrue();
            expect(canRequestAssistance({ govt: polaris })).toBeTrue();
            expect(canRequestAssistance({ govt: nilkemorya })).toBeFalse();
        });

    it('answers for an ordinary or govt-less ship', () => {
        expect(shipAnswersHails(govt())).toBeTrue();
        expect(shipAnswersHails(undefined)).toBeTrue();
        // 0x0008 alone (the Hypergate govt, 183) still answers.
        expect(shipAnswersHails(withRawFlags2(0x0008))).toBeTrue();
    });
});

describe('canRequestAssistance', () => {
    it('is OFFERED even when the player needs no help at all', () => {
        // Matthew: "it should show request assistance even if there's no
        // reason for you to request it (they usually just tell you that you
        // don't need help)." The offer is about who you are talking to, not
        // about your hull — the ANSWER is where the need is judged.
        expect(canRequestAssistance({ govt: govt() })).toBe(true);
        expect(canRequestAssistance({ govt: undefined })).toBe(true);
    });
    it('is OFFERED by a ship of a government hostile to the player that is '
        + 'not attacking (ruling #297: "always visible ... They just refuse '
        + 'to help you or make you pay")', () => {
        // A pirate govt: xenophobic, so its stance toward everyone is
        // hostile. Not IFF-hostile (bought off, or not engaging), so the
        // button is there; whether it helps is assistWillingness's call.
        expect(canRequestAssistance({
            govt: withFlags({ xenophobic: true, largerBribes: true }),
            iffHostile: false,
        })).toBe(true);
    });
    it('is refused by noAssistOrMercy / cantBeHailed govts', () => {
        expect(canRequestAssistance({
            govt: withFlags2({ noAssistOrMercy: true }),
        })).toBe(false);
        expect(canRequestAssistance({
            govt: withFlags({ cantBeHailed: true }),
        })).toBe(false);
    });
    it('lets ränk 0x0400 override noAssistOrMercy, but not IFF hostility',
        () => {
            const quiet = withFlags2({ noAssistOrMercy: true });
            expect(canRequestAssistance({
                govt: quiet, rankAlwaysAssists: true,
            })).toBe(true);
            expect(canRequestAssistance({
                govt: quiet, rankAlwaysAssists: true, iffHostile: true,
            })).toBe(false);
        });
    it('is allowed for Roadside Assistance govts', () => {
        expect(canRequestAssistance({ govt: withFlags2({ roadsideAssistance: true }) })).toBe(true);
    });
    it('is refused by a neutral-govt ship attacking the player', () => {
        // The assistance exploit: a neutral warship shooting a disabled player
        // must not also offer to fly over and repair them.
        expect(canRequestAssistance({ govt: govt(),
            iffHostile: true })).toBe(false);
        // Even a Roadside-Assistance govt refuses while attacking.
        expect(canRequestAssistance({ govt: withFlags2({ roadsideAssistance: true }),
            iffHostile: true })).toBe(false);
    });
});

describe('assistWillingness (ruling #297: "refuse to help you or make you '
    + 'pay")', () => {
    it('an ALLIED ship refuses a disabled pilot (reference H1 wave 17, '
        + 'finding 6: the "allies help for free" guess is gone) and sells '
        + 'fuel like a neutral one (GUESS)', () => {
            for (const aiType of [1, 3]) {
                expect(assistWillingness({
                    disposition: 'friendly', govt: govt(), aiType,
                    need: 'disabled',
                })).toBe('refuse');
                expect(assistWillingness({
                    disposition: 'friendly', govt: govt(), aiType,
                    need: 'fuel',
                })).toBe('sellFuel');
            }
        });
    it('a NEUTRAL ship refuses a disabled pilot and sells a fuelless one '
        + 'fuel (reference H1 wave 16)', () => {
            for (const aiType of [1, 3]) {
                expect(assistWillingness({
                    disposition: 'neutral', govt: govt(), aiType,
                    need: 'disabled',
                })).toBe('refuse');
                expect(assistWillingness({
                    disposition: 'neutral', govt: govt(), aiType,
                    need: 'fuel',
                })).toBe('sellFuel');
            }
            // The stricter answer when the need is not given.
            expect(assistWillingness({
                disposition: 'neutral', govt: govt(), aiType: 1,
            })).toBe('refuse');
        });
    it('free help (Roadside Assistance / ränk 0x0800) overrides the neutral '
        + 'terms', () => {
            for (const need of ['disabled', 'fuel'] as const) {
                expect(assistWillingness({
                    disposition: 'neutral', govt: govt(), aiType: 1, need,
                    free: true,
                })).toBe('willing');
            }
        });
    it('assistNeed: disabled beats fuel; under a jump of fuel is fuel',
        () => {
            const tank = (current: number, max = 3000) => ({ current, max });
            expect(assistNeed(true, tank(0))).toBe('disabled');
            expect(assistNeed(false, tank(0))).toBe('fuel');
            expect(assistNeed(false, tank(LOW_FUEL_THRESHOLD - 1)))
                .toBe('fuel');
            expect(assistNeed(false, tank(LOW_FUEL_THRESHOLD)))
                .toBeUndefined();
            // A full (tiny) tank needs nothing; no tank at all neither.
            expect(assistNeed(false, tank(50, 50))).toBeUndefined();
            expect(assistNeed(false, undefined)).toBeUndefined();
        });
    it('the fuel sale\'s lines and "Pay me N credits." (STR# 3000 115-119, '
        + '155-159; STR# 2002 186 + 32)', () => {
            const strings: string[] = [];
            strings[116] = "You're in luck, I'm in a good mood today.";
            strings[140] =
                "All right, I'll give you some help, but it'll cost you.";
            strings[122] =
                "I'm in a bad mood today, so it's going to cost extra.";
            strings[156] =
                "If that's the way you feel, then you can sit here forever.";
            // The mood picks the group (reference H1 wave 17, finding 2).
            expect(fuelSaleMoodText(strings, 'good', 1))
                .toBe("You're in luck, I'm in a good mood today.");
            expect(fuelSaleMoodText(strings, 'neutral', 0)).toBe(
                "All right, I'll give you some help, but it'll cost you.");
            expect(fuelSaleMoodText(strings, 'bad', 2)).toBe(
                "I'm in a bad mood today, so it's going to cost extra.");
            expect(fuelOfferWithdrawnText(strings, 1)).toBe(
                "If that's the way you feel, then you can sit here forever.");
            expect(fuelSaleMoodText(undefined, 'good'))
                .toBe(FUEL_SALE_MOOD_FALLBACK);
            expect(fuelSaleMoodText(undefined, 'bad'))
                .toBe(FUEL_SALE_BAD_MOOD_FALLBACK);
            expect(fuelOfferWithdrawnText(undefined))
                .toBe(FUEL_OFFER_WITHDRAWN_FALLBACK);
            expect(disabledRefusalText(undefined)).toBe('In your dreams, pal.');
            const misc: string[] = [];
            misc[186] = 'Pay me';
            misc[32] = 'credits';
            expect(payMeText(misc, 1000)).toBe('Pay me 1,000 credits.');
            expect(payMeText(undefined, 2000)).toBe('Pay me 2,000 credits.');
            expect(payMeText(undefined, 1_048_576_000))
                .toBe('Pay me 1,048,576,000 credits.');
        });
    it('makes the player PAY when its unfriendly govt takes bribes from a '
        + 'ship of its kind', () => {
        const pirate = withFlags({
            xenophobic: true, largerBribes: true, warshipsTakeBribes: true,
        });
        expect(assistWillingness({
            disposition: 'hostile', govt: pirate, aiType: 3,
        })).toBe('forPay');
        // 0x8000 alone takes no bribe (R7 wave 22, finding 5): unwilling.
        expect(assistWillingness({
            disposition: 'hostile',
            govt: withFlags({ xenophobic: true, largerBribes: true }),
            aiType: 3,
        })).toBe('unwilling');
        // Freighter flag for freighters, warship flag for warships.
        const traders = withFlags({ freightersTakeBribes: true });
        expect(assistWillingness({
            disposition: 'hostile', govt: traders, aiType: 1,
        })).toBe('forPay');
        expect(assistWillingness({
            disposition: 'hostile', govt: traders, aiType: 3,
        })).toBe('unwilling');
    });
    it('REFUSES when its unfriendly govt takes no bribes', () => {
        expect(assistWillingness({
            disposition: 'hostile', govt: govt(), aiType: 3,
        })).toBe('unwilling');
    });
    it('a ränk 0x0400 for its government makes a WARSHIP help (GUESS: '
        + 'unmeasured) but not a TRADER (reference H1 wave 17, finding 7)',
        () => {
            for (const aiType of [3, 4, undefined]) {
                expect(assistWillingness({
                    disposition: 'hostile', govt: govt(), aiType,
                    rankAlwaysAssists: true,
                })).withContext(`AI ${aiType}`).toBe('willing');
            }
            for (const aiType of [1, 2]) {
                expect(isTraderAiType(aiType)).toBeTrue();
                expect(rankBattleAssistance(true, aiType)).toBeFalse();
                expect(assistWillingness({
                    disposition: 'neutral', govt: govt(), aiType,
                    rankAlwaysAssists: true, need: 'disabled',
                })).toBe('refuse');
                expect(assistWillingness({
                    disposition: 'neutral', govt: govt(), aiType,
                    rankAlwaysAssists: true, need: 'fuel',
                })).toBe('sellFuel');
                expect(assistWillingness({
                    disposition: 'hostile', govt: govt(), aiType,
                    rankAlwaysAssists: true,
                })).toBe('unwilling');
            }
            expect(rankBattleAssistance(false, 3)).toBeFalse();
            expect(rankBattleAssistance(undefined, 3)).toBeFalse();
        });
});

/**
 * Reference "H1 wave 17" (docs/reference_experiments.md): a ship's price for
 * a jump of fuel is a per-ship ask set by its mood plus 1,000 for every
 * repeated ask; Lower Price counters with floor(0.75 x P / 100) x 100 or
 * withdraws, and always withdraws a counter. "H1 wave 19": each mood asks
 * one of two steps (neutral 2,000-3,000, bad 3,000-4,000; the good mood
 * 1,000 only, "H1 / rescue leftovers, wave 21"), capped by the pilot's
 * cash, with no record term.
 */
describe('the fuel sale\'s price (reference H1 wave 17)', () => {
    it('counters with 3/4 rounded down to 100: all five measured counters',
        () => {
            expect(fuelCounterPrice(4000)).toBe(3000);
            expect(fuelCounterPrice(2000)).toBe(1500);
            expect(fuelCounterPrice(5000)).toBe(3700);
            expect(fuelCounterPrice(1000)).toBe(700);
            expect(fuelCounterPrice(3000)).toBe(2200);
        });

    it('adds 1,000 an ask to the base, and quotes the counter while it is '
        + 'on the table', () => {
            expect(FUEL_SALE_PRICE_STEP).toBe(1000);
            // Trader A: 3,000 / 4,000 (-> 3,000) / 5,000.
            expect(fuelSalePrice(3000, NO_FUEL_HAGGLE)).toBe(3000);
            expect(fuelSalePrice(3000, { asks: 1, countered: false }))
                .toBe(4000);
            expect(fuelSalePrice(3000, { asks: 1, countered: true }))
                .toBe(3000);
            expect(fuelSalePrice(3000, { asks: 2, countered: false }))
                .toBe(5000);
            // Warship C's accepted counter: 5,000 -> 3,700.
            expect(fuelSalePrice(3000, { asks: 2, countered: true }))
                .toBe(3700);
            // The record +2000 warship: 1,000 (-> 700) / 2,000.
            expect(fuelSalePrice(1000, { asks: 0, countered: true }))
                .toBe(700);
            expect(fuelSalePrice(1000, { asks: 1, countered: false }))
                .toBe(2000);
            // Nonsense counts clamp rather than go negative or inexact.
            expect(fuelSalePrice(1000, { asks: -3, countered: false }))
                .toBe(1000);
            expect(Number.isSafeInteger(fuelSalePrice(3000,
                { asks: 1e12, countered: false }))).toBeTrue();
        });

    it('draws a mood and an ask per ship: good 1,000, neutral '
        + '2,000-3,000, bad 3,000-4,000 (reference H1 wave 19, finding 2; '
        + 'the good mood\'s one ask, wave 21, finding 1)',
        () => {
            const counts = new Map<string, number>();
            const n = 4000;
            for (let i = 0; i < n; i++) {
                const terms = fuelSaleTerms(`ship ${i}`);
                const key = `${terms.mood} ${terms.base}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
                // The same ship, the same terms, every time.
                expect(fuelSaleTerms(`ship ${i}`)).toEqual(terms);
            }
            expect([...counts.keys()].sort()).toEqual([
                'bad 3000', 'bad 4000', 'good 1000',
                'neutral 2000', 'neutral 3000',
            ]);
            // GUESS for the draw: moods 1 : 2 : 1, each neutral / bad step
            // even (bit 16 of the hash, unchanged by the good mood's
            // losing its step).
            const share = (key: string) => (counts.get(key) ?? 0) / n;
            expect(share('good 1000')).toBeGreaterThan(0.22);
            expect(share('good 1000')).toBeLessThan(0.28);
            for (const key of ['bad 3000', 'bad 4000']) {
                expect(share(key)).toBeGreaterThan(0.1);
                expect(share(key)).toBeLessThan(0.15);
            }
            for (const key of ['neutral 2000', 'neutral 3000']) {
                expect(share(key)).toBeGreaterThan(0.22);
                expect(share(key)).toBeLessThan(0.28);
            }
            // Pinned, so a change to the draw is a deliberate one.
            expect(fuelSaleTerms('ship0'))
                .toEqual({ mood: 'neutral', base: 2000 });
            expect(fuelSaleTerms('ship2')).toEqual({ mood: 'bad', base: 3000 });
            expect(fuelSaleTerms('ship3')).toEqual({ mood: 'good', base: 1000 });
            expect(fuelSaleTerms('ship10'))
                .toEqual({ mood: 'neutral', base: 3000 });
            // ship12 asked a good mood's 2,000 before wave 21.
            expect(fuelSaleTerms('ship12'))
                .toEqual({ mood: 'good', base: 1000 });
            expect(fuelSaleTerms('ship13')).toEqual({ mood: 'bad', base: 4000 });
        });

    it('the first ask is capped by the pilot\'s cash: min(own ask, '
        + 'max(1,000, cash / 3 to a 1,000)), no record term (reference H1 '
        + 'wave 19, findings 1 and 2)', () => {
            expect(FUEL_SALE_CASH_DIVISOR).toBe(3);
            const rich = 1_000_000;
            // A rich pilot pays the ship's own ask.
            expect(fuelAskingBase('ship13', { credits: rich })).toBe(4000);
            expect(fuelAskingBase('ship12', { credits: rich })).toBe(1000);
            expect(fuelAskingBase('ship3', { credits: rich })).toBe(1000);
            // 10,000 credits: a bad mood asks 3,000, neutrals 2,000 / 3,000.
            expect(fuelAskingBase('ship13', { credits: 10_000 })).toBe(3000);
            expect(fuelAskingBase('ship2', { credits: 10_000 })).toBe(3000);
            expect(fuelAskingBase('ship10', { credits: 10_000 })).toBe(3000);
            expect(fuelAskingBase('ship0', { credits: 10_000 })).toBe(2000);
            // 7,000 credits: every neutral and bad mood 2,000, bad ones
            // included; the good moods' own 1,000.
            for (const ship of ['ship13', 'ship2', 'ship10', 'ship0']) {
                expect(fuelAskingBase(ship, { credits: 7000 })).toBe(2000);
            }
            expect(fuelAskingBase('ship3', { credits: 7000 })).toBe(1000);
            expect(fuelAskingBase('ship12', { credits: 7000 })).toBe(1000);
            // 5,000 and 300: 1,000, never less (300 is still asked it).
            expect(fuelAskingBase('ship10', { credits: 5000 })).toBe(1000);
            expect(fuelAskingBase('ship10', { credits: 300 })).toBe(1000);
            expect(fuelAskingBase('ship13', { credits: 0 })).toBe(1000);
            // The cap's edges: 9,000 -> 3,000, 8,999 -> 2,000.
            expect(fuelAskingBase('ship13', { credits: 9000 })).toBe(3000);
            expect(fuelAskingBase('ship13', { credits: 8999 })).toBe(2000);
            // Nonsense cash is clamped rather than poisoning the price.
            expect(fuelAskingBase('ship13', { credits: -50 })).toBe(1000);
            expect(fuelAskingBase('ship13', { credits: NaN })).toBe(1000);
        });

    it('Lower Price: a counter or a withdrawal on the asking price, always a '
        + 'withdrawal on a counter, whatever the record; a withdrawal ends '
        + 'the ask (wave 17 finding 3, wave 19 finding 3)',
        () => {
            // 'target' / 'player' draw C, W, C, W, W, C for asks 0-5.
            expect([0, 1, 2, 3, 4, 5].map(asks =>
                fuelLowerPriceCounters('target', 'player', asks)))
                .toEqual([true, false, true, false, false, true]);
            expect(lowerFuelPrice({ asks: 1, countered: false }, 'target',
                'player')).toEqual({
                haggle: { asks: 2, countered: false }, outcome: 'withdraw',
            });
            const asked = { asks: 2, countered: false };
            const countered = lowerFuelPrice(asked, 'target', 'player');
            expect(countered).toEqual({
                haggle: { asks: 2, countered: true }, outcome: 'counter',
            });
            expect(lowerFuelPrice(countered.haggle, 'target', 'player'))
                .toEqual({
                    haggle: { asks: 3, countered: false },
                    outcome: 'withdraw',
                });
            // Pure: the argument is not touched.
            expect(asked).toEqual({ asks: 2, countered: false });
            // About one first press in four counters (MEASURED, "H1 /
            // mission-ship leftovers, wave 22": 20 of 79), at every ask.
            for (const ask of [0, 1, 2, 3]) {
                let counters = 0;
                for (let i = 0; i < 4000; i++) {
                    if (fuelLowerPriceCounters(`ship ${i}`, 'player', ask)) {
                        counters++;
                    }
                }
                expect(counters / 4000).withContext(`ask ${ask}`)
                    .toBeGreaterThan(0.22);
                expect(counters / 4000).withContext(`ask ${ask}`)
                    .toBeLessThan(0.28);
            }
        });

    it('Accept ends the ask (GUESS); the further-along haggle wins', () => {
        expect(fuelHaggleAfterAccept({ asks: 2, countered: true }))
            .toEqual({ asks: 3, countered: false });
        const a = { asks: 1, countered: false };
        const b = { asks: 1, countered: true };
        const c = { asks: 2, countered: false };
        expect(laterFuelHaggle(a, b)).toBe(b);
        expect(laterFuelHaggle(b, a)).toBe(b);
        expect(laterFuelHaggle(c, b)).toBe(c);
        expect(laterFuelHaggle(undefined, a)).toBe(a);
        expect(laterFuelHaggle(a, undefined)).toBe(a);
        expect(laterFuelHaggle(undefined, undefined)).toEqual(NO_FUEL_HAGGLE);
    });
});

describe('the refusal / price / escort / rude lines (STR# 3000)', () => {
    const table = Array.from({ length: 190 }, (_, i) => `line ${i}`);
    it('draws each from its own group, deterministically by seed', () => {
        for (let seed = 0; seed < 10; seed++) {
            const pick = (text: string) => Number(text.split(' ')[1]);
            const refused = pick(assistRefusedText(table, seed));
            expect(refused).toBeGreaterThanOrEqual(ASSIST_REFUSED_FIRST_INDEX);
            expect(refused).toBeLessThan(ASSIST_REFUSED_FIRST_INDEX + 5);
            const forPay = pick(assistForPayText(table, seed));
            expect(forPay).toBeGreaterThanOrEqual(ASSIST_FOR_PAY_FIRST_INDEX);
            expect(forPay).toBeLessThan(ASSIST_FOR_PAY_FIRST_INDEX + 5);
            const paid = pick(assistPaidText(table, seed));
            expect(paid).toBeGreaterThanOrEqual(ASSIST_PAID_FIRST_INDEX);
            expect(paid).toBeLessThan(ASSIST_PAID_FIRST_INDEX + 5);
            // Only the two "just an escort" entries, never 110-112.
            expect([113, 114]).toContain(pick(justAnEscortText(table, seed)));
            // The rude greeting is entries 11-15 of the maintainer's
            // one-indexed viewer: 0-based 10-14.
            const rude = pick(rudeGreetingText(table, seed));
            expect(rude).toBeGreaterThanOrEqual(10);
            expect(rude).toBeLessThan(15);
            expect(assistRefusedText(table, seed))
                .toBe(assistRefusedText(table, seed));
        }
    });
    it('falls back to the pinned literals with no table', () => {
        expect(assistRefusedText(undefined)).toBe("I'd rather not.");
        expect(justAnEscortText(undefined))
            .toBe("Sorry sir, I'm just an escort.");
        expect(assistForPayText(undefined))
            .toBe("All right, I'll give you some help, but it'll cost you.");
        expect(assistPaidText(undefined)).toBe("Okay, I'm on my way.");
        expect(rudeGreetingText(undefined)).toBe('What is it you want?');
    });
});

describe('assistIsFree', () => {
    it('is free for Roadside Assistance govts', () => {
        expect(assistIsFree(withFlags2({ roadsideAssistance: true })))
            .toBe(true);
        expect(assistIsFree(withFlags2({ roadsideAssistance: true }), false,
            'fuel')).toBe(true);
    });
    it('a ränk 0x0800 refuels for free and does NOT repair (reference P1 / '
        + 'H1 wave 18, finding 4)', () => {
        expect(assistIsFree(govt(), true, 'fuel')).toBe(true);
        expect(assistIsFree(govt(), true, 'disabled')).toBe(false);
        expect(assistIsFree(govt(), true)).toBe(false);
    });
    it('answers a pilot who cannot pay from STR# 3000 60-64', () => {
        expect(cantAffordText(undefined)).toBe(CANT_AFFORD_FALLBACK);
        const strings = Array.from({ length: 70 }, (_, i) => `line ${i}`);
        for (let seed = 0; seed < 10; seed++) {
            const index = Number(cantAffordText(strings, seed).split(' ')[1]);
            expect(index).toBeGreaterThanOrEqual(CANT_AFFORD_FIRST_INDEX);
            expect(index).toBeLessThan(CANT_AFFORD_FIRST_INDEX
                + CANT_AFFORD_COUNT);
        }
    });
    it('is not (yet) free otherwise', () => {
        expect(assistIsFree(govt())).toBe(false);
        expect(assistIsFree(undefined)).toBe(false);
    });
});

describe('planetTakesBribes', () => {
    it('honors planetsTakeBribes and largerBribes', () => {
        expect(planetTakesBribes(withFlags({ planetsTakeBribes: true })))
            .toBe(true);
        expect(planetTakesBribes(withFlags({ largerBribes: true }))).toBe(true);
        expect(planetTakesBribes(govt())).toBe(false);
        expect(planetTakesBribes(undefined)).toBe(false);
    });
});

describe('greetingText', () => {
    const greetings = ['Alpha', 'Bravo', 'Charlie'];
    it('prefers a pers CommQuote over a govt greeting', () => {
        expect(greetingText({ persCommQuote: 'Hello there!',
            govtGreetings: greetings, govtCommName: 'Fed', talkative: true }))
            .toBe('Hello there!');
    });
    it('picks a real govt greeting when there is no pers quote', () => {
        // seed 4 % 3 = 1 -> the second greeting.
        expect(greetingText({ govtGreetings: greetings, seed: 4,
            talkative: true })).toBe('Bravo');
    });
    it('picks the govt greeting deterministically by seed', () => {
        // Same seed -> same line every time (no Math.random).
        const first = greetingText({ govtGreetings: greetings, seed: 7,
            talkative: true });
        const again = greetingText({ govtGreetings: greetings, seed: 7,
            talkative: true });
        expect(first).toBe(again);
        expect(greetings).toContain(first);
        // A different seed can select a different line (8 % 3 = 2).
        expect(greetingText({ govtGreetings: greetings, seed: 8,
            talkative: true })).toBe('Charlie');
    });
    it('falls back to a synthetic line with no greeting resource', () => {
        expect(greetingText({ govtGreetings: [], govtCommName: 'the Federation',
            talkative: true })).toContain('the Federation');
    });
    it('is empty when the govt is not talkative', () => {
        expect(greetingText({ persCommQuote: 'Hi', talkative: false }))
            .toBe('');
    });
});

describe('hashString', () => {
    it('is stable and deterministic for the same input', () => {
        expect(hashString('abc')).toBe(hashString('abc'));
    });
    it('produces an unsigned 32-bit integer', () => {
        const h = hashString('some-ship-uuid');
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
        expect(Number.isInteger(h)).toBeTrue();
    });
    it('differs for different inputs (no trivial collisions)', () => {
        expect(hashString('uuid-a')).not.toBe(hashString('uuid-b'));
    });
});

describe('shipIsFighting', () => {
    it('is true for an NPC in attack mode with a target', () => {
        expect(shipIsFighting({ npcMode: 'attack', npcTarget: 'someone' }))
            .toBeTrue();
    });

    it('is false for attack mode with nothing targeted', () => {
        // NpcFireControl needs both before it fires a shot, so both are
        // required here: no target means nothing is being shot at.
        expect(shipIsFighting({ npcMode: 'attack', npcTarget: undefined }))
            .toBeFalse();
    });

    it('is false for the peaceful modes, even with a target', () => {
        for (const mode of ['travel', 'dwell', 'patrol', 'depart', undefined]) {
            expect(shipIsFighting({ npcMode: mode, npcTarget: 'someone' }))
                .withContext(`mode ${mode}`).toBeFalse();
        }
    });

    it('is false for a FLEEING ship', () => {
        // Running away is not shooting, and a fleeing ship talked into a
        // rendezvous was never the complaint.
        expect(shipIsFighting({ npcMode: 'flee', npcTarget: 'someone' }))
            .toBeFalse();
    });

    it('is true for the legacy shoot-all-weapons dev enemy', () => {
        expect(shipIsFighting({
            npcMode: undefined, npcTarget: undefined, shootsAllWeapons: true,
        })).toBeTrue();
    });

    it('is false for a ship with no NPC brain at all', () => {
        expect(shipIsFighting({ npcMode: undefined, npcTarget: undefined }))
            .toBeFalse();
    });
});

describe('busyResponseText', () => {
    // The stock table's busy group (STR# 3000 indices 80-84) as it reads in
    // the real game data; string_table_integration_test pins that.
    const table: string[] = [];
    table[BUSY_RESPONSE_FIRST_INDEX] = "I'm busy.";
    table[BUSY_RESPONSE_FIRST_INDEX + 1] = "I'm a little busy right now.";
    table[BUSY_RESPONSE_FIRST_INDEX + 2] = "I'm too busy to help you.";
    table[BUSY_RESPONSE_FIRST_INDEX + 3] = 'I have other business.';
    table[BUSY_RESPONSE_FIRST_INDEX + 4] = "I've got other things to do.";

    it('picks a line from the busy group', () => {
        const line = busyResponseText(table, 12345);
        expect(table.slice(BUSY_RESPONSE_FIRST_INDEX,
            BUSY_RESPONSE_FIRST_INDEX + BUSY_RESPONSE_COUNT))
            .toContain(line);
    });

    it('is deterministic in the seed (no PRNG, same on every peer)', () => {
        for (const seed of [0, 1, 2, 3, 4, 99, 123456]) {
            expect(busyResponseText(table, seed))
                .toBe(busyResponseText(table, seed));
        }
    });

    it('spreads across the whole group as the seed varies', () => {
        const seen = new Set<string>();
        for (let seed = 0; seed < BUSY_RESPONSE_COUNT; seed++) {
            seen.add(busyResponseText(table, seed));
        }
        expect(seen.size).toBe(BUSY_RESPONSE_COUNT);
    });

    it('falls back to the pinned literal with no usable table', () => {
        expect(busyResponseText(undefined)).toBe(BUSY_RESPONSE_FALLBACK);
        expect(busyResponseText([])).toBe(BUSY_RESPONSE_FALLBACK);
    });

    it('skips blank entries rather than answering with an empty line', () => {
        const sparse: string[] = [];
        sparse[BUSY_RESPONSE_FIRST_INDEX] = '  ';
        sparse[BUSY_RESPONSE_FIRST_INDEX + 1] = 'I have other business.';
        for (const seed of [0, 1, 2, 3, 4]) {
            expect(busyResponseText(sparse, seed))
                .toBe('I have other business.');
        }
    });
});

describe('noNeedResponseText', () => {
    // STR# 3000 indices 70-74, the group the original answers a pointless
    // assistance request with (string_table_integration_test pins the data).
    const table: string[] = [];
    table[NO_NEED_RESPONSE_FIRST_INDEX] = "You're not in any trouble.";
    table[NO_NEED_RESPONSE_FIRST_INDEX + 1] = "You're in no danger.";
    table[NO_NEED_RESPONSE_FIRST_INDEX + 2] = "You don't have any problems.";
    table[NO_NEED_RESPONSE_FIRST_INDEX + 3] =
        "It looks like you're sitting pretty from here.  Try helping yourself.";
    table[NO_NEED_RESPONSE_FIRST_INDEX + 4] =
        "There's no danger to you right now.";

    it('picks a line from the no-need group', () => {
        expect(table.slice(NO_NEED_RESPONSE_FIRST_INDEX,
            NO_NEED_RESPONSE_FIRST_INDEX + NO_NEED_RESPONSE_COUNT))
            .toContain(noNeedResponseText(table, 4242));
    });

    it('never answers with a BUSY line (the neighbouring group)', () => {
        const both = [...table];
        both[BUSY_RESPONSE_FIRST_INDEX] = "I'm busy.";
        for (let seed = 0; seed < NO_NEED_RESPONSE_COUNT; seed++) {
            expect(noNeedResponseText(both, seed)).not.toBe("I'm busy.");
        }
    });

    it('is deterministic in the seed (no PRNG, same on every peer)', () => {
        for (const seed of [0, 1, 2, 3, 4, 99, 123456]) {
            expect(noNeedResponseText(table, seed))
                .toBe(noNeedResponseText(table, seed));
        }
    });

    it('spreads across the whole group as the seed varies', () => {
        const seen = new Set<string>();
        for (let seed = 0; seed < NO_NEED_RESPONSE_COUNT; seed++) {
            seen.add(noNeedResponseText(table, seed));
        }
        expect(seen.size).toBe(NO_NEED_RESPONSE_COUNT);
    });

    it('falls back to the pinned literal with no usable table', () => {
        expect(noNeedResponseText(undefined)).toBe(NO_NEED_RESPONSE_FALLBACK);
        expect(noNeedResponseText([])).toBe(NO_NEED_RESPONSE_FALLBACK);
    });
});

describe('hostileResponseText', () => {
    // STR# 3000 indices 10-14 — what a hostile ship answers a hail with
    // ("What is it?" on hail/hail_hostile.png). A GLOBAL table: the per-govt
    // STR# 7000+ resources hold only friendly greetings.
    const table: string[] = [];
    table[HOSTILE_RESPONSE_FIRST_INDEX] = 'What is it you want?';
    table[HOSTILE_RESPONSE_FIRST_INDEX + 1] = 'What do you want?';
    table[HOSTILE_RESPONSE_FIRST_INDEX + 2] = 'What is it?';
    table[HOSTILE_RESPONSE_FIRST_INDEX + 3] = 'What is it?';
    table[HOSTILE_RESPONSE_FIRST_INDEX + 4] = 'What?';

    it('picks a line from the hostile group', () => {
        expect(table.slice(HOSTILE_RESPONSE_FIRST_INDEX,
            HOSTILE_RESPONSE_FIRST_INDEX + HOSTILE_RESPONSE_COUNT))
            .toContain(hostileResponseText(table, 987));
    });

    it('never answers with a friendly greeting (the group at 20-24)', () => {
        const both = [...table];
        both[20] = 'What can I do for you?';
        for (let seed = 0; seed < HOSTILE_RESPONSE_COUNT; seed++) {
            expect(hostileResponseText(both, seed))
                .not.toBe('What can I do for you?');
        }
    });

    it('is deterministic in the seed (no PRNG, same on every peer)', () => {
        for (const seed of [0, 1, 2, 3, 4, 99, 123456]) {
            expect(hostileResponseText(table, seed))
                .toBe(hostileResponseText(table, seed));
        }
    });

    it('falls back to the pinned literal with no usable table', () => {
        expect(hostileResponseText(undefined))
            .toBe(HOSTILE_RESPONSE_FALLBACK);
        expect(hostileResponseText([])).toBe(HOSTILE_RESPONSE_FALLBACK);
    });
});
