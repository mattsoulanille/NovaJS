import 'jasmine';
import express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { PlanetData } from 'novadatainterface/planet_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { diffWorldHashes, hashWorld } from 'nova_ecs/plugins/world_hash';
import {
    cachedSeedData, SimulationGameData,
} from '../client/gamedata/simulation_game_data.js';
import { meterRoundTrips } from '../client/gamedata/round_trip_meter.js';
import { fetchSystemResources } from '../client/next_hop_prefetch.js';
import {
    getSyntheticGameData, makeSyntheticGameData,
} from '../communication/simulation_test_fixture.js';
import { SystemResourceList } from '../common/system_resources.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { serveInProcess } from '../test_support/serve_game_data_in_process.js';
import { setupRoutes } from './setup_routes.js';
import { computeSystemResources, SystemResourceCache } from './system_resources.js';

/**
 * #370: a system's resource list is what its genesis stages (recorded
 * from makeSystem itself) plus the art and sound its display draws, and
 * a sim worker seeded with that data builds the system without fetching
 * any of it — the one-jump-ahead prefetch's whole point — and builds it
 * exactly as a cold one does.
 */
describe('system resource lists (#370)', () => {
    const lists = new Map<string, Promise<SystemResourceList>>();
    async function listOf(systemId: string) {
        let list = lists.get(systemId);
        if (!list) {
            list = getSyntheticGameData().then(gameData =>
                computeSystemResources(gameData, systemId));
            lists.set(systemId, list);
        }
        return list;
    }

    it('lists the stellars, the spawnable ships and their closures', async () => {
        const gameData = await getSyntheticGameData();
        const list = await listOf(SYNTHETIC.systems.thessaly);
        const system = await gameData.data.System.get(SYNTHETIC.systems.thessaly);
        expect(list.data.System).toContain(SYNTHETIC.systems.thessaly);
        for (const link of system.links) {
            expect(list.data.System).toContain(link);
        }
        for (const planet of system.planets) {
            expect(list.data.Planet).toContain(planet);
        }
        // Every gövt and ränk (genesis stages the whole tables).
        expect(list.data.Govt).toEqual([...(await gameData.ids).Govt].sort());
        expect(list.data.Rank).toEqual([...(await gameData.ids).Rank].sort());
        // Every ship class a düde here can spawn, with its outfits and
        // weapons and the weapons' sprite sheets.
        for (const { id } of system.dudes) {
            const dude = await gameData.data.Dude.get(id);
            for (const ship of dude.ships) {
                expect(list.data.Ship).withContext(ship.id).toContain(ship.id);
                const shipData = await gameData.data.Ship.get(ship.id);
                expect(list.data.SpriteSheet)
                    .toContain(shipData.animation.images.baseImage.id);
                for (const outfit of Object.keys(shipData.outfits)) {
                    expect(list.data.Outfit).toContain(outfit);
                }
            }
        }
        // Sorted, so the list is the same whatever order genesis ran in.
        for (const ids of Object.values(list.data)) {
            expect(ids).toEqual([...ids!].sort());
        }
    });

    it('lists the asteroid types and their fragments where there are rocks', async () => {
        const gameData = await getSyntheticGameData();
        const ossory = await listOf(SYNTHETIC.systems.ossory);
        expect(ossory.data.Asteroid).toContain(SYNTHETIC.asteroid);
        const rock = await gameData.data.Asteroid.get(SYNTHETIC.asteroid);
        for (const fragment of rock.fragments) {
            expect(ossory.data.Asteroid).toContain(fragment);
        }
        expect(ossory.assets.SpriteSheet)
            .toContain(rock.animation.images.baseImage.id);
        const thessaly = await listOf(SYNTHETIC.systems.thessaly);
        expect(thessaly.data.Asteroid ?? []).not.toContain(SYNTHETIC.asteroid);
    });

    it('derives the assets: stellar sheets first, shots, bööms, snds, landing art', async () => {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const list = await listOf(SYNTHETIC.systems.thessaly);
        const system = await gameData.data.System.get(SYNTHETIC.systems.thessaly);
        const planets: PlanetData[] = await Promise.all(system.planets.map(
            id => gameData.data.Planet.get(id)));
        const planetSheets = [...new Set(planets.flatMap(planet =>
            Object.values(planet.animation.images).map(image => image!.id)))];
        expect(list.assets.SpriteSheet.slice(0, planetSheets.length))
            .toEqual(planetSheets);
        // Only ids the data set has.
        for (const id of list.assets.SpriteSheet) {
            expect(ids.SpriteSheetFrames).withContext(id).toContain(id);
        }
        for (const id of list.assets.Sound) {
            expect(ids.SoundFile).withContext(id).toContain(id);
        }
        for (const id of list.assets.Explosion) {
            expect(ids.Explosion).withContext(id).toContain(id);
        }
        // Every weapon that has a sound and can fire here has its sound.
        for (const id of list.data.Weapon ?? []) {
            const weapon = await gameData.data.Weapon.get(id);
            if (weapon.sound && ids.SoundFile.includes(weapon.sound)) {
                expect(list.assets.Sound).toContain(weapon.sound);
            }
        }
        // Landing art only for the stellars one can land on.
        const landable = planets.filter(planet =>
            planet.flags.canLand && planet.gate === null);
        expect(landable.length).toBeGreaterThan(0);
        expect(list.assets.Pict).toEqual(jasmine.arrayContaining(
            landable.map(planet => planet.landingPict)
                .filter(id => ids.PictImage.includes(id))));
        for (const pict of list.assets.Pict) {
            expect(landable.some(planet => planet.landingPict === pict
                || planet.barPict === pict)).withContext(pict).toBeTrue();
        }
    });

    for (const [name, systemId] of Object.entries(SYNTHETIC.systems)) {
        it(`seeds a sim worker's cache so ${name} builds with no data requests`,
            async () => {
                const served = serveInProcess(await getSyntheticGameData());
                const list = await fetchSystemResources('', served)(systemId);
                // The main thread, warmed from the list as the prefetch
                // warms it.
                const main = new SimulationGameData('', served);
                await Promise.all(Object.entries(list.data).flatMap(
                    ([type, ids]) => ids!.map(id => (main.data[
                        type as keyof typeof main.data].get(id) as Promise<unknown>)
                        .catch(() => undefined))));
                // (Its serializer world has read the control bindings.)
                await main.getSettings('controls.json');
                // A fresh worker cache, seeded from it.
                const meter = meterRoundTrips(served);
                const worker = new SimulationGameData('', meter.fetch, {
                    seed: { ids: await main.ids, settings: main.settingsRead,
                        data: cachedSeedData(main, list.data) },
                });
                await worker.loaded;
                meter.reset();

                await makeSystem(systemId, worker, 'worker');

                expect(meter.stats.batches)
                    .withContext(JSON.stringify(meter.stats)).toBe(0);
                expect(meter.stats.requests)
                    .withContext(JSON.stringify(meter.stats)).toBe(0);
            });
    }

    for (const [name, systemId] of Object.entries(SYNTHETIC.systems)) {
        it(`builds ${name} the same over a seeded cache as over a cold one`,
            async () => {
                const served = serveInProcess(makeSyntheticGameData());
                const list = await fetchSystemResources('', served)(systemId);
                const cold = new SimulationGameData('', served);
                await cold.loaded;
                const coldWorld = await makeSystem(systemId, cold, 'worker');
                // Seeded from the cold world's own (now warm) cache.
                const seeded = new SimulationGameData('', served, {
                    seed: { ids: await cold.ids,
                        data: cachedSeedData(cold, list.data) },
                });
                await seeded.loaded;
                const seededWorld = await makeSystem(systemId, seeded, 'worker');

                for (let tick = 0; tick <= 300; tick++) {
                    if (tick % 100 === 0) {
                        const a = hashWorld(coldWorld);
                        const b = hashWorld(seededWorld);
                        expect(diffWorldHashes(a, b))
                            .withContext(`tick ${tick}`).toEqual([]);
                        expect(b.hash).withContext(`tick ${tick}`).toBe(a.hash);
                    }
                    coldWorld.step();
                    seededWorld.step();
                }
            });
    }

    it('computes each system once and retries a failure', async () => {
        const gameData = await getSyntheticGameData();
        let calls = 0;
        let fail = true;
        const cache = new SystemResourceCache(gameData, async (data, id) => {
            calls++;
            if (fail) {
                fail = false;
                throw new Error('boom');
            }
            return computeSystemResources(data, id);
        });
        await expectAsync(cache.get(SYNTHETIC.systems.vael)).toBeRejected();
        const first = await cache.get(SYNTHETIC.systems.vael);
        const second = await cache.get(SYNTHETIC.systems.vael);
        expect(second).toBe(first);
        expect(calls).toBe(2);
        expect(await cache.has(SYNTHETIC.systems.vael)).toBeTrue();
        expect(await cache.has('nova:9999')).toBeFalse();
    });
});

describe('system resources route (#370)', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const app = express();
        setupRoutes(await getSyntheticGameData(), app,
            '/nonexistent/html', '/nonexistent/bundle',
            '/nonexistent/bundle.map', '/nonexistent/worker',
            '/nonexistent/worker.map', '/nonexistent/settings',
            { wireSendPolicy: 'strict' });
        server = await new Promise<http.Server>(resolve => {
            const s = app.listen(0, () => resolve(s));
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close(err => err ? reject(err) : resolve()));
    });

    it('serves a system\'s list, as the client fetches it', async () => {
        const list = await fetchSystemResources(baseUrl)(
            SYNTHETIC.systems.kestrel);
        expect(list.systemId).toBe(SYNTHETIC.systems.kestrel);
        expect(list.data.System).toContain(SYNTHETIC.systems.kestrel);
    });

    it('404s an id that names no system', async () => {
        const resp = await fetch(`${baseUrl}/gameData/systemResources/nova%3A9999.json`);
        expect(resp.status).toBe(404);
    });
});
