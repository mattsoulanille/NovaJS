import 'jasmine';
import { BatchRequest, BatchResponse } from '../../server/setup_routes.js';
import { SimulationGameData } from './simulation_game_data.js';

/**
 * A fake fetch whose /preloadData.json answer is held until the spec
 * releases it, so a spec can order "staging loads an id" before "the
 * preload bundle lands" — the order CPU load produces in a browser.
 */
function makeFetch(preload: object, tables: { [type: string]: { [id: string]: unknown } }) {
    let releasePreload!: () => void;
    const preloadGate = new Promise<void>(resolve => releasePreload = resolve);
    const fake = (async (url: string, init?: RequestInit) => {
        const respond = (body: unknown) => ({
            ok: true, status: 200, json: async () => body,
        } as Response);
        if (String(url).endsWith('/preloadData.json')) {
            await preloadGate;
            return respond(preload);
        }
        if (init?.method === 'POST') {
            const request = JSON.parse(String(init.body)) as BatchRequest;
            const result: BatchResponse = {};
            for (const [type, ids] of Object.entries(request)) {
                result[type] = {};
                for (const id of ids) {
                    result[type][id] = id in (tables[type] ?? {})
                        ? { data: tables[type][id] }
                        : { error: `missing ${type}:${id}`, notFound: true };
                }
            }
            return respond(result);
        }
        // ids / control-bit routes: not under test.
        return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    return { fake, releasePreload };
}

describe('SimulationGameData preload', () => {
    it('keeps ids staged before the preload bundle lands', async () => {
        // Synthetic built-in ammo outfits are not in the preload bundle.
        // When the bundle arrived after makeSystem staged one, the bundle
        // REPLACED the cache, a later getCached missed, and that peer's
        // NPCs fired a tick late: a desync only the slow peer had.
        const staged = { id: 'nova:161:builtInAmmo', name: 'staged' };
        const bundled = { id: 'nova:128', name: 'bundled' };
        const { fake, releasePreload } = makeFetch(
            { Outfit: { 'nova:128': bundled } },
            { Outfit: { 'nova:161:builtInAmmo': staged } });
        const gameData = new SimulationGameData('', fake);
        gameData.ids.catch(() => { });
        gameData.controlBitNamespaces.catch(() => { });

        expect(await gameData.data.Outfit.get('nova:161:builtInAmmo'))
            .toEqual(staged as never);

        releasePreload();
        await gameData.loaded;

        expect(gameData.data.Outfit.getCached('nova:161:builtInAmmo'))
            .toEqual(staged as never);
        expect(gameData.data.Outfit.getCached('nova:128'))
            .toEqual(bundled as never);
    });
});
