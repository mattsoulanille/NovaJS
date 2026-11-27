// Multi-jump route and the `j` key: does a route chain exactly when the
// key is down at the moment the ship can jump, and never otherwise?
//
// Drives headless Chrome (muted, swiftshader) against YOUR OWN server
// through the title to a fresh pilot, pins a 3-hop route on the star map
// (shift-clicks), flies out of the no-jump zone and runs one `j` scenario:
//
//   tap       press j once (300 ms) and let go long before the arrival
//   hold      hold j through the whole route, with keyboard auto-repeat
//   holdnorep hold j through the whole route, WITHOUT auto-repeat (what a
//             Mac does once another key has been pressed after j)
//   transit   tap j to start, then tap j again during the transit screen
//             (between the departure and the new system appearing)
//   transithold  tap j to start, then press j during the transit screen
//             and hold it (with auto-repeat) through the rest
//   appear    tap j to start, then press j (a 150 ms tap) the moment the
//             new system shows (the player drawn, the flash fading)
//
// Expected (the original, reference "Multi-jump routes and the `j` key,
// wave 11"): a hop starts only while j is down when the ship can jump;
// tap / transit = one jump; hold / holdnorep / transithold = the whole
// route; appear = two jumps (the fresh press jumps once more).
//
//   PORT=<server port> node scripts/jump_chain_repro.mjs <scenario> [runs=1]
//     [SYSTEM=nova:130] [REPEAT_MS=50] [DELAY=0 (HTTP delay proxy)]
//     [OUT=<dir>] [WATCH_MS=9000 (after the last arrival)]
//   (from packages/nova, with `PORT=<port> node dist/server.js` running)
//
// Prints one JSON line per run (systems visited, jumps, per arrival: when
// the flash cleared, when j first reached the new simulation, the ship's
// distance from the centre then, and whether / when the next hop began)
// and a final tally. Exit code 1 on console errors.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? '8491');
const SCENARIO = process.argv[2] ?? 'hold';
const RUNS = Number(process.argv[3] ?? '1');
const SYSTEM = process.env.SYSTEM ?? 'nova:130';
const REPEAT_MS = Number(process.env.REPEAT_MS ?? '50');
const DELAY = Number(process.env.DELAY ?? '0');
const WATCH_MS = Number(process.env.WATCH_MS ?? '9000');
const PROXY_PORT = Number(process.env.PROXY_PORT ?? PORT + 1);
const OUT = process.env.OUT ?? path.join(os.tmpdir(), `nova-jump-chain-${process.pid}`);
const CHROME = process.env.CHROME_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCENARIOS = ['tap', 'hold', 'holdnorep', 'transit', 'transithold', 'appear',
    'releasewhite'];
// releasewhite: hold j (auto-repeat) through the first departure, then let
// go RELEASE_MS after the transit screen comes up (cycling through the
// list run by run), with the key events sent without waiting for the
// page, so a release while the page is busy building the new system
// queues behind the repeats before it, as a real keyboard's does.
// RELEASE_FROM=arrival counts RELEASE_MS from the destination going live
// instead (the release then falls in its first, long frame).
const RELEASE_MS = (process.env.RELEASE_MS ?? '400,800,1200,1600,2000,2400')
    .split(',').map(Number);
