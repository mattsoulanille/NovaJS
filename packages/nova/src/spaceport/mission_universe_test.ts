import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultMissionData } from 'novadatainterface/mission_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { MissionOffer } from '../nova_plugin/missions/index.js';
import { offerSubstitutions } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';

describe('MissionUniverse name lookups', () => {
    it('hides the "; comment" authoring suffix on stellar and system names '
        + '(a mission read "Sol;GM" where the original shows "Sol")',
        async () => {
            const gameData = new MockGameData();
            gameData.data.Planet.map.set('nova:128', {
                ...getDefaultPlanetData(), id: 'nova:128', name: 'Earth;GM',
            });
            gameData.data.System.map.set('nova:128', {
                ...getDefaultSystemData(), id: 'nova:128', name: 'Sol;GM',
                planets: ['nova:128'],
            });
            const universe = new MissionUniverse(gameData);
            await universe.load();

            expect(universe.planetName('nova:128')).toBe('Earth');
            expect(universe.systemNameOfPlanet('nova:128', new Set()))
                .toBe('Sol');
            // Unknown ids still fall back to the id itself.
            expect(universe.planetName('nova:999')).toBe('nova:999');
        });
});

describe('MissionUniverse.systemIdOfPlanet across stacked duplicate systems', () => {
    async function universe() {
        const gameData = new MockGameData();
        gameData.data.Planet.map.set('nova:333', {
            ...getDefaultPlanetData(), id: 'nova:333', name: 'Auroran LP I',
        });
        // SPC-1421 twice: nova:308 while !b995, nova:765 once b995 is set.
        gameData.data.System.map.set('nova:308', {
            ...getDefaultSystemData(), id: 'nova:308', name: 'SPC-1421',
            planets: ['nova:333'], visibility: '!b995', position: [10, 20],
        });
        gameData.data.System.map.set('nova:765', {
            ...getDefaultSystemData(), id: 'nova:765', name: 'SPC-1421',
            planets: ['nova:333'], visibility: 'b995', position: [10, 20],
        });
        const u = new MissionUniverse(gameData);
        await u.load();
        return u;
    }

    it('resolves the return stellar to the copy the player can SEE '
        + '(the Moash fleet spawned in the invisible nova:765)', async () => {
            const u = await universe();
            expect(u.systemIdOfPlanet('nova:333', new Set())).toBe('nova:308');
            expect(u.systemIdOfPlanet('nova:333', new Set([995])))
                .toBe('nova:765');
        });

    it('picks deterministically for an empty bit set (bits are required: '
        + '#325), and treats the two copies as the same system', async () => {
            const u = await universe();
            expect(u.systemIdOfPlanet('nova:333', new Set())).toBe('nova:308');
            expect(u.sameSystem('nova:308', 'nova:765')).toBeTrue();
            expect(u.sameSystem('nova:308', 'nova:128')).toBeFalse();
        });
});

/**
 * #325 and Matthew's ruling on it: "If it's something specific to the
 * player, it should probably consider what systems are active for them."
 * A stellar stacked in NCB-duplicate systems is NAMED by the copy active
 * for the player, as it is resolved (systemIdOfPlanet): a plug-in that
 * renames its story copy prints the post-story name in <DSY>/<RSY> once
 * the story bit is set. `systemNameOfPlanet` used to name the id-sorted
 * first claimant whatever the bits.
 */
describe('MissionUniverse.systemNameOfPlanet across stacked duplicate systems',
    () => {
        async function universe() {
            const gameData = new MockGameData();
            gameData.data.Planet.map.set('nova:333', {
                ...getDefaultPlanetData(), id: 'nova:333', name: 'Auroran LP I',
            });
            gameData.data.System.map.set('nova:308', {
                ...getDefaultSystemData(), id: 'nova:308', name: 'SPC-1421',
                planets: ['nova:333'], visibility: '!b995', position: [10, 20],
            });
            // The story copy, renamed by its plug-in.
            gameData.data.System.map.set('nova:765', {
                ...getDefaultSystemData(), id: 'nova:765', name: 'Moash Reach',
                planets: ['nova:333'], visibility: 'b995', position: [10, 20],
            });
            const u = new MissionUniverse(gameData);
            await u.load();
            return u;
        }

        it('names the copy the player can see', async () => {
            const u = await universe();
            expect(u.systemNameOfPlanet('nova:333', new Set()))
                .toBe('SPC-1421');
            expect(u.systemNameOfPlanet('nova:333', new Set([995])))
                .toBe('Moash Reach');
        });

        it('fills <DSY>/<RSY> from the player\'s copy', async () => {
            const u = await universe();
            const offer: MissionOffer = {
                data: getDefaultMissionData(), travelPlanet: 'nova:333',
                returnPlanet: 'nova:333', cargoType: -1, cargoQty: 0,
                acceptable: true,
            };
            const subs = offerSubstitutions(u, 0, offer, new Set([995]));
            expect(subs.destinationSystem).toBe('Moash Reach');
            expect(subs.returnSystem).toBe('Moash Reach');
        });
    });

