import 'jasmine';
import { getDefaultOopsData, OopsData } from 'novadatainterface/oops_data';
import {
    activePriceEvents,
    applyPriceEvents,
    eventStartsOn,
    isEventActive,
} from './price_events.js';
import {
    buyGoodQuantity,
    sellGood,
    standardTradeGoods,
    STANDARD_COMMODITY_BASE_PRICES,
    TradeGood,
} from './trade_logic.js';
import { getDefaultPlanetData, PlanetData, TradeTier } from 'novadatainterface/planet_data';

function makeOops(oops: Partial<OopsData>): OopsData {
    return { ...getDefaultOopsData(), ...oops };
}

function makePlanet(tradeTiers: (TradeTier | null)[]): PlanetData {
    return { ...getDefaultPlanetData(), tradeTiers };
}

describe('eventStartsOn / isEventActive', () => {
    it('is deterministic: same inputs give the same result', () => {
        const oops = makeOops({ id: 'nova:128', freq: 35, duration: 30 });
        for (let day = 0; day < 200; day++) {
            expect(eventStartsOn(oops, day)).toBe(eventStartsOn(oops, day));
            expect(isEventActive(oops, day)).toBe(isEventActive(oops, day));
        }
    });

    it('never starts when freq is 0', () => {
        const oops = makeOops({ id: 'nova:200', freq: 0, duration: 20 });
        for (let day = 0; day < 500; day++) {
            expect(eventStartsOn(oops, day)).toBe(false);
        }
        expect(isEventActive(oops, 100)).toBe(false);
    });

    it('always starts when freq is 100', () => {
        const oops = makeOops({ id: 'nova:201', freq: 100, duration: 5 });
        for (let day = 0; day < 500; day++) {
            expect(eventStartsOn(oops, day)).toBe(true);
        }
    });

    it('is never active with a non-positive duration', () => {
        const oops = makeOops({ id: 'nova:202', freq: 100, duration: 0 });
        expect(isEventActive(oops, 10)).toBe(false);
    });

    it('starts at roughly the configured frequency across many days', () => {
        // freq is a percentage; over a long horizon the empirical rate
        // should land near it (the hash is well-distributed).
        const oops = makeOops({ id: 'nova:203', freq: 30, duration: 1 });
        let starts = 0;
        const days = 20_000;
        for (let day = 0; day < days; day++) {
            if (eventStartsOn(oops, day)) {
                starts++;
            }
        }
        const rate = starts / days;
        expect(rate).toBeGreaterThan(0.27);
        expect(rate).toBeLessThan(0.33);
    });

    it('stays active for the whole duration after a lone start', () => {
        // freq is low enough that starts are sparse; find one and check
        // the event is active for exactly `duration` days after it.
        const oops = makeOops({ id: 'nova:204', freq: 2, duration: 10 });
        let start = -1;
        for (let day = 0; day < 5000; day++) {
            if (eventStartsOn(oops, day)
                // isolated: no other start in the surrounding window
                && !eventStartsOn(oops, day + 1)
                && !eventStartsOn(oops, day - 1)) {
                // Ensure no other start through the lapse day, so the
                // event is guaranteed inactive on day start+duration.
                let clean = true;
                for (let d = day + 1; d <= day + oops.duration; d++) {
                    if (eventStartsOn(oops, d)) {
                        clean = false;
                        break;
                    }
                }
                if (clean) {
                    start = day;
                    break;
                }
            }
        }
        expect(start).toBeGreaterThanOrEqual(0);
        // Active on the start day and each of the next duration-1 days.
        for (let d = start; d < start + oops.duration; d++) {
            expect(isEventActive(oops, d)).withContext(`day ${d}`).toBe(true);
        }
        // Inactive the day after it lapses (given the clean window).
        expect(isEventActive(oops, start + oops.duration)).toBe(false);
    });

    it('different resource ids roll independently', () => {
        const a = makeOops({ id: 'nova:128', freq: 50, duration: 1 });
        const b = makeOops({ id: 'nova:129', freq: 50, duration: 1 });
        let differ = 0;
        for (let day = 0; day < 100; day++) {
            if (eventStartsOn(a, day) !== eventStartsOn(b, day)) {
                differ++;
            }
        }
        // Independent 50/50 rolls should disagree on many days.
        expect(differ).toBeGreaterThan(20);
    });
});

