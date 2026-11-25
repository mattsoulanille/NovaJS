import 'jasmine';
import express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { VERSION_PATH } from '../common/version_handshake.js';
import { registerVersionRoute } from './version_route.js';

const BUILD = 'testsha-1234';

describe('version route', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const app = express();
        registerVersionRoute(app, BUILD);
        // A catch-all registered AFTER the version route, mirroring
        // setupRoutes' `use("/")`. If the version route were registered
        // too late this would swallow it, so its presence here is part of
        // the test.
        app.use('/', (_req, res) => {
            res.status(200).send('index-html-stand-in');
        });

        server = await new Promise<http.Server>(resolve => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close(err => err ? reject(err) : resolve()));
    });

    it('serves the build version as the response body', async () => {
        const resp = await fetch(`${baseUrl}${VERSION_PATH}`);
        expect(resp.status).toEqual(200);
        expect((await resp.text()).trim()).toEqual(BUILD);
    });

    it('wins over the catch-all index route', async () => {
        const resp = await fetch(`${baseUrl}${VERSION_PATH}`);
        expect(await resp.text()).not.toContain('index-html-stand-in');
    });

    it('serves it as plain text', async () => {
        const resp = await fetch(`${baseUrl}${VERSION_PATH}`);
        expect(resp.headers.get('content-type')).toContain('text/plain');
    });

    // A revalidated 304 from an intermediary holding the OLD stamp would
    // defeat the very check this response feeds.
    it('forbids caching the response', async () => {
        const resp = await fetch(`${baseUrl}${VERSION_PATH}`);
        expect(resp.headers.get('cache-control')).toContain('no-store');
    });

    it('reports the same stamp on every request', async () => {
        const first = await (await fetch(`${baseUrl}${VERSION_PATH}`)).text();
        const second = await (await fetch(`${baseUrl}${VERSION_PATH}`)).text();
        expect(first).toEqual(second);
    });
});