if (!SCENARIOS.includes(SCENARIO)) {
    console.error(`usage: jump_chain_repro.mjs <${SCENARIOS.join('|')}> [runs]`);
    process.exit(2);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// ---- optional delay proxy (as entry_control_lag.mjs) ---------------------
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

/** In-page recorder: client states, j key events, what reached each
 * simulation bridge, and per-sample the player's jump stage / position. */
function installRecorder() {
    if (new URLSearchParams(location.search).has('jcdebug')) window.__jcDebug = true;
    const rec = window.__jc = { states: [], keys: [], sent: [], samples: [],
        jumpStarts: [] };
    const covering = () => {
        const overlay = window.app?.stage?.getChildByName?.('JumpFadeOverlay');
        return !!overlay && overlay.visible && overlay.alpha > 0;
    };
    const player = () => {
        const world = window.displayWorld;
        if (!world) return undefined;
        for (const entity of world.entities.values()) {
            let isPlayer = false;
            let movement, jump, route;
            for (const [component, value] of entity.components) {
                if (component.name === 'ShipControl') isPlayer = true; // PlayerShipSelector
                else if (component.name === 'MovementState') movement = value;
                else if (component.name === 'JumpSequence') jump = value;
                else if (component.name === 'JumpRouteComponent') route = value;
            }
            if (isPlayer && movement) {
                return {
                    dist: Math.hypot(movement.position.x, movement.position.y),
                    stage: jump?.stage, to: jump?.to,
                    route: route ? [...route.route] : undefined,
                };
            }
        }
        return undefined;
    };
    let lastKind;
    let lastStage;
    let patched;
    window.addEventListener('keydown', e => {
        if (e.code === 'KeyJ') rec.keys.push({ t: performance.now(), ts: e.timeStamp, type: e.repeat ? 'repeat' : 'down' });
    }, true);
    window.addEventListener('keyup', e => {
        if (e.code === 'KeyJ') rec.keys.push({ t: performance.now(), ts: e.timeStamp, type: 'up' });
    }, true);
    setInterval(() => {
        const t = performance.now();
        const state = window.novaClientState?.();
        const system = state?.system?.systemId ?? '';
        const kind = state ? `${state.kind}:${system}` : '';
        if (kind !== lastKind) {
            rec.states.push({ t, kind });
            lastKind = kind;
        }
        const bridge = state?.kind === 'inSpace' ? state.system?.bridge : undefined;
        if (bridge && patched !== bridge) {
            patched = bridge;
            const original = bridge.controlEvents.bind(bridge);
            const forSystem = system;
            bridge.controlEvents = events => {
                const jumpEvents = events.filter(e => e.action === 'hyperjump');
                if (jumpEvents.length) {
                    rec.sent.push({ t: performance.now(), system: forSystem,
                        states: jumpEvents.map(e => String(e.state)),
                        tick: window.novaSim?.pacing?.targetTick });
                }
                return original(events);
            };
        }
        const p = player();
        const stage = p?.stage;
        if (stage !== lastStage) {
            if (stage === 'stopping' || stage === 'aligning') {
                rec.jumpStarts.push({ t, system, to: p.to, dist: p.dist });
            }
            lastStage = stage;
        }
        const overlay = window.app?.stage?.getChildByName?.('JumpFadeOverlay');
        rec.samples.push({ t, kind: state?.kind, system, covering: covering(),
            alpha: overlay ? (overlay.visible ? overlay.alpha : 0) : undefined,
            dist: p?.dist, stage, route: p?.route?.join('>'),
            behind: window.novaSim?.pacing?.behindTicks });
    }, 8);
}

async function waitInSpace(page, systemId, timeout = 180000) {
    const handle = await page.waitForFunction(id => {
        const last = window.__jc.states.at(-1);
        return last?.kind.startsWith('inSpace:')
            && (!id || last.kind === `inSpace:${id}`) && last.t;
    }, { timeout, polling: 10 }, systemId);
    return await handle.jsonValue();
}

/** Holds a key with simulated auto-repeat until `stop()` says so. */
function holdKey(page, code, repeatMs) {
    let stopped = false;
    const done = (async () => {
        await page.keyboard.down(code);
        if (repeatMs > 0) {
            // The OS's initial repeat delay, then a steady repeat.
            await sleep(300);
            while (!stopped) {
                await page.keyboard.down(code); // autoRepeat: event.repeat
                await sleep(repeatMs);
            }
        } else {
            while (!stopped) await sleep(20);
        }
        await page.keyboard.up(code);
    })();
    return { stop: async () => { stopped = true; await done; } };
}

async function tap(page, code, ms) {
    await page.keyboard.down(code);
    await sleep(ms);
    await page.keyboard.up(code);
}

async function oneRun(browser, runIndex) {
    const page = await browser.newPage();
    const errors = [];
    const rec_dbg = [];
    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text());
        if (m.text().startsWith('JCDBG')) rec_dbg.push(`${Date.now()} ${m.text()}`);
        if (process.env.VERBOSE) console.error('[page]', m.type(), m.text().slice(0, 300));
    });
    page.on('pageerror', e => errors.push(String(e)));
    await page.evaluateOnNewDocument(installRecorder);
    await page.goto(`http://localhost:${pagePort}/?reset=1&mute=1&system=${encodeURIComponent(SYSTEM)}${process.env.JCDEBUG ? '&jcdebug=1' : ''}`,
        { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitInSpace(page);
    if (process.env.SPEED2 === '1') {
        // As entry_control_lag.mjs: report Caps Lock the way the game
        // reads it, on every later key event.
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
    await sleep(2500);
    // A 3-hop route through the start system's links, never revisiting.
    const route = await page.evaluate(async start => {
        const data = window.simulationGameData.data.System;
        const hops = [];
        // Never a system already on the route, nor a stacked twin of one
        // (same name: Sol nova:130 / nova:531).
        const seen = new Set([start]);
        const names = new Set([(await data.get(start)).name]);
        let here = start;
        for (let i = 0; i < 3; i++) {
            const links = (await data.get(here)).links;
            let next;
            for (const l of links) {
                const name = (await data.get(l)).name;
                if (!seen.has(l) && !names.has(name)) { next = l; names.add(name); break; }
            }
            if (!next) break;
            hops.push(next);
            seen.add(next);
            here = next;
        }
        return hops;
    }, SYSTEM);
    await tap(page, 'KeyM', 80);
    await page.waitForFunction(() => !!window.novaStarmap?.systemGraph, { timeout: 30000 });
    await sleep(800);
    await page.evaluate(hops => {
        for (const hop of hops) window.novaStarmap.systemGraph.clickSystem(hop, true);
    }, route);
    await sleep(300);
    await tap(page, 'Escape', 80);
    await sleep(800);
    // Out of the no-jump zone.
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => {
        const s = window.__jc.samples.at(-1);
        return s?.dist !== undefined && s.dist > 1300;
    }, { timeout: 30000, polling: 20 });
    await page.keyboard.up('ArrowUp');
    await sleep(400);
    const shotDir = path.join(OUT, `${SCENARIO}_${runIndex}`);
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, '0_route.png') });

    const waitLeave = async from => page.waitForFunction(sys => {
        const last = window.__jc.states.at(-1);
        return !last.kind.startsWith(`inSpace:${sys}`);
    }, { timeout: 90000, polling: 5 }, from);
    const tStart = await page.evaluate(() => performance.now());
    let held;
    let releaseAfter;
    switch (SCENARIO) {
        case 'tap':
            await tap(page, 'KeyJ', 300);
            break;
        case 'hold':
            held = holdKey(page, 'KeyJ', REPEAT_MS);
            break;
        case 'holdnorep':
            held = holdKey(page, 'KeyJ', 0);
            break;
        case 'releasewhite': {
            const cdp = await page.target().createCDPSession();
            const key = type => cdp.send('Input.dispatchKeyEvent', {
                type, key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74,
                nativeVirtualKeyCode: 74,
                ...(type === 'keyDown' ? { text: 'j', unmodifiedText: 'j' } : {}),
                autoRepeat: type === 'keyDown' && repeating,
            }).catch(() => {});
            let repeating = false;
            await key('keyDown');
            repeating = true;
            const repeater = setInterval(() => void key('keyDown'), REPEAT_MS);
            await waitLeave(SYSTEM);
            const releaseMs = RELEASE_MS[runIndex % RELEASE_MS.length];
            if (process.env.RELEASE_FROM === 'arrival') {
                // From the destination going live (the client state turns
                // inSpace, just before its first, long frame): the release
                // is made while the screen is still white.
                await waitInSpace(page, route[0], 90000);
            }
            await sleep(releaseMs);
            clearInterval(repeater);
            void key('keyUp');
            releaseAfter = releaseMs;
            break;
        }
        case 'transit':
        case 'transithold':
        case 'appear': {
            await tap(page, 'KeyJ', 300);
            await waitLeave(SYSTEM);
            if (SCENARIO === 'transit') {
                await tap(page, 'KeyJ', 120);
            } else if (SCENARIO === 'transithold') {
                held = holdKey(page, 'KeyJ', REPEAT_MS);
            } else {
                await waitInSpace(page, route[0], 90000);
                // The new system shows: the player is drawn and the flash
                // is fading or gone.
                await page.waitForFunction(() => {
                    const s = window.__jc.samples.at(-1);
                    return s?.kind === 'inSpace' && s.dist !== undefined
                        && (s.alpha ?? 0) < 1;
                }, { timeout: 90000, polling: 5 });
                await tap(page, 'KeyJ', 150);
            }
            break;
        }
    }
    // Watch until no new arrival for WATCH_MS.
    let lastCount = -1;
    let quietSince = Date.now();
    for (;;) {
        await sleep(250);
        const { count, busy } = await page.evaluate(() => {
            const last = window.__jc.samples.at(-1);
            return {
                count: window.__jc.states.filter(s => s.kind.startsWith('inSpace:')).length,
                // A jump under way (or a transit) is never "quiet": nothing
                // stops a jump once it has begun.
                busy: last?.kind !== 'inSpace' || last?.stage !== undefined,
            };
        });
        if (count !== lastCount || busy) {
            if (count !== lastCount) {
                await page.screenshot({ path: path.join(shotDir, `arrival_${count}.png`) });
            }
            lastCount = count;
            quietSince = Date.now();
        }
        if (Date.now() - quietSince > WATCH_MS) break;
    }
    await held?.stop();
    await sleep(300);
    const rec = await page.evaluate(() => window.__jc);
    await page.screenshot({ path: path.join(shotDir, 'end.png') });
    await page.close();
    fs.writeFileSync(path.join(shotDir, 'rec.json'), JSON.stringify(rec));
    if (rec_dbg.length) fs.writeFileSync(path.join(shotDir, 'debug.log'), rec_dbg.join('\n'));
    return { summary: { ...summarize(rec, tStart, route), releaseAfter }, errors };
}

