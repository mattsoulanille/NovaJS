// What a HYPERSPACE JUMP's system entry costs a browser client, with and
// without the one-jump-ahead prefetch (issue #370; the startup-entry and
// landing counterparts are system_entry_round_trips.mjs and
// landing_round_trips.mjs, #368/#369).
//
// Runs a delay proxy in front of YOUR OWN server (every HTTP request is
// held `delayMs` before it is forwarded; the websocket is passed
// through), drives headless Chrome (muted) through the title to a fresh
// pilot (n, Enter), waits `settleMs` in space (the landed-UI prefetch and
// the mission preload drained), selects a one-hop route to a linked
// system through the star map, waits for the next-hop prefetch to drain
// (mode `on`) or turns it off first (mode `off`), and jumps. It reports:
//   - prefetch: what the next-hop prefetch requested, and how long after
//     the route was selected it drained (mode `on`);
//   - entry: the client state leaving space for the jump's transit ->
//     inSpace in the destination; requests, batched data POSTs and the
//     DEPTH (longest chain of dependent round trips) in that window;
//   - arrival: the first `arrivalMs` in the destination (assets the
//     display had to load after arriving: sprite sheets, sounds, ...).
//
//   PORT=<server port> node scripts/next_hop_entry_round_trips.mjs \
//       <on|off> [delayMs=100] [settleMs=15000] [arrivalMs=5000]
//   (from packages/nova, with `PORT=<port> node dist/server.js` running;
//   START_SYSTEM=<id> pins the pilot's start system, HOP=<id> the hop,
//   default: the start system's first link)
//
// Prints one JSON line per window. Exit code 1 on console errors.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? '8469');
const PROXY_PORT = Number(process.env.PROXY_PORT ?? PORT + 1);
const [mode = 'on', delayArg = '100', settleArg = '15000', arrivalArg = '5000'] =
    process.argv.slice(2);
if (mode !== 'on' && mode !== 'off') {
    console.error('usage: next_hop_entry_round_trips.mjs <on|off> [delayMs] [settleMs] [arrivalMs]');
    process.exit(2);
}
const delayMs = Number(delayArg);
const settleMs = Number(settleArg);
const arrivalMs = Number(arrivalArg);
const CHROME = process.env.CHROME_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- the delay proxy (as landing_round_trips.mjs) ------------------------
const log = [];
const proxy = http.createServer((req, res) => {
    const entry = { method: req.method, url: req.url, t0: Date.now(), t1: Infinity };
    log.push(entry);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (req.method === 'POST') {
            try {
                const batch = JSON.parse(body.toString());
                entry.ids = Object.values(batch)
                    .reduce((n, ids) => n + ids.length, 0);
                // Small batches are named in the URLS listing.
                if (entry.ids <= 4) {
                    entry.named = batch;
                }
            } catch { /* not a batch */ }
        }
        setTimeout(() => {
            const upstream = http.request({
                host: '127.0.0.1', port: PORT, path: req.url,
                method: req.method, headers: req.headers,
            }, upstreamRes => {
                entry.status = upstreamRes.statusCode;
                if ((upstreamRes.statusCode ?? 0) >= 400) {
                    console.error(`HTTP ${upstreamRes.statusCode} ${req.method} ${req.url}`);
                }
                res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
                upstreamRes.pipe(res);
                upstreamRes.on('end', () => { entry.t1 = Date.now(); });
            });
            upstream.on('error', () => {
                entry.t1 = Date.now();
                res.destroy();
            });
            upstream.end(body);
        }, Math.max(0, entry.t0 + delayMs - Date.now()));
    });
});
proxy.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(PORT, '127.0.0.1', () => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        }
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        upstream.write(head);
        socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
});
await new Promise(resolve => proxy.listen(PROXY_PORT, resolve));

