import 'jasmine';
import fs from 'fs';
import path from 'path';
import { GameDataInterface } from 'novadatainterface/game_data_interface';
import { getDefaultMissionData } from 'novadatainterface/mission_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    batchPath, controlBitNamespacesPath, idsPath, settingsPrefix,
} from '../../common/game_data_paths.js';
import { diffWorldHashes, hashWorld } from 'nova_ecs/plugins/world_hash';
import {
    getSyntheticGameData, makeSyntheticGameData, SYNTHETIC_DATA_ROOT,
} from '../../communication/simulation_test_fixture.js';
import { makeSystem } from '../../nova_plugin/make_system.js';
import { BatchRequest, resolveBatch } from '../../server/setup_routes.js';
import { MissionUniverse } from '../../spaceport/mission_universe.js';
import { meterRoundTrips } from './round_trip_meter.js';
import { SimulationGameData } from './simulation_game_data.js';

/**
 * A `fetch` that answers the game-data routes a SimulationGameData asks
 * for straight from `gameData`, the way the server's routes would.
 */
function serveInProcess(gameData: GameDataInterface): typeof fetch {
    const json = (value: unknown) => new Response(JSON.stringify(value),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    return (async (input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]) => {
        const url = String(input);
        if (url === batchPath) {
            return json(await resolveBatch(gameData,
                JSON.parse(String(init?.body)) as BatchRequest));
        }
        if (url === idsPath + '.json') {
            return json(await gameData.ids);
        }
        if (url === '/preloadData.json') {
            return json(await gameData.preloadData ?? {});
        }
        if (url.startsWith(settingsPrefix)) {
            // packages/nova/settings, beside test_fixtures/.
            return json(JSON.parse(fs.readFileSync(path.join(SYNTHETIC_DATA_ROOT,
                '..', '..', 'settings', url.slice(settingsPrefix.length)), 'utf8')));
        }
        if (url === controlBitNamespacesPath + '.json'
            && gameData.controlBitNamespaces) {
            return json(await gameData.controlBitNamespaces);
        }
        return new Response('not found', { status: 404 });
    }) as typeof fetch;
}

/**
 * Issue #368: entering a system on the deployed server (~100 ms round
 * trip) took about a minute, because building the system's genesis
 * fetched its game data one dependency at a time — hundreds of
 * sequential batch round trips. Every world that simulates the system
 * (the main thread's serializer world, the sim worker's world, each
 * with a cold or near-cold cache) pays the depth of makeSystem's
 * staging, so that depth is pinned here: it must stay a handful of
 * dependency levels, not grow with the number of fleets, persons,
 * ships and weapons the system can spawn.
 */
describe('system entry round trips (#368)', () => {
    // Levels makeSystem genuinely needs on a cold cache: the sÿst (and
    // the id lists), then its stellars/düdes/flëts/govts/përs, their
    // ships, the ships' outfits and sprite sheets, the outfits' wëaps,
    // the wëaps' sprite sheets / submunitions / bay fighters, and the
    // fighters' own closure: 4-5 on the synthetic set (6 on stock
    // data). Before the fix, awaiting one load at a time, it was 20-23
    // here (and 345-480 on stock data).
    const MAX_DEPTH = 8;

    for (const [name, systemId] of Object.entries(SYNTHETIC.systems)) {
        it(`builds ${name} (${systemId}) in at most ${MAX_DEPTH} sequential round trips`,
            async () => {
                const meter = meterRoundTrips(
                    serveInProcess(await getSyntheticGameData()), 1);
                // A cold cache, as the sim worker has on every entry.
                const gameData = new SimulationGameData('', meter.fetch);
                await gameData.loaded;
                await gameData.ids;
                meter.reset();

                await makeSystem(systemId, gameData, 'worker');

                expect(meter.stats.depth)
                    .withContext(JSON.stringify(meter.stats))
                    .toBeLessThanOrEqual(MAX_DEPTH);
            });
    }
});

/**
 * The staging that #368 made concurrent completes in whatever order the
 * network answers, and that order must not reach the simulation. Each
 * synthetic system is built twice — straight off an in-process data set,
 * and over the batched client path with every response held a
 * different, scrambled time, so the loads land in an order of their
 * own — then both worlds step; their hashes must agree throughout.
 */
describe('system entry staging order (#368)', () => {
    /** Holds each response 0-7 ms, in a fixed scrambled sequence. */
    function scrambled(inner: typeof fetch): typeof fetch {
        let state = 0x2545f491;
        return (async (input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1]) => {
            state = (Math.imul(state, 1103515245) + 12345) >>> 0;
            const hold = (state >>> 16) % 8;
            const response = await inner(input, init);
            await new Promise(resolve => setTimeout(resolve, hold));
            return response;
        }) as typeof fetch;
    }

    for (const [name, systemId] of Object.entries(SYNTHETIC.systems)) {
        it(`builds ${name} (${systemId}) the same whatever order its data lands in`,
            async () => {
                const direct = await makeSystem(systemId,
                    makeSyntheticGameData(), 'worker');
                const client = new SimulationGameData('',
                    scrambled(serveInProcess(makeSyntheticGameData())));
                await client.loaded;
                const viaClient = await makeSystem(systemId, client, 'worker');

                for (let tick = 0; tick <= 300; tick++) {
                    if (tick % 100 === 0) {
                        const a = hashWorld(direct);
                        const b = hashWorld(viaClient);
                        expect(diffWorldHashes(a, b))
                            .withContext(`tick ${tick}`).toEqual([]);
                        expect(b.hash).withContext(`tick ${tick}`).toBe(a.hash);
                    }
                    direct.step();
                    viaClient.step();
                }
            });
    }
});

/**
 * The other half of #368: the system entry awaits the mission universe
 * (prepareMissionShips), and the universe loaded every mïsn / spöb /
 * sÿst / gövt / crön / ränk through a 12-wide pool — ids/12 sequential
 * round trips, about a hundred on stock data — although the batch
 * fetcher already coalesces every get issued in one tick into one POST.
 */
describe('mission universe round trips (#368)', () => {
    it('loads a few hundred missions in a handful of round trips', async () => {
        const source = new MockGameData();
        for (let i = 0; i < 300; i++) {
            const id = `nova:${1000 + i}`;
            source.data.Mission.map.set(id, { ...getDefaultMissionData(), id });
        }
        const meter = meterRoundTrips(serveInProcess(source), 1);
        const gameData = new SimulationGameData('', meter.fetch);
        await gameData.loaded;
        await gameData.ids;
        meter.reset();

        await new MissionUniverse(gameData).load();

        // The batch, then the cargo-name chär read after it.
        expect(meter.stats.depth)
            .withContext(JSON.stringify(meter.stats))
            .toBeLessThanOrEqual(3);
    });
});
