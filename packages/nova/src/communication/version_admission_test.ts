import 'jasmine';
import * as http from 'http';
import { AddressInfo } from 'net';
import { WebSocket as ClientWebSocket } from 'ws';
import {
    connectUrlWithVersion, VERSION_MISMATCH_CLOSE_CODE,
} from '../common/version_handshake.js';
import { SocketChannelServer } from './socket_channel_server.js';

const SERVER_BUILD = 'server-build-aaa';

/**
 * End-to-end admission tests over a REAL websocket server and real client
 * sockets. The spy-based suites in `socket_channel_server_test.ts` cover
 * the channel's message plumbing; this suite exists to prove the one
 * property that matters for the version handshake and that a spy cannot
 * establish: a build-mismatched client is closed by the server and never
 * becomes a client of the channel, so it can never join a room.
 */
describe('websocket version admission', () => {
    let httpServer: http.Server;
    let channel: SocketChannelServer;
    let baseUrl: string;
    let connects: string[];
    let openSockets: ClientWebSocket[];

    beforeEach(async () => {
        connects = [];
        openSockets = [];
        httpServer = http.createServer();
        channel = new SocketChannelServer({
            server: httpServer,
            buildVersion: SERVER_BUILD,
            // Silence the expected refusal warnings.
            warn: () => { },
        });
        channel.clientConnect.subscribe(uuid => connects.push(uuid));

        await new Promise<void>(resolve =>
            httpServer.listen(0, '127.0.0.1', () => resolve()));
        const port = (httpServer.address() as AddressInfo).port;
        baseUrl = `ws://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        for (const socket of openSockets) {
            socket.close();
        }
        channel.wss.close();
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
    });

    /**
     * Connects and resolves when the server CLOSES the socket.
     *
     * The refusal is issued from the `connection` handler, i.e. after the
     * websocket handshake has completed, so a refused client does briefly
     * reach the open state before the close frame lands. That is
     * deliberate: rejecting earlier (at `verifyClient`) would fail the
     * handshake at the HTTP layer, and a browser reports that to the page
     * as an indistinguishable code-1006 close. Closing with an explicit
     * application code is what lets the client tell "your build is stale"
     * apart from "the network dropped" and reload accordingly.
     */
    function connectExpectingRefusal(url: string):
        Promise<{ code: number, reason: string }> {
        const socket = new ClientWebSocket(url);
        openSockets.push(socket);
        return new Promise(resolve => {
            socket.on('close', (code: number, reason: Buffer) =>
                resolve({ code, reason: reason.toString() }));
            socket.on('error', () => { /* a refusal may also error */ });
        });
    }

    /** Connects and resolves once the socket is open and still open. */
    async function connectExpectingAdmission(url: string): Promise<void> {
        const socket = new ClientWebSocket(url);
        openSockets.push(socket);
        let closed: { code: number } | undefined;
        socket.on('close', (code: number) => { closed = { code }; });
        await new Promise<void>((resolve, reject) => {
            socket.on('open', () => resolve());
            socket.on('error', (e: Error) => reject(e));
        });
        // Give a refusal, were one coming, time to arrive.
        await new Promise<void>(resolve => setTimeout(resolve, 50));
        if (closed) {
            throw new Error(
                `Expected to stay connected but was closed with `
                + `code ${closed.code}`);
        }
    }

    it('admits a client announcing the server build', async () => {
        await connectExpectingAdmission(
            connectUrlWithVersion(baseUrl, SERVER_BUILD));
        expect(connects.length).toEqual(1);
        expect(channel.clients.size).toEqual(1);
    });

    it('closes a client announcing a different build', async () => {
        const result = await connectExpectingRefusal(
            connectUrlWithVersion(baseUrl, 'client-build-bbb'));
        expect(result.code).toEqual(VERSION_MISMATCH_CLOSE_CODE);
    });

    // The whole point: refusal happens before the client exists to the
    // channel, so there is nothing that could subsequently join a room.
    it('never admits a mismatched client as a channel client', async () => {
        await connectExpectingRefusal(
            connectUrlWithVersion(baseUrl, 'client-build-bbb'));
        expect(connects).toEqual([]);
        expect(channel.clients.size).toEqual(0);
    });

    it('refuses a client that announces no build at all', async () => {
        const result = await connectExpectingRefusal(baseUrl);
        expect(result.code).toEqual(VERSION_MISMATCH_CLOSE_CODE);
        expect(channel.clients.size).toEqual(0);
    });

    it('refuses a client announcing an empty build', async () => {
        const result = await connectExpectingRefusal(`${baseUrl}/?v=`);
        expect(result.code).toEqual(VERSION_MISMATCH_CLOSE_CODE);
    });

    it('names the server build in the close reason', async () => {
        const result = await connectExpectingRefusal(
            connectUrlWithVersion(baseUrl, 'client-build-bbb'));
        expect(result.reason).toContain(SERVER_BUILD);
    });

    it('keeps admitting good clients after refusing a bad one', async () => {
        await connectExpectingRefusal(
            connectUrlWithVersion(baseUrl, 'client-build-bbb'));
        await connectExpectingAdmission(
            connectUrlWithVersion(baseUrl, SERVER_BUILD));
        expect(channel.clients.size).toEqual(1);
    });
});

describe('websocket version admission with an awkward stamp', () => {
    // A build stamp is not guaranteed to be url-safe, so the connect url
    // must escape it and the server must unescape it identically.
    const awkward = 'abc123-dirty-1700000000000+build/1 2&x=y';
    let httpServer: http.Server;
    let channel: SocketChannelServer;
    let baseUrl: string;

    beforeEach(async () => {
        httpServer = http.createServer();
        channel = new SocketChannelServer({
            server: httpServer, buildVersion: awkward, warn: () => { },
        });
        await new Promise<void>(resolve =>
            httpServer.listen(0, '127.0.0.1', () => resolve()));
        baseUrl = `ws://127.0.0.1:`
            + `${(httpServer.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        channel.wss.close();
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
    });

    it('admits a client announcing the same awkward stamp', async () => {
        const socket = new ClientWebSocket(
            connectUrlWithVersion(baseUrl, awkward));
        let closed = false;
        socket.on('close', () => { closed = true; });
        await new Promise<void>((resolve, reject) => {
            socket.on('open', () => resolve());
            socket.on('error', reject);
        });
        await new Promise<void>(resolve => setTimeout(resolve, 50));
        expect(closed).toBeFalse();
        expect(channel.clients.size).toEqual(1);
        socket.close();
    });
});

describe('websocket version admission when unarmed', () => {
    let httpServer: http.Server;
    let channel: SocketChannelServer;
    let baseUrl: string;

    beforeEach(async () => {
        httpServer = http.createServer();
        // No buildVersion: the gate is skipped entirely. This is the mode
        // tests and tools use, and it must stay backwards compatible.
        channel = new SocketChannelServer({ server: httpServer });
        await new Promise<void>(resolve =>
            httpServer.listen(0, '127.0.0.1', () => resolve()));
        baseUrl = `ws://127.0.0.1:`
            + `${(httpServer.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        channel.wss.close();
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
    });

    it('admits a client that announces nothing', async () => {
        const socket = new ClientWebSocket(baseUrl);
        await new Promise<void>((resolve, reject) => {
            socket.on('open', () => resolve());
            socket.on('close', () => reject(new Error('closed')));
        });
        expect(channel.clients.size).toEqual(1);
        socket.close();
    });
});