/** The requests issued in [from, to), with their window-relative depth. */
function windowStats(from, to) {
    const reqs = log.filter(e => e.t0 >= from && e.t0 < to)
        .sort((a, b) => a.t0 - b.t0);
    for (const r of reqs) {
        r.depth = 1 + Math.max(0, ...reqs
            .filter(o => o !== r && o.t1 <= r.t0 && o.depth !== undefined)
            .map(o => o.depth));
    }
    const kinds = {};
    for (const r of reqs) {
        const kind = r.method === 'POST' ? 'batch'
            : (r.url.match(/^\/gameData\/(?:data\/)?([^/]+)/)?.[1]
                ?? r.url.split('?')[0]);
        kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    if (process.env.URLS) {
        console.error(`--- [${from}, ${to})`);
        for (const r of reqs) {
            console.error(`  d${r.depth} +${r.t0 - from}ms ${r.method} ${r.url}`
                + (r.ids ? ` (${r.ids} ids)` : '')
                + (r.named ? ' ' + JSON.stringify(r.named) : ''));
        }
    }
    return {
        requests: reqs.length,
        batches: reqs.filter(r => r.method === 'POST').length,
        batchIds: reqs.reduce((n, r) => n + (r.ids ?? 0), 0),
        depth: Math.max(0, ...reqs.map(r => r.depth)),
        kinds,
    };
}

/** Records every client-state change with its time. */
function installWatcher() {
    const w = window.__hopWatch = { states: [] };
    let last;
    const tick = () => {
        const s = window.novaClientState?.();
        const key = s ? `${s.kind}:${s.system?.systemId ?? ''}` : undefined;
        if (key !== last) {
            w.states.push({ kind: s?.kind, systemId: s?.system?.systemId, t: Date.now() });
            last = key;
        }
    };
    // A timer rather than rAF: a headless page's frames can stall.
    setInterval(tick, 10);
}

async function pressKey(page, code, holdMs = 80) {
    await page.keyboard.down(code);
    await sleep(holdMs);
    await page.keyboard.up(code);
}

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 180000,
    args: ['--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio',
        '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    userDataDir: path.join(os.tmpdir(), `nova-next-hop-${process.pid}-${Date.now()}`),
});
const errors = [];
const results = [];
try {
    const page = await browser.newPage();
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text());
        if (process.env.VERBOSE) console.error('[page]', m.type(), m.text().slice(0, 300));
    });
    page.on('pageerror', e => errors.push(String(e)));
    // `?system=` skips the title (a fresh default pilot, entered at once).
    const start = process.env.START_SYSTEM
        ? `&system=${encodeURIComponent(process.env.START_SYSTEM)}` : '';
    await page.goto(`http://localhost:${PROXY_PORT}/?mute=1${start}`,
        { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (start) {
        await page.waitForFunction(() => window.app, { timeout: 120000 });
        await page.evaluate(installWatcher);
    } else {
        await page.waitForFunction(() => window.novaTitle && window.app,
            { timeout: 120000 });
        await page.evaluate(() => window.novaTitle.buildPromise);
        await page.evaluate(installWatcher);
        await sleep(500);
        await page.keyboard.press('n');
        await sleep(1000);
        await page.keyboard.press('Enter');
    }
    await page.waitForFunction(() => window.novaClientState?.().kind === 'inSpace',
        { timeout: 180000, polling: 50 });
    const origin = await page.evaluate(() => window.novaClientState().system.systemId);
    if (mode === 'off') {
        await page.evaluate(() => { window.novaNextHopPrefetch.disabled = true; });
    }
    await page.evaluate(() => window.novaLandedUiPrefetch?.idle);
    await sleep(settleMs);

    // Select a route on the map: to a linked system (HOP, default the
    // first link), or with ROUTE_HOPS=n to a system n jumps away, whose
    // FIRST hop is then the only one the prefetch may touch.
    await pressKey(page, 'KeyM');
    await page.waitForFunction(() => !!window.novaStarmap?.systemGraph,
        { timeout: 30000 });
    await sleep(1000);
    const routeHops = Number(process.env.ROUTE_HOPS ?? '1');
    const route = await page.evaluate(async (from, wanted, hops) => {
        const graph = window.novaStarmap.systemGraph;
        let path;
        if (wanted) {
            path = [wanted];
        } else if (hops > 1) {
            path = [...graph.routes.values()].find(p => p.length === hops);
        } else {
            const system = await window.simulationGameData.data.System.get(from);
            path = system.links.slice(0, 1);
        }
        if (path?.length) {
            graph.onClickSystem(path.at(-1), hops > 1);
        }
        return path;
    }, origin, process.env.HOP, routeHops);
    const hop = route?.[0];
    if (!hop) throw new Error(`no ${routeHops}-hop route from ${origin}`);
    await sleep(300);
    const tRoute = Date.now();
    await pressKey(page, 'Escape');
    await sleep(500);

    if (mode === 'on') {
        await page.waitForFunction(h => window.novaNextHopPrefetch?.systemId === h,
            { timeout: 30000, polling: 50 }, hop);
        const drained = await page.evaluate(async () => {
            const prefetch = window.novaNextHopPrefetch;
            await prefetch.idle;
            return { t: Date.now(), done: prefetch.done, systemId: prefetch.systemId };
        });
        results.push({ window: 'prefetch', origin, route, hop, done: drained.done,
            msAfterRoute: drained.t - tRoute,
            // Every system whose list was asked for, ever (one hop only).
            listsFetched: log.filter(e => e.url.includes('/systemResources/'))
                .map(e => decodeURIComponent(e.url.split('/').at(-1))),
            ...windowStats(tRoute, drained.t + 1) });
    }
    await sleep(1000);

    // Away from the stellars, then jump (hold J until the jump starts).
    await page.keyboard.down('ArrowUp');
    await sleep(2500);
    await page.keyboard.up('ArrowUp');
    let tLeft;
    for (let attempt = 0; attempt < 6 && !tLeft; attempt++) {
        await page.keyboard.down('KeyJ');
        try {
            await page.waitForFunction(() => window.novaClientState?.().kind !== 'inSpace',
                { timeout: 8000, polling: 20 });
            tLeft = Date.now();
        } catch {
            // Not cleared to jump yet (too close, still turning): fly on.
            await page.keyboard.up('KeyJ');
            await page.keyboard.down('ArrowUp');
            await sleep(1500);
            await page.keyboard.up('ArrowUp');
        }
    }
    await page.keyboard.up('KeyJ');
    if (!tLeft) throw new Error('the jump never started');
    await page.waitForFunction(h => window.novaClientState?.().kind === 'inSpace'
        && window.novaClientState().system.systemId === h,
    { timeout: 180000, polling: 20 }, hop);
    const tSeen = Date.now();
    const states = await page.evaluate(() => window.__hopWatch.states);
    const left = states.filter(s => s.kind !== 'inSpace' && s.t >= tLeft - 2000)[0];
    const tArrived = states.filter(s => s.kind === 'inSpace'
        && s.systemId === hop).at(-1)?.t ?? tSeen;
    const tTransit = left?.t ?? tLeft;
    results.push({ window: 'entry', mode, origin, hop, ms: tArrived - tTransit,
        ...windowStats(tTransit, tArrived + 1) });
    await sleep(arrivalMs);
    results.push({ window: 'arrival', mode, hop, ms: arrivalMs,
        ...windowStats(tArrived + 1, tArrived + 1 + arrivalMs) });
} catch (e) {
    console.error('run failed:', e);
    errors.push(`run failed: ${e}`);
} finally {
    await browser.close();
    proxy.close();
}
for (const r of results) {
    console.log(JSON.stringify({ delayMs, ...r }));
}
console.log(JSON.stringify({ consoleErrors: errors.length, errors: errors.slice(0, 10) }));
process.exit(errors.length ? 1 : 0);
