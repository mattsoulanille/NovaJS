import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics } from 'novadatainterface/ship_data';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import {
    applyOutfitPhysics, installedOutfitMass, OutfitsState, sumOutfitField,
} from './outfit_plugin.js';

/** A gameData stub exposing only Outfit.getCached. */
function mockGameData(outfits: { [id: string]: OutfitData | undefined }) {
    return { data: { Outfit: { getCached: (id: string) => outfits[id] } } } as any;
}

function outfit(id: string, over: Partial<OutfitData>): OutfitData {
    return { ...getDefaultOutfitData(), id, ...over };
}

describe('installedOutfitMass (oütf flag 0x0400)', () => {
    /** Carbon Fiber, as stock oütf 180 is written: Mass 1, flags 0x0600. */
    const carbonFiber = outfit('nova:180', {
        massScalesWithShipMass: true, physics: { freeMass: 1 },
    });

    it('is the written mass on an ordinary outfit', () => {
        const plain = outfit('nova:129', { physics: { freeMass: 8 } });
        expect(installedOutfitMass(plain, 10_000)).toBe(8);
    });

    it('is ship mass x item mass / 100 when flagged', () => {
        // A Leviathan (shïp 131, Mass 10,000) carries 100 tons of it.
        expect(installedOutfitMass(carbonFiber, 10_000)).toBe(100);
        // Spun Diamond (Mass 1) on a Starbridge (98): 0.98 -> 1.
        expect(installedOutfitMass(carbonFiber, 98)).toBe(1);
    });

    it('rounds a fractional ton UP (the Heavy Shuttle capture)', () => {
        // earth_outfitter_carbon_fiber_cant_hold_any_more.png: a mass-25
        // hull reads "Item Mass: 1 ton" and cannot hold it in 0 tons.
        expect(installedOutfitMass(carbonFiber, 25)).toBe(1);
    });

    it('leaves a negative or zero mass alone ("positive-mass items only")',
        () => {
            const expansion = outfit('nova:190', {
                massScalesWithShipMass: true, physics: { freeMass: -10 },
            });
            expect(installedOutfitMass(expansion, 10_000)).toBe(-10);
            const weightless = outfit('nova:236', {
                massScalesWithShipMass: true, physics: { freeMass: 0 },
            });
            expect(installedOutfitMass(weightless, 10_000)).toBe(0);
        });

    it('is what applyOutfitPhysics takes off the hull', () => {
        const hull = { ...getDefaultShipPhysics(), mass: 10_000, freeMass: 500 };
        const physics = applyOutfitPhysics(hull, [[carbonFiber, 2]]);
        expect(physics.freeMass).toBe(300);
        // ...and the unflagged case is unchanged.
        const plain = outfit('nova:129', { physics: { freeMass: 8 } });
        expect(applyOutfitPhysics(hull, [[plain, 2]]).freeMass).toBe(484);
    });
});

describe('sumOutfitField', () => {
    it('sums a field across owned outfits weighted by count', () => {
        const outfits: OutfitsState = new Map([
            ['a', { count: 2 }],
            ['b', { count: 1 }],
        ]);
        const total = sumOutfitField(outfits, mockGameData({
            a: outfit('a', { murkClear: 3 }),
            b: outfit('b', { murkClear: 5 }),
        }), o => o.murkClear);
        expect(total).toEqual(2 * 3 + 5);
    });

    it('ignores zero-count outfits', () => {
        const outfits: OutfitsState = new Map([['a', { count: 0 }]]);
        const total = sumOutfitField(outfits,
            mockGameData({ a: outfit('a', { interferenceReduction: 20 }) }),
            o => o.interferenceReduction);
        expect(total).toEqual(0);
    });

    it('returns undefined until the outfit data is cached', () => {
        const outfits: OutfitsState = new Map([['a', { count: 1 }]]);
        const total = sumOutfitField(outfits, mockGameData({}),
            o => o.murkClear);
        expect(total).toBeUndefined();
    });
});

describe('applyOutfitPhysics', () => {
    const base = getDefaultShipData().physics;

    it('grants a boolean capability from an owned outfit', () => {
        const dampers = outfit('a', {
            physics: { inertialess: true } as OutfitData['physics'],
        });
        expect(applyOutfitPhysics(base, [[dampers, 1]]).inertialess)
            .toBeTrue();
    });

    it('grants nothing from a zero-count entry, booleans included', () => {
        const dampers = outfit('a', {
            physics: {
                inertialess: true, canJumpWithoutSlowing: true,
                autoRefuel: true, speed: 50,
            } as OutfitData['physics'],
        });
        const physics = applyOutfitPhysics(base, [[dampers, 0]]);
        expect(physics.inertialess).toBe(base.inertialess);
        expect(physics.canJumpWithoutSlowing).toBe(base.canJumpWithoutSlowing);
        expect(physics.autoRefuel).toBe(base.autoRefuel);
        expect(physics.speed).toBe(base.speed);
        expect(physics).toEqual(base);
    });
});

// These assertions run against the real Nova game data (Nova_Data): oütf
// resource -> OutfResource parser -> OutfitParse -> OutfitData. They pin the
// stock outfits that carry each newly-decoded passive ModType.
describe('passive ModTypes against real Nova data', () => {
    it('decodes the Sensor Boost (nova:203) murk + interference mods', async () => {
        const gameData = await getIntegrationGameData();
        const boost = await gameData.data.Outfit.get('nova:203');
        // ModVal murk modifier -3 clears 3 murk; interference mod 20 clears 20.
        expect(boost.murkClear).toEqual(3);
        expect(boost.interferenceReduction).toEqual(20);
    });

    it('decodes the IFF Decoder (nova:185)', async () => {
        const gameData = await getIntegrationGameData();
        const iff = await gameData.data.Outfit.get('nova:185');
        expect(iff.iff).toBe(true);
    });

    it('decodes the Auto-recharger (nova:186) as auto-refuel', async () => {
        const gameData = await getIntegrationGameData();
        const outfit = await gameData.data.Outfit.get('nova:186');
        expect(outfit.autoRefuel).toBe(true);
        expect(outfit.physics.autoRefuel).toBe(true);
    });

    it('decodes the Multi-Jumping Organ (nova:275) multi-jump + fast jump', async () => {
        const gameData = await getIntegrationGameData();
        const outfit = await gameData.data.Outfit.get('nova:275');
        expect(outfit.multiJump).toEqual(10);
        expect(outfit.physics.multiJump).toEqual(10);
        // It also grants fast jumping.
        expect(outfit.physics.canJumpWithoutSlowing).toBe(true);
    });

    it('decodes the stubbed passives (map, marines, density scanner, etc.)', async () => {
        const gameData = await getIntegrationGameData();
        expect((await gameData.data.Outfit.get('nova:237')).map).toEqual(3);
        expect((await gameData.data.Outfit.get('nova:227')).marines).toEqual(25);
        expect((await gameData.data.Outfit.get('nova:184')).densityScanner)
            .toBe(true);
        expect((await gameData.data.Outfit.get('nova:437')).repairSystem)
            .toBe(true);
        // Federation IFF Projector: an IFF scrambler carrying a govt class.
        const scrambler = await gameData.data.Outfit.get('nova:442');
        expect(scrambler.iffScramblerClass).not.toBeNull();
    });
});
