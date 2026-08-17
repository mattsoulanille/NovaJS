/**
 * Headless-Chrome display micro-benchmark: how much per-frame work the PIXI
 * display list costs. Opens the game (own server on $PORT, swiftshader
 * WebGL), spawns a brawl, then for a window of frames measures
 *   - display objects visited per frame by Container.prototype.render
 *     (every visit is a virtual call + visibility check, even for hidden
 *     objects), split into rendered vs early-return,
 *   - ms per frame in stage.updateTransform() (pure JS, no GPU),
 *   - ms per frame in renderer.render() (JS traversal + batching + GL calls
 *     — GL is SwiftShader here, so treat this as relative only).
 *
 * Usage: PORT=8351 node scripts/display_render_benchmark.mjs
 *        [SYSTEM=nova:130] [SECONDS=20] [BRAWL=1]
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT ?? '8351';
const SECONDS = Number(process.env.SECONDS ?? '20');
const SYSTEM = process.env.SYSTEM ?? 'nova:130';
const BRAWL = process.env.BRAWL !== '0';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 180000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800', '--hide-scrollbars'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    userDataDir: path.join(os.tmpdir(), `nova-render-bench-${process.pid}`),
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)));
await page.goto(`http://localhost:${PORT}/?reset=1&mute=1&ship=nova:164&system=${SYSTEM}&enter=1`, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.displayWorld && window.app && window.communicator?.uuid, { timeout: 90000 });
await new Promise(r => setTimeout(r, 4000));
if (BRAWL) {
    await page.evaluate(() => {
        const world = window.displayWorld;
        let addEnemy;
        for (const [k] of world.events) { if (k.name === 'AddEnemyEvent') addEnemy = k; }
        for (const id of ['nova:164', 'nova:143', 'nova:164', 'nova:146', 'nova:141', 'nova:164']) world.emit(addEnemy, { shipId: id });
    });
    await new Promise(r => setTimeout(r, 4000));
}
await page.evaluate(() => {
    const proto = PIXI.Container.prototype;
    const original = proto.render;
    const stats = window.__renderStats = { visits: 0, skipped: 0, frames: 0, updateTransformMs: 0, renderMs: 0 };
    proto.render = function (renderer) {
        stats.visits++;
        if (!this.visible || this.worldAlpha <= 0 || !this.renderable) stats.skipped++;
        return original.call(this, renderer);
    };
    const renderer = window.app.renderer;
    const originalRender = renderer.render.bind(renderer);
    renderer.render = function (displayObject, options) {
        // Measure updateTransform separately, then the full render (which
        // runs updateTransform again internally; the second run is cheap
        // but included in renderMs, so treat both as upper bounds).
        const t0 = performance.now();
        const cacheParent = displayObject.enableTempParent();
        displayObject.updateTransform();
        displayObject.disableTempParent(cacheParent);
        const t1 = performance.now();
        const result = originalRender(displayObject, options);
        stats.renderMs += performance.now() - t1;
        stats.updateTransformMs += t1 - t0;
        stats.frames++;
        return result;
    };
});
await page.keyboard.down('Space');
await new Promise(r => setTimeout(r, 2000));
await page.evaluate(() => { const s = window.__renderStats; s.visits = 0; s.skipped = 0; s.frames = 0; s.updateTransformMs = 0; s.renderMs = 0; });
await new Promise(r => setTimeout(r, SECONDS * 1000));
await page.keyboard.up('Space');
const s = await page.evaluate(() => {
    const s = window.__renderStats;
    let stageObjects = 0;
    (function walk(c) { stageObjects++; for (const k of c.children ?? []) walk(k); })(window.app.stage);
    return { ...s, stageObjects, entities: window.displayWorld.entities.size };
});
console.log(JSON.stringify({
    system: SYSTEM, seconds: SECONDS, frames: s.frames, fps: +(s.frames / SECONDS).toFixed(1),
    entities: s.entities, stageObjects: s.stageObjects,
    visitsPerFrame: Math.round(s.visits / s.frames), skippedPerFrame: Math.round(s.skipped / s.frames),
    updateTransformMsPerFrame: +(s.updateTransformMs / s.frames).toFixed(3),
    renderMsPerFrame: +(s.renderMs / s.frames).toFixed(3),
}));
await browser.close();