function summarize(rec, tStart, route) {
    const visits = [];
    for (const s of rec.states) {
        if (s.t >= tStart && s.kind.startsWith('inSpace:')) {
            visits.push({ t: s.t, system: s.kind.slice('inSpace:'.length) });
        }
    }
    const arrivals = visits.map((v, i) => {
        const until = visits[i + 1]?.t ?? Infinity;
        const samples = rec.samples.filter(s => s.t >= v.t && s.t < until
            && s.system === v.system && s.kind === 'inSpace');
        const clear = samples.find(s => !s.covering);
        const firstPlayer = samples.find(s => s.dist !== undefined);
        const sent = rec.sent.filter(e => e.system === v.system && e.t >= v.t && e.t < until);
        const firstSent = sent[0];
        const atSent = firstSent && samples.find(s => s.t >= firstSent.t && s.dist !== undefined);
        const start = rec.jumpStarts.find(j => j.system === v.system && j.t >= v.t && j.t < until);
        const radiusCross = samples.find(s => s.dist !== undefined && s.dist < 1000);
        // The first sample that shows the player with the flash fading
        // (or gone): the destination is drawn.
        const visible = samples.find(s => s.dist !== undefined && (s.alpha ?? 0) < 1);
        // The longest main-thread gap in the first 3 s (the first frame).
        let stall = 0;
        for (let k = 1; k < samples.length && samples[k].t < v.t + 3000; k++) {
            stall = Math.max(stall, samples[k].t - samples[k - 1].t);
        }
        const ups = rec.keys.filter(k => k.type === 'up' && k.t >= (visits[i - 1]?.t ?? 0) && k.t < until);
        return {
            system: v.system,
            firstDist: firstPlayer ? Math.round(firstPlayer.dist) : null,
            clearMs: clear ? Math.round(clear.t - v.t) : null,
            insideRadiusMs: radiusCross ? Math.round(radiusCross.t - v.t) : null,
            jSent: sent.map(e => `${Math.round(e.t - v.t)}:${e.states.join('/')}`).join(' '),
            distAtFirstSent: atSent ? Math.round(atSent.dist) : null,
            nextJumpMs: start ? Math.round(start.t - v.t) : null,
            nextJumpDist: start ? Math.round(start.dist) : null,
            visibleMs: visible ? Math.round(visible.t - v.t) : null,
            stallMs: Math.round(stall),
            // A key-up generated (event.timeStamp) before the destination
            // was visible: the player let go while the screen was white.
            releasedHiddenMs: ups.length && visible
                ? Math.round(ups[0].ts - visible.t) : null,
        };
    });
    return { visited: visits.map(v => v.system), route, jumps: visits.length, arrivals };
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
    userDataDir: path.join(os.tmpdir(), `nova-jump-chain-${process.pid}-${Date.now()}`),
});
const allErrors = [];
const tally = {};
try {
    for (let i = 0; i < RUNS; i++) {
        try {
            const { summary, errors } = await oneRun(browser, i);
            allErrors.push(...errors);
            console.log(JSON.stringify({ scenario: SCENARIO, run: i, ...summary }));
            tally[summary.jumps] = (tally[summary.jumps] ?? 0) + 1;
        } catch (e) {
            console.error(`run ${i} failed:`, e);
            allErrors.push(`run ${i} failed: ${e}`);
            tally.failed = (tally.failed ?? 0) + 1;
        }
    }
} finally {
    await browser.close();
    proxy?.close();
}
console.log(JSON.stringify({ scenario: SCENARIO, repeatMs: REPEAT_MS, delayMs: DELAY,
    speed2: process.env.SPEED2 === '1',
    jumpsTally: tally, out: OUT, consoleErrors: allErrors.length,
    errors: allErrors.slice(0, 10) }));
process.exit(allErrors.length ? 1 : 0);
