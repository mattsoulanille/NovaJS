// Control lag after a system entry: how far behind the room's clock the
// local simulation starts after a fresh join, a hyperspace arrival and a
// spaceport take-off, how long the pacing takes to catch up, and what that
// does to the delay between a key press and its effect on screen.
//
// Drives headless Chrome (muted, swiftshader) against YOUR OWN server,
// optionally through a delay proxy (every HTTP request held DELAY ms; the
// websocket is passed through) so a system entry takes as long as it does
// over a real network. For each entry kind it records, every animation
// frame, `window.novaSim.pacing` (rate, behindTicks) and the local
// player's displayed rotation, and taps the turn key every PROBE_MS: the
// press-to-first-rotation-change time is the input-to-effect delay.
//
//   PORT=<server port> node scripts/entry_control_lag.mjs
//     [DELAY=100] [WINDOW_MS=12000] [PROBE_MS=700] [LANDED_MS=5000]
//     [SYSTEM=nova:130] [PLANET='planet nova:128'] [KINDS=fresh,takeoff,jump]
//     [OUT=<dir for screenshots / raw json>] [SPEED2=1 (hold Caps Lock: 2x)]
//   (from packages/nova, with `PORT=<port> node dist/server.js` running)
//
// Prints one JSON summary line per entry kind. Exit code 1 on console
// errors.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? '8473');
const DELAY = Number(process.env.DELAY ?? '100');
const PROXY_PORT = Number(process.env.PROXY_PORT ?? PORT + 1);
const WINDOW_MS = Number(process.env.WINDOW_MS ?? '12000');
const PROBE_MS = Number(process.env.PROBE_MS ?? '700');
const LANDED_MS = Number(process.env.LANDED_MS ?? '5000');
const SYSTEM = process.env.SYSTEM ?? 'nova:130';
const PLANET = process.env.PLANET ?? 'planet nova:128';
const KINDS = (process.env.KINDS ?? 'fresh,takeoff,jump').split(',');
const OUT = process.env.OUT ?? path.join(os.tmpdir(), `nova-entry-lag-${process.pid}`);
const CHROME = process.env.CHROME_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// ---- the delay proxy (as next_hop_entry_round_trips.mjs) -----------------
let proxy;
let pagePort = PORT;
if (DELAY > 0) {
    proxy = http.createServer((req, res) => {
        const t0 = Date.now();
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            setTimeout(() => {
                const upstream = http.request({
                    host: '127.0.0.1', port: PORT, path: req.url,
                    method: req.method, headers: req.headers,
                }, upstreamRes => {
                    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
                    upstreamRes.pipe(res);
                });
                upstream.on('error', () => res.destroy());
                upstream.end(body);
            }, Math.max(0, t0 + DELAY - Date.now()));
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
    pagePort = PROXY_PORT;
}

/** In-page recorder: every frame's pacing + the player's rotation, and
 * every turn-key press. */
function installRecorder() {
    const rec = window.__lag = { frames: [], presses: [], states: [] };
    const playerRotation = () => {
        const world = window.displayWorld;
        if (!world) return undefined;
        for (const entity of world.entities.values()) {
            let player = false;
            let movement;
            for (const [component, value] of entity.components) {
                if (component.name === 'ShipControl') player = true; // PlayerShipSelector
                else if (component.name === 'MovementState') movement = value;
            }
            if (player && movement) return movement.rotation.angle;
        }
        return undefined;
    };
    let lastKind;
    const noteState = () => {
        const state = window.novaClientState?.();
        const kind = state ? `${state.kind}:${state.system?.systemId ?? ''}` : '';
        if (kind !== lastKind) {
            rec.states.push({ t: performance.now(), kind });
            lastKind = kind;
        }
        return state;
    };
    // Sampled on a timer rather than rAF: a headless page's animation
    // frames can stall (the game's own heartbeat then drives its ticker).
    setInterval(() => {
        const t = performance.now();
        const state = noteState();
        const pacing = window.novaSim?.pacing;
        rec.frames.push({
            t, kind: state?.kind,
            rate: pacing?.rate, behind: pacing?.behindTicks,
            rot: playerRotation(),
        });
    }, 8);
    window.addEventListener('keydown', e => {
        if (e.code === 'ArrowLeft' && !e.repeat) rec.presses.push(performance.now());
    }, true);
}

async function pressKey(page, code, holdMs = 80) {
    await page.keyboard.down(code);
    await sleep(holdMs);
    await page.keyboard.up(code);
}

/** Taps the turn key every PROBE_MS for WINDOW_MS from now. */
async function probe(page) {
    const until = Date.now() + WINDOW_MS;
    while (Date.now() < until) {
        await pressKey(page, 'ArrowLeft', 200);
        await sleep(PROBE_MS - 200);
    }
}

/** Summarizes the recorder from `tEntry` (page clock) for WINDOW_MS. */
async function summarize(page, kindName, tEntry) {
    const rec = await page.evaluate(() => window.__lag);
    const frames = rec.frames.filter(f => f.t >= tEntry && f.t <= tEntry + WINDOW_MS);
    const paced = frames.filter(f => f.behind !== undefined);
    const behind = paced.map(f => f.behind);
    // Caught up: the first frame from which |behindTicks| stays <= 2.
    let caughtUpAt;
    for (let i = paced.length - 1; i >= 0; i--) {
        if (Math.abs(paced[i].behind) > 2) {
            caughtUpAt = paced[i + 1]?.t;
            break;
        }
        if (i === 0) caughtUpAt = paced[0].t;
    }
    const presses = rec.presses.filter(t => t >= tEntry && t <= tEntry + WINDOW_MS);
    const delays = [];
    for (let i = 0; i < presses.length; i++) {
        const tp = presses[i];
        const next = presses[i + 1] ?? Infinity;
        let before;
        for (const f of rec.frames) {
            if (f.t < tp) { before = f.rot; continue; }
            if (f.t >= next) break;
            if (f.rot !== undefined && before !== undefined && f.rot !== before) {
                delays.push({ at: Math.round(tp - tEntry), ms: Math.round(f.t - tp) });
                break;
            }
            before = f.rot ?? before;
        }
    }
    const bucket = (lo, hi) => {
        const d = delays.filter(x => x.at >= lo && x.at < hi).map(x => x.ms);
        return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
    };
    // behindTicks sampled at 0.5 s steps after entry.
    const curve = [];
    for (let s = 0; s <= WINDOW_MS; s += 500) {
        const f = paced.find(x => x.t >= tEntry + s);
        curve.push(f ? Number(f.behind.toFixed(1)) : null);
    }
    const rates = paced.map(f => f.rate);
    fs.writeFileSync(path.join(OUT, `${kindName}.json`),
        JSON.stringify({ tEntry, frames, presses, delays }, null, 0));
    return {
        kind: kindName,
        firstBehind: paced[0] ? Number(paced[0].behind.toFixed(1)) : null,
        maxBehind: behind.length ? Number(Math.max(...behind).toFixed(1)) : null,
        caughtUpMs: caughtUpAt === undefined ? null : Math.round(caughtUpAt - tEntry),
        rateRange: rates.length ? [Math.min(...rates), Math.max(...rates)]
            .map(r => Number(r.toFixed(3))) : null,
        behindEvery500ms: curve,
        delayMs: { '0-2s': bucket(0, 2000), '2-5s': bucket(2000, 5000),
            '5-12s': bucket(5000, 12001) },
        delays: delays.map(d => `${d.at}:${d.ms}`).join(' '),
    };
}

/** Waits until the RECORDER has seen the client in space (in `systemId`,
 * when given) and returns the page time it first did. */
async function waitInSpace(page, systemId) {
    const handle = await page.waitForFunction(id => {
        const last = window.__lag.states.at(-1);
        return last?.kind.startsWith('inSpace:')
            && (!id || last.kind === `inSpace:${id}`) && last.t;
    }, { timeout: 180000, polling: 10 }, systemId);
    return await handle.jsonValue();
}

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 180000,
    args: ['--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    userDataDir: path.join(os.tmpdir(), `nova-entry-lag-${process.pid}-${Date.now()}`),
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
    await page.evaluateOnNewDocument(installRecorder);
    await page.goto(`http://localhost:${pagePort}/?reset=1&mute=1&system=${encodeURIComponent(SYSTEM)}`,
        { waitUntil: 'domcontentloaded', timeout: 120000 });
    const tFresh = await waitInSpace(page);
    await page.screenshot({ path: path.join(OUT, 'fresh_entry.png') });
    if (process.env.SPEED2 === '1') {
        // Headless Chrome keeps no Caps Lock state: report it the way
        // the game reads it (getModifierState on a key event).
        // Every later key event must keep reporting it, or the next
        // probe press votes the room back to 1x.
        await page.evaluate(() => {
            for (const Event of [KeyboardEvent, MouseEvent]) {
                const original = Event.prototype.getModifierState;
                Event.prototype.getModifierState = function (key) {
                    return key === 'CapsLock' || original.call(this, key);
                };
            }
            window.dispatchEvent(new KeyboardEvent('keydown',
                { key: 'Shift', code: 'ShiftLeft' }));
        });
        await page.waitForFunction(() => window.novaSim?.pacing?.speed === 2,
            { timeout: 10000 });
    }
    if (KINDS.includes('fresh')) {
        await probe(page);
        results.push(await summarize(page, 'fresh', tFresh));
        await page.screenshot({ path: path.join(OUT, 'fresh.png') });
    } else {
        await sleep(3000);
    }

    if (KINDS.includes('takeoff')) {
        await page.evaluate(planet => window.novaAutopilot.navigateTo(planet), PLANET);
        await page.waitForFunction(() => document.body.classList.contains('nova-docked'),
            { timeout: 120000 });
        await sleep(LANDED_MS);
        for (let tries = 0; tries < 20; tries++) {
            const target = await page.evaluate(() => {
                const wanted = ['Button:No', 'Button:Refuse', 'Button:OK', 'Button:Done', 'Button:Leave'];
                const found = new Map();
                (function walk(c) {
                    if (c.name && c.worldVisible && wanted.includes(c.name) && !found.has(c.name)) found.set(c.name, c);
                    for (const k of c.children ?? []) walk(k);
                })(window.app.stage);
                for (const w of wanted) {
                    const c = found.get(w);
                    if (c) { const b = c.getBounds(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
                }
                return undefined;
            });
            if (target) {
                await page.mouse.click(target.x, target.y);
            } else {
                await page.keyboard.press('KeyD');
            }
            await sleep(400);
            if (await page.evaluate(() => window.novaClientState?.().kind === 'inSpace')) break;
        }
        const tTakeoff = await waitInSpace(page);
        await page.screenshot({ path: path.join(OUT, 'takeoff_entry.png') });
        await probe(page);
        results.push(await summarize(page, 'takeoff', tTakeoff));
        await page.screenshot({ path: path.join(OUT, 'takeoff.png') });
    }

    if (KINDS.includes('jump')) {
        const origin = await page.evaluate(() => window.novaClientState().system.systemId);
        await pressKey(page, 'KeyM');
        await page.waitForFunction(() => !!window.novaStarmap?.systemGraph, { timeout: 30000 });
        await sleep(1000);
        const hop = await page.evaluate(async (from, wanted) => {
            const graph = window.novaStarmap.systemGraph;
            const system = await window.simulationGameData.data.System.get(from);
            const to = wanted ?? system.links[0];
            graph.onClickSystem(to, false);
            return to;
        }, origin, process.env.HOP);
        await sleep(300);
        await pressKey(page, 'Escape');
        await sleep(800);
        await page.keyboard.down('ArrowUp');
        await sleep(2500);
        await page.keyboard.up('ArrowUp');
        let left = false;
        for (let attempt = 0; attempt < 8 && !left; attempt++) {
            await page.keyboard.down('KeyJ');
            try {
                await page.waitForFunction(() => window.novaClientState?.().kind !== 'inSpace',
                    { timeout: 8000, polling: 20 });
                left = true;
            } catch {
                await page.keyboard.up('KeyJ');
                await page.keyboard.down('ArrowUp');
                await sleep(1500);
                await page.keyboard.up('ArrowUp');
            }
        }
        await page.keyboard.up('KeyJ');
        if (!left) throw new Error('the jump never started');
        const tArrive = await waitInSpace(page, hop);
        await page.screenshot({ path: path.join(OUT, 'jump_entry.png') });
        await probe(page);
        results.push({ ...await summarize(page, 'jump', tArrive), hop });
        await page.screenshot({ path: path.join(OUT, 'jump.png') });
    }
} catch (e) {
    console.error('run failed:', e);
    try {
        const [page] = (await browser.pages()).slice(-1);
        await page.screenshot({ path: path.join(OUT, 'failure.png') });
        console.error('client state:', await page.evaluate(
            () => JSON.stringify(window.__lag.states.slice(-6))));
    } catch { /* best effort */ }
    errors.push(`run failed: ${e}`);
} finally {
    await browser.close();
    proxy?.close();
}
for (const r of results) {
    console.log(JSON.stringify({ delayMs: DELAY, ...r }));
}
console.log(JSON.stringify({ out: OUT, consoleErrors: errors.length, errors: errors.slice(0, 10) }));
process.exit(errors.length ? 1 : 0);
