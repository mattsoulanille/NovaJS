import 'jasmine';
import express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { Gettable } from 'novadatainterface/gettable';
import { GameDataInterface } from 'novadatainterface/game_data_interface';
import { NovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import { resolveBatch, BatchResponse, setupRoutes, isValidResourceId } from './setup_routes.js';

// A minimal GameDataInterface whose gettables are backed by the maps
// passed in. A `null` value for an id means "throw when fetched"; an id
// absent from the table rejects with NovaIDNotFoundError, as the
// aggregator does for an id no data source defines.
function makeGameData(tables: {
    [dataType: string]: { [id: string]: unknown | null };
}): GameDataInterface {
    const data: Record<string, Gettable<unknown>> = {};
    for (const [type, entries] of Object.entries(tables)) {
        data[type] = new Gettable<unknown>(async (id: string) => {
            if (!(id in entries)) {
                throw new NovaIDNotFoundError(`No ${type} with id ${id}`);
            }
            const val = entries[id];
            if (val === null) {
                throw new Error(`Boom loading ${type}:${id}`);
            }
            return val;
        });
    }
    return {
        data: data as unknown as GameDataInterface['data'],
        ids: Promise.resolve({} as GameDataInterface['ids'] extends Promise<infer I> ? I : never),
    } as GameDataInterface;
}

function entry(resp: BatchResponse, type: string, id: string) {
    return resp[type][id];
}

describe('isValidResourceId', () => {
    it('admits real namespaced and built-in ids', () => {
        for (const id of [
            'nova:128', 'cargo:3', 'nova:8500',
            'Starbridge Bay:500', 'Star Wars Mod:1000',
            'extra-outfits:200', 'HypergatePassv1.0:128',
            'planetNeutral', 'targetDisabled', 'civilian', 'planetCorners',
        ]) {
            expect(isValidResourceId(id)).withContext(id).toBe(true);
        }
    });

    it('rejects traversal ids and path separators', () => {
        // Express percent-decodes %2F to '/' before the handler sees the
        // param, so the predicate only ever meets the decoded (slash) form.
        for (const id of [
            '../../package', '../../../etc/passwd', '..',
            'a/b', 'a\\b', '/etc/passwd', 'x\0y', '',
        ]) {
            expect(isValidResourceId(id)).withContext(JSON.stringify(id)).toBe(false);
        }
    });

    it('rejects non-string inputs', () => {
        for (const id of [undefined, null, 42, {}, []]) {
            expect(isValidResourceId(id)).toBe(false);
        }
    });
});

describe('resolveBatch', () => {
    it('resolves multiple ids across multiple types in one call', async () => {
        const gameData = makeGameData({
            Ship: { 'a': { name: 'ShipA' }, 'b': { name: 'ShipB' } },
            Outfit: { 'x': { name: 'OutfitX' } },
        });

        const resp = await resolveBatch(gameData, {
            Ship: ['a', 'b'],
            Outfit: ['x'],
        });

        expect(entry(resp, 'Ship', 'a')).toEqual({ data: { name: 'ShipA' } });
        expect(entry(resp, 'Ship', 'b')).toEqual({ data: { name: 'ShipB' } });
        expect(entry(resp, 'Outfit', 'x')).toEqual({ data: { name: 'OutfitX' } });
    });

    it('reports a missing id as an error without failing the batch', async () => {
        const gameData = makeGameData({
            Ship: { 'present': { name: 'Here' } },
        });

        const resp = await resolveBatch(gameData, {
            Ship: ['present', 'absent'],
        });

        expect(entry(resp, 'Ship', 'present')).toEqual({ data: { name: 'Here' } });
        const absent = entry(resp, 'Ship', 'absent');
        expect('error' in absent).toBe(true);
        if ('error' in absent) {
            expect(absent.error).toContain('absent');
            // The per-id 404: lets the client cache the miss.
            expect(absent.notFound).toBe(true);
        }
    });

    it('does not mark a per-id load failure as not-found', async () => {
        const gameData = makeGameData({ Ship: { 'boom': null } });
        const resp = await resolveBatch(gameData, { Ship: ['boom'] });
        const boom = entry(resp, 'Ship', 'boom');
        expect('error' in boom && boom.notFound).toBeUndefined();
    });

    it('reports a per-id load failure as an error without failing siblings', async () => {
        const gameData = makeGameData({
            Ship: { 'ok': { name: 'Ok' }, 'boom': null },
        });

        const resp = await resolveBatch(gameData, {
            Ship: ['ok', 'boom'],
        });

        expect(entry(resp, 'Ship', 'ok')).toEqual({ data: { name: 'Ok' } });
        const boom = entry(resp, 'Ship', 'boom');
        expect('error' in boom).toBe(true);
    });

    it('marks every id of an unknown data type as an error', async () => {
        const gameData = makeGameData({ Ship: { 'a': {} } });

        const resp = await resolveBatch(gameData, {
            Nonsense: ['one', 'two'],
        });

        for (const id of ['one', 'two']) {
            const e = entry(resp, 'Nonsense', id);
            expect('error' in e).toBe(true);
            if ('error' in e) {
                expect(e.error).toContain('Unknown data type');
            }
        }
    });

    it('rejects binary (ArrayBuffer) results as errors', async () => {
        const gameData = makeGameData({
            SpriteSheetImage: { 'img': new ArrayBuffer(8) },
        });

        const resp = await resolveBatch(gameData, {
            SpriteSheetImage: ['img'],
        });

        const e = entry(resp, 'SpriteSheetImage', 'img');
        expect('error' in e).toBe(true);
        if ('error' in e) {
            expect(e.error).toContain('Binary');
        }
    });

    it('handles an empty id list for a type', async () => {
        const gameData = makeGameData({ Ship: { 'a': {} } });
        const resp = await resolveBatch(gameData, { Ship: [] });
        expect(resp.Ship).toEqual({});
    });

    it('isolates errors between types in the same batch', async () => {
        const gameData = makeGameData({
            Ship: { 'good': { ok: true } },
            Outfit: {},
        });

        const resp = await resolveBatch(gameData, {
            Ship: ['good'],
            Outfit: ['missing'],
            Bogus: ['z'],
        });

        expect(entry(resp, 'Ship', 'good')).toEqual({ data: { ok: true } });
        expect('error' in entry(resp, 'Outfit', 'missing')).toBe(true);
        expect('error' in entry(resp, 'Bogus', 'z')).toBe(true);
    });

    it('rejects a traversal id as a per-id error without touching the filesystem', async () => {
        // A null value means "throw if fetched", so a per-id error entry
        // whose message is our validation message (not the gettable's
        // throw) proves the id never reached the data layer.
        const gameData = makeGameData({
            Ship: { 'present': { name: 'Here' } },
        });

        const resp = await resolveBatch(gameData, {
            Ship: ['present', '../../package'],
        });

        expect(entry(resp, 'Ship', 'present')).toEqual({ data: { name: 'Here' } });
        const bad = entry(resp, 'Ship', '../../package');
        expect('error' in bad).toBe(true);
        if ('error' in bad) {
            expect(bad.error).toContain('Invalid id');
        }
    });

    it('reports inherited object keys (constructor) as unknown types', async () => {
        const gameData = makeGameData({ Ship: { 'a': {} } });

        const resp = await resolveBatch(gameData, {
            constructor: ['x'],
        });

        const e = entry(resp, 'constructor', 'x');
        expect('error' in e).toBe(true);
        if ('error' in e) {
            expect(e.error).toContain('Unknown data type');
        }
    });
});

describe('GameDataServer request routes', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const gameData = makeGameData({
            Ship: { 'a': { name: 'ShipA' }, 'boom': null },
        });
        // The ids promise rejects to prove the ids route can't leak an
        // unhandled rejection (which kills the process on modern Node).
        const rejectingIds = Promise.reject(new Error('ids boom'));
        rejectingIds.catch(() => { });  // Mark handled at creation.
        (gameData as { ids: unknown }).ids = rejectingIds;

        const app = express();
        setupRoutes(
            gameData, app,
            '/nonexistent/html', '/nonexistent/bundle',
            '/nonexistent/bundle.map', '/nonexistent/worker',
            '/nonexistent/worker.map', '/nonexistent/settings');

        server = await new Promise<http.Server>(resolve => {
            const s = app.listen(0, () => resolve(s));
        });
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close(err => err ? reject(err) : resolve()));
    });

    it('serves known data', async () => {
        const resp = await fetch(`${baseUrl}/gameData/data/Ship/a`);
        expect(resp.status).toBe(200);
        expect(await resp.json()).toEqual({ name: 'ShipA' });
    });

    it('400s path-traversal ids on the GET route without leaking files', async () => {
        // Both the percent-encoded and the literal traversal vectors that
        // were confirmed to leak packages/nova/package.json must now be
        // rejected before reaching the filesystem.
        for (const vector of [
            '/gameData/data/Ship/..%2F..%2Fpackage.json',
            '/gameData/data/Ship/..%2F..%2Fpackage',
        ]) {
            const resp = await fetch(`${baseUrl}${vector}`);
            expect(resp.status).withContext(vector).toBe(400);
            const text = await resp.text();
            expect(text).not.toContain('"dependencies"');
            expect(text).not.toContain('"name"');
        }
    });

    it('400s a batch request that contains a traversal id without leaking files', async () => {
        const resp = await fetch(`${baseUrl}/gameData/data/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Ship: ['../../package'] }),
        });
        expect(resp.status).toBe(400);
        const text = await resp.text();
        expect(text).not.toContain('"dependencies"');
    });

    it('404s inherited object keys instead of crashing the process', async () => {
        // Before validation with Object.hasOwn, 'constructor' passed the
        // truthy check, `.get` was undefined, and the resulting async
        // rejection escaped Express 4 — killing the whole process under
        // Node's default --unhandled-rejections=throw.
        const resp = await fetch(`${baseUrl}/gameData/data/constructor/x`);
        expect(resp.status).toBe(404);
        expect(await resp.text()).toContain('Unknown data type');
    });

    it('404s bogus data types', async () => {
        const resp = await fetch(`${baseUrl}/gameData/data/NotARealType/x`);
        expect(resp.status).toBe(404);
        expect(await resp.text()).toContain('Unknown data type');
    });

    it('500s when a gettable rejects instead of crashing the process', async () => {
        const resp = await fetch(`${baseUrl}/gameData/data/Ship/boom`);
        expect(resp.status).toBe(500);
    });

    it('404s an id no data source defines', async () => {
        // It used to be a 200 carrying a placeholder default object, so a
        // client could not tell "does not exist" from "exists".
        const resp = await fetch(`${baseUrl}/gameData/data/Ship/missing`);
        expect(resp.status).toBe(404);
        expect(await resp.text()).toContain('missing');
    });

    it('500s when the ids promise rejects', async () => {
        const resp = await fetch(`${baseUrl}/gameData/ids.json`);
        expect(resp.status).toBe(500);
    });

    it('survives the error requests above and keeps serving', async () => {
        // Every error case in this suite ran before this spec touches
        // the server again; a still-working response proves no handler
        // let a rejection escape and take the process down.
        for (const path of [
            '/gameData/data/constructor/x',
            '/gameData/data/NotARealType/x',
            '/gameData/data/Ship/missing',
            '/gameData/ids.json',
        ]) {
            const errResp = await fetch(`${baseUrl}${path}`);
            expect(errResp.status).toBeGreaterThanOrEqual(400);
        }
        const resp = await fetch(`${baseUrl}/gameData/data/Ship/a`);
        expect(resp.status).toBe(200);
        expect(await resp.json()).toEqual({ name: 'ShipA' });
    });
});