describe('activePriceEvents', () => {
    const FOOD_SURPLUS = makeOops({
        id: 'nova:128', name: 'An enormous food surplus',
        stellar: 'nova:137', commodity: 0, priceDelta: -15,
        duration: 30, freq: 100,
    });

    it('matches an event to its stellar', () => {
        const events = activePriceEvents(
            [FOOD_SURPLUS], 'nova:137', 500, new Set());
        expect(events.length).toBe(1);
        expect(events[0]).toEqual(
            { commodity: 0, priceDelta: -15, name: 'An enormous food surplus' });
    });

    it('does not fire at a different stellar', () => {
        expect(activePriceEvents([FOOD_SURPLUS], 'nova:200', 500, new Set()))
            .toEqual([]);
    });

    it('applies "any planet" (Stellar = -1) events everywhere', () => {
        const wildcard = makeOops({
            id: 'nova:300', appliesToAll: true, stellar: null,
            commodity: 1, priceDelta: 40, duration: 20, freq: 100,
        });
        expect(activePriceEvents([wildcard], 'nova:999', 10, new Set()).length)
            .toBe(1);
    });

    it('honors the ActivateOn NCB test', () => {
        const gated = makeOops({
            id: 'nova:301', stellar: 'nova:137', commodity: 2,
            priceDelta: -30, duration: 20, freq: 100, activateOn: 'b100',
        });
        expect(activePriceEvents([gated], 'nova:137', 10, new Set()))
            .toEqual([]);
        expect(activePriceEvents([gated], 'nova:137', 10, new Set([100])).length)
            .toBe(1);
    });

    it('shows at most one event per commodity (lowest id wins)', () => {
        const first = makeOops({
            id: 'nova:128', stellar: 'nova:137', commodity: 0,
            priceDelta: -15, duration: 30, freq: 100, name: 'first',
        });
        const second = makeOops({
            id: 'nova:129', stellar: 'nova:137', commodity: 0,
            priceDelta: -40, duration: 30, freq: 100, name: 'second',
        });
        const events = activePriceEvents(
            [second, first], 'nova:137', 10, new Set());
        expect(events.length).toBe(1);
        expect(events[0].name).toBe('first');
    });
});

describe('applyPriceEvents', () => {
    // Port Kane's real tiers: food is "high" (base 75 -> 93: tier prices
    // TRUNCATE like the original — Medical high is a measured 937, not
    // the rounded 938; see tierPrice).
    const portKane = makePlanet(['high', 'med', 'high', 'med', 'med', 'low']);

    it('overrides the tier with basePrice + delta and marks the row', () => {
        const goods = standardTradeGoods(portKane);
        const food = goods.find(g => g.key === 'cargo:0')!;
        expect(food.price).toBe(93); // floor(75 * 1.25), the high tier
        const adjusted = applyPriceEvents(goods, [
            { commodity: 0, priceDelta: -15, name: 'An enormous food surplus' },
        ]);
        const adjustedFood = adjusted.find(g => g.key === 'cargo:0')!;
        // Reference screenshot: food shows 60 = base 75 - 15, NOT 94 - 15.
        expect(adjustedFood.price).toBe(60);
        expect(adjustedFood.event).toEqual(
            { name: 'An enormous food surplus', direction: 'lower' });
    });

    it('marks a price rise as "higher"', () => {
        const goods = standardTradeGoods(portKane);
        const adjusted = applyPriceEvents(goods, [
            { commodity: 0, priceDelta: 15, name: 'A minor drought' },
        ]);
        const food = adjusted.find(g => g.key === 'cargo:0')!;
        expect(food.price).toBe(90); // 75 + 15
        expect(food.event!.direction).toBe('higher');
    });

    it('clamps the price to at least 1 credit', () => {
        const goods = standardTradeGoods(portKane);
        const adjusted = applyPriceEvents(goods, [
            { commodity: 0, priceDelta: -1000, name: 'Free food' },
        ]);
        expect(adjusted.find(g => g.key === 'cargo:0')!.price).toBe(1);
    });

    it('leaves unaffected commodities and jünk rows untouched', () => {
        const goods: TradeGood[] = [
            ...standardTradeGoods(portKane),
            {
                key: 'junk:nova:500', name: 'Widgets', tier: 'high',
                price: 999, canBuy: false, canSell: true,
            },
        ];
        const adjusted = applyPriceEvents(goods, [
            { commodity: 0, priceDelta: -15, name: 'surplus' },
        ]);
        // Industrial (cargo:1) unchanged.
        expect(adjusted.find(g => g.key === 'cargo:1')!.event).toBeUndefined();
        // Jünk row unchanged.
        const junk = adjusted.find(g => g.key === 'junk:nova:500')!;
        expect(junk.price).toBe(999);
        expect(junk.event).toBeUndefined();
    });
});

describe('trade flow at an event-adjusted price', () => {
    it('buys and sells standard commodities at the event price', () => {
        // A surplus drops food to base 75 - 30 = 45. Buying/selling must
        // use that adjusted price, including via the working state.
        const goods = standardTradeGoods(
            makePlanet(['med', null, null, null, null, null]));
        const [adjustedFood] = applyPriceEvents(goods, [
            { commodity: 0, priceDelta: -30, name: 'surplus' },
        ]);
        expect(adjustedFood.price).toBe(45);
        expect(STANDARD_COMMODITY_BASE_PRICES[0]).toBe(75);

        // 10 tons at 45 = 450 credits.
        const state = {
            cargo: new Map<string, number>(),
            credits: { credits: 1000 },
            cargoCapacity: 50,
        };
        // Reuse the pure trade helpers against the adjusted good.
        const bought = buyGoodQuantity(state, adjustedFood, 10);
        expect(bought).toBe(10);
        expect(state.credits.credits).toBe(1000 - 450);
        expect(state.cargo.get('cargo:0')).toBe(10);
        const sold = sellGood(state, adjustedFood);
        expect(sold).toBe(10);
        expect(state.credits.credits).toBe(1000); // round trip at 45
    });
});
