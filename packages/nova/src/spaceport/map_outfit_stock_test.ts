import 'jasmine';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import {
    DISCOVERY_LANDED, DISCOVERY_UNKNOWN,
} from '../nova_plugin/discovery.js';
import {
    discoveryLevel, DiscoveryStorage, resetDiscovery, setDiscoveryStorageKey,
} from '../nova_plugin/discovery_store.js';
import { applyMapOutfit, applyOwnedMapOutfits } from './map_outfit.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * ============================================================================
 * oütf ModType 16 "map" against the real stock data
 * ============================================================================
 *
 * The Bible (:1824) defines the ModVal three ways — a jump radius, "-1
 * explore all inhabited independent systems", and "-1000 & down explore all
 * systems of this govt class". This spec walks the REAL hyperspace link
 * graph rather than a toy one, because the radius form is only meaningful
 * against real Con1-16 data (novaparse closes the relation both ways, see
 * SystemData.links).
 *
 * It also pins the Vell-os chain, which is the only reason the game ever
 * hands a map out for free: oütf nova:251 "Vell-os Area Map" (the ability)
 * OnPurchase `b450` -> crön nova:381 "Vell-os Area Map cron" EnableOn `b450`
 * OnEnd `G342` -> oütf nova:342 "Area Map - Vell-os", ModType 16 ModVal 2.
 */

class FakeStorage implements DiscoveryStorage {
    private items = new Map<string, string>();
    getItem(key: string) { return this.items.get(key) ?? null; }
    setItem(key: string, value: string) { this.items.set(key, value); }
    removeItem(key: string) { this.items.delete(key); }
}

/** oütf ids of every stock map, with the ModVal each carries. */
const STOCK_MAPS: [string, string, number][] = [
    ['nova:204', "Map; Sol/Kel'ar Iy only", 1],
    ['nova:237', 'Map', 3],
    ['nova:272', "Dr Ralph's Exploration Map", 10],
    ['nova:342', 'Area Map - Vell-os', 2],
    ['nova:433', 'Map; Fed/Pol', 2],
    ['nova:434', 'Map; Reb/Pir/Aur', 3],
];

/** sÿst nova:130 "Kania", the system the visual-comparison pilot starts in. */
const KANIA = 'nova:130';

describe('stock map outfits', () => {
    let universe: MissionUniverse;
    let storage: FakeStorage;

    beforeAll(async () => {
        const gameData = await getIntegrationGameData();
        universe = MissionUniverse.shared(gameData);
        await universe.load();
    });

    beforeEach(() => {
        storage = new FakeStorage();
        setDiscoveryStorageKey('novajs:save');
        resetDiscovery(storage);
    });

    afterEach(() => resetDiscovery(storage));

    it('is exactly the six ModType 16 items the game ships', async () => {
        const gameData = await getIntegrationGameData();
        const ids = (await gameData.ids).Outfit;
        const found: [string, string, number][] = [];
        for (const id of ids) {
            const outfit = await gameData.data.Outfit.get(id);
            if (outfit.map !== null) {
                found.push([id, outfit.name, outfit.map]);
            }
        }
        expect(found).toEqual(STOCK_MAPS);
    });

    it('reveals Kania and its neighbours for a ModVal 1 map', async () => {
        const gameData = await getIntegrationGameData();
        const kania = await gameData.data.System.get(KANIA);
        const revealed = applyMapOutfit(1, KANIA, universe);
        // "1 and up: How many jumps away from present system to explore."
        // Radius 1 is the present system plus everything one jump out.
        expect(revealed.sort())
            .toEqual([KANIA, ...kania.links].sort());
        expect(revealed.length).toBeGreaterThan(1);
    });

    it('reveals strictly more the further the ModVal reaches', () => {
        const one = applyMapOutfit(1, KANIA, universe);
        const two = applyMapOutfit(2, KANIA, universe);
        const three = applyMapOutfit(3, KANIA, universe);
        expect(two.length).toBeGreaterThan(one.length);
        expect(three.length).toBeGreaterThan(two.length);
        // Each radius contains the smaller one.
        expect(one.every(id => two.includes(id))).toBeTrue();
        expect(two.every(id => three.includes(id))).toBeTrue();
    });

    it('maps everything it reaches to "landed", not merely "entered"', () => {
        // The stock dësc promises "the location AND CONTENTS of the systems
        // surrounding this one", so a mapped system knows its services and
        // traded goods — level 2.
        applyMapOutfit(1, KANIA, universe);
        expect(discoveryLevel(KANIA, storage)).toBe(DISCOVERY_LANDED);
    });

    it('never leaves the region reachable by hyperspace', () => {
        // A radius map is a breadth-first walk of real links; a system with
        // no path to Kania can never appear, however large the ModVal.
        const huge = new Set(applyMapOutfit(999, KANIA, universe));
        const all = universe.systemInfos.map(s => s.id);
        expect(huge.size).toBeLessThan(all.length);
        expect(huge.has(KANIA)).toBeTrue();
    });

    it('ModVal -1 reveals inhabited INDEPENDENT systems only', () => {
        const revealed = applyMapOutfit(-1, KANIA, universe);
        expect(revealed.length).toBeGreaterThan(0);
        for (const id of revealed) {
            expect(universe.getSystemInfo(id)?.govt).toBeNull();
        }
        // Kania is Federation space, so a -1 map does not include it.
        expect(revealed).not.toContain(KANIA);
    });

    it('applies the Vell-os Area Map that a set string granted', async () => {
        // What the crön hands the pilot: oütf nova:342, ModVal 2. Held
        // outfits are re-applied on every system entry (starmap_plugin),
        // which is what makes the ability map the area around wherever the
        // pilot arrives.
        const gameData = await getIntegrationGameData();
        const vellos = await gameData.data.Outfit.get('nova:342');
        expect(vellos.map).toBe(2);
        const revealed = applyOwnedMapOutfits(['nova:342'], KANIA, universe,
            () => vellos);
        expect(revealed.sort())
            .toEqual(applyMapOutfit(2, KANIA, universe).sort());
        expect(discoveryLevel(KANIA, storage)).toBe(DISCOVERY_LANDED);
    });

    it('ignores outfits that are not maps', async () => {
        const gameData = await getIntegrationGameData();
        // oütf nova:132 "Shield Capacitor" — no ModType 16 anywhere on it.
        const shield = await gameData.data.Outfit.get('nova:132');
        expect(shield.map).toBeNull();
        expect(applyOwnedMapOutfits(['nova:132'], KANIA, universe,
            () => shield)).toEqual([]);
        expect(discoveryLevel(KANIA, storage)).toBe(DISCOVERY_UNKNOWN);
    });

    it('is the crön that keeps the Vell-os ability supplied', async () => {
        // The whole chain, so a data change that breaks it is caught here
        // rather than as "the ability silently stopped working".
        const gameData = await getIntegrationGameData();
        const ability = await gameData.data.Outfit.get('nova:251');
        expect(ability.name).toBe('Vell-os Area Map');
        expect(ability.onPurchase).toBe('b450');
        const cron = await gameData.data.Cron.get('nova:381');
        expect(cron.name).toBe('Vell-os Area Map cron');
        expect(cron.enableOn).toBe('b450');
        expect(cron.onEnd).toBe('G342');
    });
});
