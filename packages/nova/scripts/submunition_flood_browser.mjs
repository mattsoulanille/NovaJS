/**
 * Headless-browser check of a submunition flood (the hub's
 * SUBMUNITION_OOM): a Raven armed with N Alternate Missles "DVrger
 * missile" launchers (oütf 539, wëap 298: one shot = 1 + 36 + 72
 * projectiles) holds its secondary trigger on a few spawned ships, and
 * every few seconds the page is sampled after a forced GC:
 *   - the JS heap (performance.memory, --enable-precise-memory-info),
 *   - projectiles in the display world (all, and the DVrger family),
 *   - the geometries the PIXI renderer still manages (a rendered Graphics
 *     that is never destroyed stays in that table for good),
 *   - frame intervals (p50 / max).
 * Optionally (`MAPKEYS=1`) it peeks the `h` minimap and opens / closes the
 * `m` star map each sample: both build fresh SystemGraphs, whose dot layer
 * is the 646-circle Graphics the OOM pause was building.
 *
 * Passes (exit 0) when the display world never holds more projectiles,
 * beams or ships than the server's engine limits allow (RULE, the rule the
 * server runs: NOVA_ROOM_LIMITS / settings/server.json; core/
 * engine_limits.ts; a small allowance for a frame in flight), the heap
 * after GC grows less than HEAP_SLACK_MB from the first sample to the
 * last, and the page logged no errors.
 *
 * OUTFITS replaces the launchers with any loadout, e.g. Matthew's friend's
 * 100 Vell-os Javelins (a bay of fighters with three beams each):
 *   OUTFITS='[["Advanced Vell-os Beams:405",1],["Advanced Vell-os Beams:404",100]]'
 *
 *   PORT=<own server port> node scripts/submunition_flood_browser.mjs
 *       [LAUNCHERS=16] [SECONDS=90] [SYSTEM=nova:483] [MAPKEYS=1]
 *       [OUT=<dir for screenshots>] [HEAP_SLACK_MB=25]
 *       [RULE=novajs|original] [OUTFITS=<json>] [SHIP=nova:164]
 *   (from packages/nova, with `PORT=<port> node dist/server.js` running;
 *   needs the plug-ins in Nova_Data)
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { ENGINE_LIMITS } from '../dist/src/nova_plugin/core/engine_limits.js';

const PORT = process.env.PORT;
if (!PORT) {
    throw new Error('Set PORT to your own server\'s port');
}
const LAUNCHERS = Number(process.env.LAUNCHERS ?? '16');
const SECONDS = Number(process.env.SECONDS ?? '90');
const SYSTEM = process.env.SYSTEM ?? 'nova:483';
const OUT = process.env.OUT ?? os.tmpdir();
const HEAP_SLACK_MB = Number(process.env.HEAP_SLACK_MB ?? '25');
const RULE = process.env.RULE ?? 'novajs';
const LIMITS = ENGINE_LIMITS[RULE];
const OUTFITS = process.env.OUTFITS ? JSON.parse(process.env.OUTFITS)
    : [['Alternate Missles:539', LAUNCHERS]];
const SHIP = process.env.SHIP ?? 'nova:164';
const CHROME = process.env.CHROME_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800',
        '--mute-audio', '--enable-precise-memory-info',
        '--js-flags=--expose-gc'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    userDataDir: path.join(os.tmpdir(), `nova-submun-flood-${process.pid}`),
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
page.on('console', m => {
    if (m.type() === 'error') {
        errors.push(m.text().slice(0, 300));
    }
});
const wait = ms => new Promise(r => setTimeout(r, ms));
async function boot(url) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction(() => window.displayWorld && window.app
        && window.communicator?.uuid, { timeout: 90000 });
    await wait(4000);
}
async function tap(code) {
    await page.keyboard.down(code);
    await wait(60);
    await page.keyboard.up(code);
}

// A fresh pilot, then the save rewritten to carry only the launchers. It
// is written before the reloaded page's scripts run: the unloading page
// saves on its way out and would clobber an edit made now.
await boot(`http://localhost:${PORT}/?reset=1&mute=1&ship=${SHIP}`
    + `&system=${SYSTEM}&enter=1`);
const edited = await page.evaluate(outfits => {
    window.novaSaveNow();
    const save = JSON.parse(localStorage.getItem('novajs:save'));
    save.data.outfits = outfits;
    return JSON.stringify(save);
}, OUTFITS);
await page.evaluateOnNewDocument(
    s => localStorage.setItem('novajs:save', s), edited);
await boot(`http://localhost:${PORT}/?mute=1&enter=1`);

await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.app.ticker.add(() => {
        const now = performance.now();
        window.__frames.push(now - last);
        last = now;
    });
    const world = window.displayWorld;
    let addEnemy;
    for (const [event] of world.events) {
        if (event.name === 'AddEnemyEvent') {
            addEnemy = event;
        }
    }
    for (const id of ['nova:143', 'nova:143', 'nova:146']) {
        world.emit(addEnemy, { shipId: id });
    }
});
await wait(3000);

async function sample() {
    return page.evaluate(() => {
        window.gc?.();
        const world = window.displayWorld;
        let projectiles = 0;
        let dvrg = 0;
        let beams = 0;
        let ships = 0;
        for (const entity of world.entities.values()) {
            for (const [component, value] of entity.components) {
                if (component.name === 'BeamData') {
                    beams++;
                }
                if (component.name === 'Ship') {
                    ships++;
                }
                if (component.name === 'Projectile') {
                    projectiles++;
                    if (String(value.id).startsWith('Alternate Missles:')) {
                        dvrg++;
                    }
                }
            }
        }
        const frames = window.__frames.splice(0).sort((a, b) => a - b);
        return {
            heapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1),
            entities: world.entities.size, projectiles, dvrg, beams, ships,
            managedGeometries: Object.keys(
                window.app.renderer.geometry.managedGeometries).length,
            frames: frames.length,
            p50Ms: +(frames[Math.floor(frames.length / 2)] ?? 0).toFixed(1),
            p90Ms: +(frames[Math.floor(frames.length * 0.9)] ?? 0).toFixed(1),
            maxMs: +(frames[frames.length - 1] ?? 0).toFixed(1),
        };
    });
}

// Prime the weapon list with a primary shot, select the launcher, hold
// the secondary trigger and keep re-targeting the nearest ship.
await tap('Space');
await tap('KeyW');
const samples = [];
const t0 = Date.now();
await page.keyboard.down('ShiftLeft');
let shot = 0;
while (Date.now() - t0 < SECONDS * 1000) {
    await tap('KeyR');
    await wait(4000);
    if (process.env.MAPKEYS) {
        await tap('KeyH');
        await wait(2500);
        await tap('KeyM');
        await wait(1500);
        await tap('KeyM');
        await wait(500);
    }
    const s = { t: Math.round((Date.now() - t0) / 1000), ...await sample() };
    samples.push(s);
    console.log(JSON.stringify(s));
    if (shot < 2 && (s.dvrg > 0 || s.beams > 0)) {
        await page.screenshot({
            path: path.join(OUT, `submunition_flood_${PORT}_${shot++}.png`),
        });
    }
}
await page.keyboard.up('ShiftLeft');
await wait(8000);
const after = await sample();
console.log('after', JSON.stringify(after));
await browser.close();

const peak = Math.max(...samples.map(s => s.projectiles));
const peakBeams = Math.max(...samples.map(s => s.beams));
const peakShips = Math.max(...samples.map(s => s.ships));
const fired = samples.some(s => s.dvrg > 0 || s.beams > 0);
const growth = samples[samples.length - 1].heapMB - samples[0].heapMB;
const ok = fired && peak <= LIMITS.shots.hard + 8
    && peakBeams <= LIMITS.beams.hard + 8 && peakShips <= LIMITS.ships.total + 2
    && growth < HEAP_SLACK_MB && errors.length === 0;
console.log(JSON.stringify({
    ok, rule: RULE, fired, peakProjectiles: peak, peakBeams, peakShips,
    heapGrowthMB: +growth.toFixed(1), errors: errors.slice(0, 10),
}));
process.exit(ok ? 0 : 1);
