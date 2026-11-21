// What LANDING costs a fresh browser client in network round trips, and
// what each landed sub-screen costs to open (issue #369; the system-
// entry counterpart is system_entry_round_trips.mjs, #368).
//
// Runs a delay proxy in front of YOUR OWN server (every HTTP request is
// held `delayMs` before it is forwarded; the websocket is passed
// through), drives headless Chrome (muted) through the title screen to
// a fresh pilot (n, Enter), waits `settleMs` in space, autopilots to the
// nearest landable stellar and times:
//   - entry: Enter on the new-pilot dialog -> client state inSpace;
//   - landing: client state 'landing' -> the spaceport drawn (visible,
//     every visible sprite's texture loaded) and settled, landing popups
//     included (the first-landing offer of a fresh pilot);
//   - each venue (bar, mission BBS, trade, outfitter, shipyard): the key
//     -> the venue drawn and settled.
// For each window it reports the HTTP requests issued, the batched data
// POSTs among them, and the DEPTH (the longest chain of dependent round
// trips: a request's depth is one more than the deepest request of the
// same window that had completed before it was issued).
//
//   PORT=<server port> node scripts/landing_round_trips.mjs \
//       [delayMs=100] [settleMs=20000] [screenshot.png]
//   (from packages/nova, with `PORT=<port> node dist/server.js` running)
//
// Prints one JSON line per window. Exit code 1 on console errors.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? '8469');
const PROXY_PORT = Number(process.env.PROXY_PORT ?? PORT + 1);
const [delayArg = '100', settleArg = '20000', screenshot] =
    process.argv.slice(2);
const delayMs = Number(delayArg);
const settleMs = Number(settleArg);
const CHROME = process.env.CHROME_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- the delay proxy -----------------------------------------------------
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
                entry.ids = Object.fromEntries(Object.entries(
                    JSON.parse(body.toString())).map(([k, v]) => [k, v.length]));
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
                + (r.ids ? ' ' + JSON.stringify(r.ids) : ''));
        }
    }
    return {
        requests: reqs.length,
        batches: reqs.filter(r => r.method === 'POST').length,
        depth: Math.max(0, ...reqs.map(r => r.depth)),
        kinds,
    };
}

// ---- in-page probes ------------------------------------------------------
/** Installs a per-frame watcher: client-state transitions, and for a
 * named container whether it is drawn (visible, every visible sprite's
 * texture loaded). */