/**
 * Review finding #66: `load()` memoised its promise with `??=`, so ONE
 * rejected resource fetch (a 502 / timeout / ERR_INSUFFICIENT_RESOURCES
 * during the first landing's fetch storm) left every later landing, BBS,
 * bar, mission-info and starmap open failing with the same stale error
 * until the page was reloaded.
 *
 * Since #130 one rejected RESOURCE no longer fails the load at all: it is
 * skipped and logged, and the load resolves with everything else (see
 * venue_warmup_skip_test.ts). The #66 backoff now governs retrying that
 * partial load, and a load whose id lists themselves fail.
 */
describe('MissionUniverse.load after a failed fetch', () => {
    /** Planet nova:128 ("Earth"), whose first `failures` gets fail. */
    function flakyGameData(failures: number) {
        const gameData = new MockGameData();
        gameData.data.Planet.map.set('nova:128', {
            ...getDefaultPlanetData(), id: 'nova:128', name: 'Earth',
        });
        const realGet = gameData.data.Planet.get.bind(gameData.data.Planet);
        const counter = { calls: 0 };
        gameData.data.Planet.get = async (id: string) => {
            if (counter.calls++ < failures) {
                throw new Error(`${id}: HTTP 502`);
            }
            return realGet(id);
        };
        return { gameData, counter };
    }

    /** A turn of the timer queue, so a zero backoff has elapsed. */
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    it('loads without a resource that failed, retries it once the backoff '
        + 'has elapsed, and then stays loaded', async () => {
            const universe = new MissionUniverse(flakyGameData(1).gameData);
            universe.retryBackoffMs = 0;
            const warn = spyOn(console, 'warn');
            await expectAsync(universe.load()).toBeResolved();
            expect(warn).toHaveBeenCalled();
            // Skipped for now: the name falls back to the id.
            expect(universe.planetName('nova:128')).toBe('nova:128');
            await tick();
            await expectAsync(universe.load()).toBeResolved();
            expect(universe.planetName('nova:128')).toBe('Earth');
            // Success is memoised as before: the same promise, no refetch.
            const loaded = universe.load();
            expect(universe.load()).toBe(loaded);
        });

    it('keeps a partial load for the backoff window so a burst of callers '
        + 'during an outage shares one attempt', async () => {
            const { gameData, counter } = flakyGameData(2);
            const universe = new MissionUniverse(gameData);
            // A long backoff: within it, load() must not start another
            // fetch storm.
            universe.retryBackoffMs = 60_000;
            spyOn(console, 'warn');
            const first = universe.load();
            await expectAsync(first).toBeResolved();
            // Same attempt handed back, not a new one.
            expect(universe.load()).toBe(first);
            expect(counter.calls).toBe(1);
        });

    it('retries a load whose id lists failed once the backoff has elapsed',
        async () => {
            const gameData = new MockGameData();
            gameData.data.Planet.map.set('nova:128', {
                ...getDefaultPlanetData(), id: 'nova:128', name: 'Earth',
            });
            const realIds = gameData.ids;
            let idsReads = 0;
            Object.defineProperty(gameData, 'ids', {
                get: () => idsReads++ === 0
                    ? Promise.reject(new Error('ids: HTTP 502')) : realIds,
            });
            const universe = new MissionUniverse(gameData);
            universe.retryBackoffMs = 0;
            const warn = spyOn(console, 'warn');
            const first = universe.load();
            await expectAsync(first).toBeRejectedWithError(/502/);
            expect(warn).toHaveBeenCalled();
            await tick();
            await expectAsync(universe.load()).toBeResolved();
            expect(universe.planetName('nova:128')).toBe('Earth');
        });
});
