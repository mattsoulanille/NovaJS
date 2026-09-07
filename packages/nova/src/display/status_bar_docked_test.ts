import 'jasmine';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { OutfitsState } from '../nova_plugin/ship/index.js';
import { cargoCapacityOf, cargoDisplayOf } from './status_bar_cargo.js';

/**
 * The status bar's credits/cargo readout while DOCKED is driven by the same
 * cargoCapacityOf / cargoDisplayOf helpers as the in-flight readout, fed from
 * the docked ship (or the open venue's live working state) instead of the
 * in-world player entity. These exercise the shared computation the docked
 * source relies on — including that a venue's overriding capacity/cargo
 * yields a different Free than the committed entity would.
 */

function fakeGameData(options: {
    ships?: Record<string, { freeCargo: number }>,
    outfits?: Record<string, { freeCargo?: number }>,
    junk?: Record<string, { abbrev: string }>,
}): SimulationGameDataInterface {
    return {
        data: {
            Ship: {
                getCached: (id: string) => {
                    const s = options.ships?.[id];
                    return s ? { physics: { freeCargo: s.freeCargo } } : undefined;
                },
            },
            Outfit: {
                getCached: (id: string) => {
                    const o = options.outfits?.[id];
                    return o ? { physics: { freeCargo: o.freeCargo } } : undefined;
                },
            },
            Junk: {
                getCached: (id: string) => options.junk?.[id],
            },
        },
    } as unknown as SimulationGameDataInterface;
}

function outfitsState(counts: Record<string, number>): OutfitsState {
    return new Map(Object.entries(counts).map(([id, count]) => [id, { count }]));
}

describe('cargoCapacityOf', () => {
    it('returns the hull freeCargo when the ship has no outfits', () => {
        const gameData = fakeGameData({ ships: { 'nova:128': { freeCargo: 50 } } });
        expect(cargoCapacityOf('nova:128', undefined, gameData)).toBe(50);
    });

    it('adds each owned outfit’s freeCargo, weighted by count', () => {
        const gameData = fakeGameData({
            ships: { 'nova:128': { freeCargo: 50 } },
            outfits: { 'nova:200': { freeCargo: 10 } },
        });
        // 50 hull + 10 * 3 outfits.
        expect(cargoCapacityOf('nova:128', outfitsState({ 'nova:200': 3 }), gameData))
            .toBe(80);
    });

    it('returns undefined until the ship data is cached', () => {
        expect(cargoCapacityOf('nova:128', undefined, fakeGameData({})))
            .toBeUndefined();
    });

    it('returns undefined until an owned outfit’s data is cached', () => {
        const gameData = fakeGameData({ ships: { 'nova:128': { freeCargo: 50 } } });
        expect(cargoCapacityOf('nova:128', outfitsState({ 'nova:200': 1 }), gameData))
            .toBeUndefined();
    });
});

describe('cargoDisplayOf', () => {
    const gameData = fakeGameData({ junk: { '5': { abbrev: 'Gz' } } });

    it('computes free space and the standard-commodity manifest', () => {
        const cargo = new Map([['cargo:0', 20], ['cargo:3', 5]]);
        const { free, lines, special } = cargoDisplayOf(cargo, 50, gameData);
        expect(free).toBe(25); // 50 capacity - 25 used
        expect(lines).toEqual([
            { name: 'Food', quantity: 20 },
            { name: 'LuxG', quantity: 5 },
        ]);
        expect(special).toBeNull();
    });

    it('lists jünk commodities and summarizes mission cargo as Special', () => {
        const cargo = new Map([['junk:5', 4], ['mission:m1', 3]]);
        const { free, lines, special } = cargoDisplayOf(cargo, 50, gameData);
        expect(free).toBe(43); // 50 - (4 + 3)
        expect(lines).toEqual([{ name: 'Gz', quantity: 4 }]);
        expect(special).toBe('Cargo');
    });

    it('omits zero-quantity commodities from the manifest', () => {
        const cargo = new Map([['cargo:0', 0], ['cargo:1', 8]]);
        const { free, lines } = cargoDisplayOf(cargo, 50, gameData);
        expect(free).toBe(42);
        expect(lines).toEqual([{ name: 'Ind', quantity: 8 }]);
    });

    it('reflects a venue’s overriding capacity/hold (the docked live source)', () => {
        // What the committed entity would show: 50 tons, 30 used -> Free 20.
        const committed = cargoDisplayOf(new Map([['cargo:0', 30]]), 50, gameData);
        expect(committed.free).toBe(20);
        // The trade center's working state mid-buy: same hull, 45 tons bought.
        const working = cargoDisplayOf(new Map([['cargo:0', 45]]), 50, gameData);
        expect(working.free).toBe(5);
    });
});
