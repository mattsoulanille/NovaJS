import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultRankData } from 'novadatainterface/rank_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { SimulationGameDataResource } from '../core/game_data_resource.js';
import { makeSystem } from '../make_system.js';
import { stellarClearanceFor } from '../travel/planet_plugin.js';

const GATE_GOVT = 'test:hypergate';
const GATE = 'test:gate';
const KEY_RANK = 'test:key';

/**
 * ============================================================================
 * THE RÄNK TABLE IS STAGED BEFORE THE WORLD STEPS
 * ============================================================================
 *
 * The simulation reads ränk privileges synchronously, through `getCached`, in
 * three places: landing clearance (0x0200), applyHail's battle-assistance
 * offer (0x0400) and the NPC dispositions (0x0100). Nothing staged the
 * resources those reads want. The preload bundle carries Outfit, Ship and
 * System; entity staging adds a ship's Govt; and a simulation world runs in
 * its OWN worker — its own server archive, its own node worker — each with
 * its own game-data cache, into which no ränk had ever been fetched.
 *
 * So the reads were not "cold on an unlucky peer": they were cold on every
 * peer, always, and the display world on the main thread (which loads the
 * table for the spaceport dialogs) disagreed with all of them. The stock
 * hypergate network, whose ONLY key is ränk nova:147's 0x0200, could never
 * be opened by the code that decides landings.
 *
 * makeSystem now stages the whole table beside the govts, for the same
 * reason: it is tiny, and every peer builds every world through here.
 */
describe('makeSystem stages the ränk table', () => {
    async function gateWorld() {
        const gameData = new MockGameData();
        gameData.data.Ship.map.set('test:ship', {
            ...getDefaultShipData(), id: 'test:ship',
        });
        gameData.data.Govt.map.set(GATE_GOVT, {
            ...getDefaultGovtData(), id: GATE_GOVT,
        });
        // A stock hypergate in miniature: MinStatus 32767, "player can
        // never land", owned by the gate government.
        gameData.data.Planet.map.set(GATE, {
            ...getDefaultPlanetData(), id: GATE, govt: GATE_GOVT,
            minStatus: 32767,
        });
        // ... and the ränk that is the only way in (0x0200).
        const key = getDefaultRankData();
        gameData.data.Rank.map.set(KEY_RANK, {
            ...key, id: KEY_RANK, affilGovt: GATE_GOVT, flags: 0x0200,
            rankFlags: {
                ...key.rankFlags, canAlwaysLandOnGovtStellars: true,
            },
        });
        gameData.data.System.map.set('test:system', {
            ...getDefaultSystemData(), id: 'test:system', planets: [GATE],
        });
        const world = await makeSystem('test:system', gameData, undefined,
            { npcs: false });
        return { world, gameData };
    }

    it('leaves every ränk resource warm in the cache the simulation reads',
        async () => {
            const { world } = await gateWorld();
            // Read back through the world's OWN resource handle, which is
            // the one every simulation system reaches for.
            const simData = world.resources.get(SimulationGameDataResource)!;
            expect(simData.data.Rank.getCached(KEY_RANK)).toBeDefined();
            expect(simData.data.Rank.getCached(KEY_RANK)!.affilGovt)
                .toBe(GATE_GOVT);
        });

    it('so the 0x0200 landing override actually opens a gate the '
        + 'simulation would otherwise keep shut', async () => {
            const { world, gameData } = await gateWorld();
            const simData = world.resources.get(SimulationGameDataResource)!;
            const clearance = (ranks: Set<string>) => stellarClearanceFor({
                planetData: gameData.data.Planet.map.get(GATE)!,
                gameData: simData,
                govts: undefined,
                ranks,
                planetId: GATE,
                now: 0,
            });
            // MinStatus 32767 is "player can never land".
            expect(clearance(new Set()).cleared).toBeFalse();
            // Holding the rank opens it — which only works because the
            // resource is in the cache this synchronous read consults.
            expect(clearance(new Set([KEY_RANK])).cleared).toBeTrue();
        });
});
