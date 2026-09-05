import 'jasmine';
import { Gettable } from 'novadatainterface/gettable';
import { NovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import { BatchDataFetcher } from './batch_data_fetcher.js';
import { BatchRequest, BatchResponse } from '../../server/setup_routes.js';

// A fake `fetch` that records each batch request body and answers from
// the provided tables. Records let tests assert how many round trips
// happened and what ids each carried.
function makeFakeFetch(tables: { [type: string]: { [id: string]: unknown } }) {
    const requests: BatchRequest[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as BatchRequest;
        requests.push(body);
        const result: BatchResponse = {};
        for (const [type, ids] of Object.entries(body)) {
            result[type] = {};
            const table = tables[type] ?? {};
            for (const id of ids) {
                if (id in table) {
                    result[type][id] = { data: table[id] };
                } else if (id.startsWith('broken')) {
                    result[type][id] = { error: `failed to load ${type}:${id}` };
                } else {
                    result[type][id] = { error: `missing ${type}:${id}`, notFound: true };
                }
            }
        }
        return {
            ok: true,
            status: 200,
            json: async () => result,
        } as Response;
    }) as unknown as typeof fetch;
    return { fake, requests };
}

describe('BatchDataFetcher', () => {
    it('coalesces N concurrent gets in one tick into a single request', async () => {
        const { fake, requests } = makeFakeFetch({
            Ship: { a: { n: 'a' }, b: { n: 'b' }, c: { n: 'c' } },
        });
        const fetcher = new BatchDataFetcher('', 0, fake);

        const results = await Promise.all([
            fetcher.fetch('Ship', 'a'),
            fetcher.fetch('Ship', 'b'),
            fetcher.fetch('Ship', 'c'),
        ]);

        expect(results).toEqual([{ n: 'a' }, { n: 'b' }, { n: 'c' }]);
        expect(requests.length).toBe(1);
        expect(requests[0]).toEqual({ Ship: ['a', 'b', 'c'] });
    });

    it('coalesces multiple types into a single request', async () => {
        const { fake, requests } = makeFakeFetch({
            Ship: { a: 1 },
            Outfit: { x: 2 },
        });
        const fetcher = new BatchDataFetcher('', 0, fake);

        const [ship, outfit] = await Promise.all([
            fetcher.fetch('Ship', 'a'),
            fetcher.fetch('Outfit', 'x'),
        ]);

        expect(ship).toBe(1);
        expect(outfit).toBe(2);
        expect(requests.length).toBe(1);
        expect(requests[0]).toEqual({ Ship: ['a'], Outfit: ['x'] });
    });

    it('dedups repeated ids within a window into one request entry', async () => {
        const { fake, requests } = makeFakeFetch({ Ship: { a: 'A' } });
        const fetcher = new BatchDataFetcher('', 0, fake);

        const [r1, r2] = await Promise.all([
            fetcher.fetch('Ship', 'a'),
            fetcher.fetch('Ship', 'a'),
        ]);

        expect(r1).toBe('A');
        expect(r2).toBe('A');
        expect(requests.length).toBe(1);
        expect(requests[0].Ship).toEqual(['a']);
    });

    it('rejects only the missing id, not its batch siblings', async () => {
        const { fake } = makeFakeFetch({ Ship: { present: 'P' } });
        const fetcher = new BatchDataFetcher('', 0, fake);

        const present = fetcher.fetch('Ship', 'present');
        const absent = fetcher.fetch('Ship', 'absent');

        await expectAsync(present).toBeResolvedTo('P');
        await expectAsync(absent).toBeRejected();
    });

    it('keeps the server\'s not-found marker as a NovaIDNotFoundError, so a '
        + 'Gettable above it caches the miss instead of re-fetching', async () => {
            const { fake, requests } = makeFakeFetch({ Ship: { present: 'P' } });
            const fetcher = new BatchDataFetcher('', 0, fake);

            await expectAsync(fetcher.fetch('Ship', 'absent'))
                .toBeRejectedWithError(NovaIDNotFoundError, /absent/);
            // A plain per-id failure stays a plain Error (a retry may fix it).
            await expectAsync(fetcher.fetch('Ship', 'broken1'))
                .toBeRejectedWithError(Error, /broken1/);
            expect(await fetcher.fetch('Ship', 'broken1').catch(e => e instanceof NovaIDNotFoundError))
                .toBe(false);

            const gettable = new Gettable<unknown>(id => fetcher.fetch('Ship', id), () => { });
            await expectAsync(gettable.get('absent')).toBeRejectedWithError(NovaIDNotFoundError);
            await expectAsync(gettable.get('absent')).toBeRejectedWithError(NovaIDNotFoundError);
            expect(gettable.getCached('absent')).toBeUndefined();
            await new Promise(resolve => setTimeout(resolve, 0));
            const fetchesOfAbsent = requests
                .filter(r => (r.Ship ?? []).includes('absent')).length;
            expect(fetchesOfAbsent).toBe(2); // the bare fetch, then the Gettable's one
        });

    it('rejects every id when the transport fails', async () => {
        const failing = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
        const fetcher = new BatchDataFetcher('', 0, failing);

        const a = fetcher.fetch('Ship', 'a');
        const b = fetcher.fetch('Ship', 'b');

        await expectAsync(a).toBeRejected();
        await expectAsync(b).toBeRejected();
    });

    it('issues a fresh request for gets in a later tick', async () => {
        const { fake, requests } = makeFakeFetch({ Ship: { a: 1, b: 2 } });
        const fetcher = new BatchDataFetcher('', 0, fake);

        expect(await fetcher.fetch('Ship', 'a')).toBe(1);
        expect(await fetcher.fetch('Ship', 'b')).toBe(2);

        // Two separate awaits => two separate flush windows.
        expect(requests.length).toBe(2);
        expect(requests[0]).toEqual({ Ship: ['a'] });
        expect(requests[1]).toEqual({ Ship: ['b'] });
    });

    describe('under Gettable', () => {
        it('sends one request for N concurrent Gettable gets, and cache hits bypass the network', async () => {
            const { fake, requests } = makeFakeFetch({
                Weapon: { w1: { n: 'w1' }, w2: { n: 'w2' } },
            });
            const fetcher = new BatchDataFetcher('', 0, fake);
            const gettable = new Gettable<unknown>(
                (id: string) => fetcher.fetch('Weapon', id));

            // Concurrent cold gets => one batch.
            await Promise.all([gettable.get('w1'), gettable.get('w2')]);
            expect(requests.length).toBe(1);
            expect(requests[0].Weapon.sort()).toEqual(['w1', 'w2']);

            // Warm cache: no new network activity.
            const cached = await gettable.get('w1');
            expect(cached).toEqual({ n: 'w1' });
            expect(requests.length).toBe(1);
        });

        it('interleaves a cache hit with a cold single into one network request', async () => {
            const { fake, requests } = makeFakeFetch({
                Planet: { p1: 'P1', p2: 'P2' },
            });
            const fetcher = new BatchDataFetcher('', 0, fake);
            const gettable = new Gettable<unknown>(
                (id: string) => fetcher.fetch('Planet', id));

            // Warm p1.
            expect(await gettable.get('p1')).toBe('P1');
            expect(requests.length).toBe(1);

            // p1 (cached) + p2 (cold) requested together: only p2 hits net.
            const [a, b] = await Promise.all([
                gettable.get('p1'),
                gettable.get('p2'),
            ]);
            expect(a).toBe('P1');
            expect(b).toBe('P2');
            expect(requests.length).toBe(2);
            expect(requests[1]).toEqual({ Planet: ['p2'] });
        });
    });
});
