import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { applyOutfitPhysics, OutfitsState, sumOutfitField } from './outfit_plugin.js';

/** A gameData stub exposing only Outfit.getCached. */
function mockGameData(outfits: { [id: string]: OutfitData | undefined }) {
    return { data: { Outfit: { getCached: (id: string) => outfits[id] } } } as any;
}

function outfit(id: string, over: Partial<OutfitData>): OutfitData {
    return { ...getDefaultOutfitData(), id, ...over };
}

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