function installWatcher() {
    const w = window.__landWatch = {
        states: [], drawn: {}, target: undefined,
    };
    let lastKind;
    const find = (node, name) => {
        if (!node) return undefined;
        if (node.name === name) return node;
        for (const child of node.children ?? []) {
            const hit = find(child, name);
            if (hit) return hit;
        }
        return undefined;
    };
    const isDrawn = (node) => {
        if (!node || !node.worldVisible) return false;
        let ok = true;
        (function walk(n) {
            if (!ok || !n.visible) return;
            if (n.texture && n.texture.baseTexture && !n.texture.baseTexture.valid
                && !String(n.texture.baseTexture.cacheId ?? '').endsWith('/default.png')
                && !(n instanceof window.PIXI.Text)) {
                ok = false;
                return;
            }
            for (const child of n.children ?? []) walk(child);
        })(node);
        return ok;
    };
    const tick = () => {
        const kind = window.novaClientState?.().kind;
        if (kind !== lastKind) {
            w.states.push({ kind, t: Date.now() });
            lastKind = kind;
        }
        if (w.target) {
            const node = find(window.app.stage, w.target);
            const drawn = isDrawn(node) && (node.children?.length ?? 0) > 1;
            const rec = w.drawn[w.target] ??= { first: undefined, last: undefined, now: false };
            if (drawn && !rec.now) {
                rec.first ??= Date.now();
                rec.last = Date.now();
            }
            rec.now = drawn;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function findPlanetToLand() {
    const world = window.displayWorld;
    let ship;
    const planets = [];
    for (const [uuid, entity] of world.entities) {
        const byName = {};
        for (const [component, value] of entity.components) {
            byName[component.name] = value;
        }
        if ('ShipControl' in byName && byName.MovementState) {
            ship = byName.MovementState.position;
        }
        if (byName.Planet && byName.PlanetData?.flags?.canLand
            && !byName.PlanetData.gate) {
            planets.push({ uuid, id: byName.Planet.id ?? byName.PlanetData.id,
                position: byName.PlanetData.position });
        }
    }
    const dist = p => ship ? Math.hypot(p.position[0] - ship.x,
        p.position[1] - ship.y) : 0;
    planets.sort((a, b) => dist(a) - dist(b));
    return planets[0];
}

/** Clicks the first button (by label preference) on a visible OfferPopup,
 * returning its label, or undefined when no popup is up. */
async function dismissPopup(page) {
    const target = await page.evaluate(() => {
        const find = (node, pred, out = []) => {
            if (!node || !node.visible) return out;
            if (pred(node)) out.push(node);
            for (const child of node.children ?? []) find(child, pred, out);
            return out;
        };
        const popups = find(window.app.stage,
            n => (n.name === 'OfferPopup' || n.name === 'NewsDialog') && n.worldVisible);
        if (popups.length === 0) return undefined;
        const buttons = find(popups[popups.length - 1],
            n => typeof n.name === 'string' && n.name.startsWith('Button:'));
        const order = ['Decline', 'Refuse', 'No', 'Okay', 'OK', 'Done', 'Leave', 'Accept'];
        buttons.sort((a, b) => {
            const ia = order.indexOf(a.name.slice(7));
            const ib = order.indexOf(b.name.slice(7));
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        const button = buttons[0];
        if (!button) return undefined;
        const bounds = button.getBounds();
        return { label: button.name, x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2 };
    });
    if (!target) return undefined;
    // getBounds is in renderer pixels; the canvas is CSS-sized 1:1 here.
    await page.mouse.click(target.x, target.y);
    return target.label;
}

async function pressKey(page, code) {
    await page.evaluate(c => document.dispatchEvent(
        new KeyboardEvent('keydown', { code: c, key: c, bubbles: true })), code);
    await sleep(60);
    await page.evaluate(c => document.dispatchEvent(
        new KeyboardEvent('keyup', { code: c, key: c, bubbles: true })), code);
}

/** Times a container from `t0` until it has been drawn and the network
 * has been quiet (no new request) for `quietMs`, up to `timeoutMs`. */
async function timeDrawn(page, name, t0, { quietMs = 1500, timeoutMs = 30000 } = {}) {
    await page.evaluate(n => { window.__landWatch.target = n; }, name);
    const deadline = t0 + timeoutMs;
    for (;;) {
        await sleep(100);
        const rec = await page.evaluate(n => window.__landWatch.drawn[n], name);
        // Space keeps loading behind the spaceport (NPC sprite sheets
        // and sounds as ships arrive): only the landed UI's kinds count.
        const lastReq = Math.max(t0, ...log
            .filter(e => e.t0 >= t0 && !/SpriteSheet|SoundFile/.test(e.url))
            .map(e => e.t1 === Infinity ? Date.now() : e.t1));
        if (rec?.now && Date.now() - lastReq > quietMs && Date.now() - rec.last > quietMs) {
            return rec.last;
        }
        if (Date.now() > deadline) {
            return rec?.last ?? Infinity;
        }
    }
}

// ---- the run -------------------------------------------------------------
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 180000,
    args: ['--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio',
        '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    userDataDir: path.join(os.tmpdir(), `nova-landing-rt-${process.pid}-${Date.now()}`),
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
    await page.goto(`http://localhost:${PROXY_PORT}/?mute=1`,
        { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForFunction(() => window.novaTitle && window.app,
        { timeout: 120000 });
    await page.evaluate(() => window.novaTitle.buildPromise);
    await page.evaluate(installWatcher);
    await sleep(500);
    await page.keyboard.press('n');
    await sleep(1000);
    const tEnter = Date.now();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.novaClientState?.().kind === 'inSpace',
        { timeout: 180000, polling: 50 });
    const tInSpace = Date.now();
    results.push({ window: 'entry', ms: tInSpace - tEnter,
        ...windowStats(tEnter, tInSpace) });

    // The landed-UI prefetch (#369), where the build has one: how long
    // it takes to drain after inSpace, and what it requests.
    const drained = await page.evaluate(async () => {
        const prefetch = window.novaLandedUiPrefetch;
        if (!prefetch) return undefined;
        await prefetch.idle;
        return { t: Date.now(), done: prefetch.done, systemId: prefetch.systemId };
    });
    if (drained) {
        results.push({ window: 'prefetch', systemId: drained.systemId,
            done: drained.done, msAfterInSpace: drained.t - tInSpace,
            ...windowStats(tInSpace, drained.t + 1) });
    }
    await sleep(settleMs);
    const planet = await page.evaluate(findPlanetToLand);
    if (!planet) throw new Error('No landable stellar in the start system');
    const tNav = Date.now();
    await page.evaluate(u => window.novaAutopilot.navigateTo(u), planet.uuid);
    await page.waitForFunction(() => window.novaClientState?.().kind === 'landing'
        || window.novaClientState?.().kind === 'landed',
        { timeout: 180000, polling: 20 });
    const tLanding = (await page.evaluate(() => window.__landWatch.states))
        .filter(s => s.kind === 'landing' && s.t >= tNav).at(-1)?.t ?? Date.now();
    const tDrawn = await timeDrawn(page, 'Spaceport', tLanding);
    results.push({ window: 'land', planet: planet.id, ms: tDrawn - tLanding,
        ...windowStats(tLanding, tDrawn + 1) });
    if (screenshot) {
        await page.screenshot({ path: screenshot });
    }

    // Close the landing popups (pointer-only), then open each venue.
    const popups = [];
    for (let i = 0; i < 10; i++) {
        const label = await dismissPopup(page);
        if (!label) break;
        popups.push(label);
        await sleep(800);
    }
    results.push({ window: 'landingPopups', clicked: popups });

    const venues = [
        ['bar', 'KeyB', 'Bar'],
        ['missionBBS', 'KeyN', 'MissionBoard-Mission BBS'],
        ['tradeCenter', 'KeyT', 'TradeCenter'],
        ['outfitter', 'KeyO', 'Outfitter'],
        ['shipyard', 'KeyS', 'Shipyard'],
    ];
    const flags = await page.evaluate(id =>
        window.simulationGameData.data.Planet.getCached(id)?.flags, planet.id);
    const present = { bar: flags?.hasBar, missionBBS: true,
        tradeCenter: flags?.hasCommodityExchange, outfitter: flags?.hasOutfitter,
        shipyard: flags?.hasShipyard };
    for (const [venue, key, name] of venues) {
        if (!present[venue]) {
            results.push({ window: venue, absent: true });
            continue;
        }
        await sleep(500);
        const t0 = Date.now();
        await pressKey(page, key);
        // A venue-entry offer can pop up first: decline it.
        let clicked;
        for (let i = 0; i < 20; i++) {
            await sleep(150);
            const visible = await page.evaluate(n => {
                const find = (node) => {
                    if (!node) return undefined;
                    if (node.name === n) return node;
                    for (const c of node.children ?? []) {
                        const hit = find(c);
                        if (hit) return hit;
                    }
                    return undefined;
                };
                return !!find(window.app.stage)?.worldVisible;
            }, name);
            if (visible) break;
            clicked = await dismissPopup(page) ?? clicked;
        }
        const t1 = await timeDrawn(page, name, t0);
        results.push({ window: venue, ms: t1 - t0, ...(clicked ? { clicked } : {}),
            ...windowStats(t0, t1 + 1) });
        if (screenshot && process.env.VENUE_SHOTS) {
            await page.screenshot({ path: screenshot.replace(/\.png$/, `-${venue}.png`) });
        }
        await pressKey(page, 'Escape');
        await sleep(800);
        // A dialog (e.g. the bar's) may need a second Escape.
        for (let i = 0; i < 3; i++) {
            const stillOpen = await page.evaluate(n => {
                const find = (node) => {
                    if (!node) return undefined;
                    if (node.name === n) return node;
                    for (const c of node.children ?? []) {
                        const hit = find(c);
                        if (hit) return hit;
                    }
                    return undefined;
                };
                return !!find(window.app.stage)?.worldVisible;
            }, name);
            if (!stillOpen) break;
            await pressKey(page, 'Escape');
            await sleep(600);
        }
    }
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
