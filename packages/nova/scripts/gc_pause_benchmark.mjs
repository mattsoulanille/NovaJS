/**
 * Headless-Chrome main-thread GC benchmark: what the display side leaves
 * for the garbage collector, and how long a full (major) GC pauses.
 *
 * Opens the game (own server on $PORT, swiftshader WebGL), spawns a
 * brawl, plays SECONDS of combat with the trigger held, then
 *   - counts how many Blink-side objects the page created per second
 *     (canvases, 2D contexts, AudioNodes, MessageChannels, WebSockets,
 *     Images, listeners) — every one of these is an Oilpan object whose
 *     pre-finalizer runs on the main thread inside the next major GC,
 *   - reports the JS heap before/after a forced full GC, and
 *   - measures the forced GC's V8/CppGC phases from a DevTools trace
 *     (MajorGC total, CppGC.SweepInvokePreFinalizers — the phase that
 *     was 1.8 s in Matthew's trace of 2026-08-17).
 *
 * Usage: PORT=8377 node scripts/gc_pause_benchmark.mjs
 *        [SYSTEM=nova:130] [SECONDS=20] [BRAWL=1] [MUTE=0]
 *        [HEADFUL=1]       real window, real GPU + audio device
 *        [ALLOC_PROFILE=1] sampled allocation RATE by JS function
 *                          (includes objects the GC already freed)
 *        [SNAPSHOT=1]      heap snapshot; count wrapper classes retained
 *        [LANDINGS=n]      land at PLANET and lift off n times instead
 *                          of brawling (spaceport UI build/teardown)
 *        [LISTENER_CHURN=n | PORT_CHURN=n | AUDIO_CHURN=n]
 *                          inject n/s foreign add/removeEventListener
 *                          pairs, MessageChannels, or one-shot
 *                          AudioBufferSource+Gain plays, to price what
 *                          such churn costs the next major GC
 *
 * Findings, 2026-08-17 (this machine, dev @ faa920a1): 20 s of a
 * six-warship brawl creates ~50-70 AudioNodes/s (one BufferSource + one
 * Gain per sound play, @pixi/sound) and nothing else Oilpan-side; the
 * forced full GC's embedder epilogue (pre-finalizers) is <1 ms headless
 * AND headful, main-thread heap growth is ~1 MB/s. 7,500 injected
 * AudioNode pairs cost 9 ms; 15,000 MessagePorts 12 ms; 33,000 dead
 * listeners 0 ms of pre-finalizers but +4 MB/s of old-space growth
 * (a removed listener's closure stays reachable from Blink until the
 * next full GC). Matthew's 1.8 s MajorGC (traces/major_gc.gz) was
 * 1807 ms of CppGC.SweepInvokePreFinalizers with the React DevTools
 * content script (proxy.js) in a connect/disconnect loop at ~2,200
 * listeners/s; none of the game's own object churn reproduces it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT ?? '8377';
const SECONDS = Number(process.env.SECONDS ?? '20');
const SYSTEM = process.env.SYSTEM ?? 'nova:130';
const BRAWL = process.env.BRAWL !== '0';
const MUTE = process.env.MUTE === '1';
const SNAPSHOT = process.env.SNAPSHOT === '1';
// Simulate a foreign add/removeEventListener churn (a misbehaving
// extension) at this many listeners per second, to see what dead JS
// listeners cost the next major GC. 0 = off.
const LISTENER_CHURN = Number(process.env.LISTENER_CHURN ?? '0');
// Simulate a foreign MessageChannel churn (ports per second). 0 = off.
const PORT_CHURN = Number(process.env.PORT_CHURN ?? '0');
// Simulate extra one-shot sound plays (AudioBufferSourceNode + GainNode
// each, like @pixi/sound) at this many per second. 0 = off.
const AUDIO_CHURN = Number(process.env.AUDIO_CHURN ?? '0');
// Land at PLANET and lift off again this many times during the window
// (each landing builds the spaceport UI: hundreds of PIXI.Text canvases).
const LANDINGS = Number(process.env.LANDINGS ?? '0');
const PLANET = process.env.PLANET ?? 'planet nova:128';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT ?? path.join(os.tmpdir(), `nova-gc-bench-${process.pid}`);
fs.mkdirSync(OUT, { recursive: true });

// HEADFUL=1 opens a real window on the real GPU and audio device: what
// the pre-finalizers of GPU-backed canvases / WebGL objects / AudioNodes
// cost there, which swiftshader + the fake audio sink can't show.
const HEADFUL = process.env.HEADFUL === '1';
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: !HEADFUL, protocolTimeout: 300000,
    args: [...(HEADFUL ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
        '--no-sandbox', '--window-size=1280,800', '--hide-scrollbars',
        '--autoplay-policy=no-user-gesture-required',
        '--js-flags=--expose-gc'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    userDataDir: path.join(os.tmpdir(), `nova-gc-bench-profile-${process.pid}`),
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)));
const cdp = await page.target().createCDPSession();

// Count Blink object construction from the page's very first script, so
// the title screen and asset loading are included in the "before" bucket
// and only combat lands in the measured window.
await page.evaluateOnNewDocument(() => {
    const counts = window.__blinkCounts = {};
    const bump = k => { counts[k] = (counts[k] ?? 0) + 1; };
    const wrapCtor = (name) => {
        const Orig = window[name];
        if (!Orig) return;
        const Wrapped = new Proxy(Orig, {
            construct(target, args, newTarget) {
                bump(name);
                return Reflect.construct(target, args, newTarget);
            },
        });
        window[name] = Wrapped;
    };
    for (const n of ['MessageChannel', 'WebSocket', 'Image', 'Worker', 'Audio',
        'OffscreenCanvas', 'ImageData', 'Path2D', 'AbortController',
        'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
        'XMLHttpRequest', 'FontFace', 'Blob', 'AudioContext']) wrapCtor(n);
    const origCreate = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, ...rest) {
        bump('createElement:' + String(tag).toLowerCase());
        return origCreate.call(this, tag, ...rest);
    };
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        const ctx = origGetContext.call(this, type, ...rest);
        if (ctx && !this.__ctxCounted) { this.__ctxCounted = true; bump('canvas.getContext:' + type); }
        return ctx;
    };
    const wrapMethod = (proto, name, label) => {
        const orig = proto[name];
        if (!orig) return;
        proto[name] = function (...args) { bump(label ?? name); return orig.apply(this, args); };
    };
    if (window.BaseAudioContext) {
        for (const m of ['createBufferSource', 'createGain', 'createPanner', 'createStereoPanner',
            'createAnalyser', 'createBiquadFilter', 'createScriptProcessor', 'createOscillator',
            'createDynamicsCompressor', 'createConvolver', 'createDelay', 'createChannelSplitter',
            'createChannelMerger', 'createWaveShaper', 'decodeAudioData']) {
            wrapMethod(BaseAudioContext.prototype, m, 'audio.' + m);
        }
    }
    // WebGLObjects, canvases/contexts, MessagePorts, AudioNodes and
    // ScriptPromiseResolvers are the Oilpan classes with pre-finalizers.
    for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!Ctx) continue;
        for (const m of Object.getOwnPropertyNames(Ctx.prototype)) {
            if (/^(create|delete)[A-Z]/.test(m)) wrapMethod(Ctx.prototype, m, 'gl.' + m);
        }
    }
    if (window.BaseAudioContext) {
        for (const m of ['resume', 'suspend', 'close']) wrapMethod(BaseAudioContext.prototype, m, 'audio.' + m);
        wrapMethod(AudioContext.prototype, 'resume', 'audio.resume');
        wrapMethod(AudioContext.prototype, 'suspend', 'audio.suspend');
    }
    wrapMethod(HTMLImageElement.prototype, 'decode', 'img.decode');
    wrapMethod(Blob.prototype, 'arrayBuffer', 'blob.arrayBuffer');
    wrapMethod(Blob.prototype, 'text', 'blob.text');
    if (window.Response) for (const m of ['arrayBuffer', 'json', 'text', 'blob']) wrapMethod(Response.prototype, m, 'response.' + m);
    if (window.FontFaceSet) wrapMethod(FontFaceSet.prototype, 'load', 'fonts.load');
    wrapMethod(EventTarget.prototype, 'addEventListener', 'addEventListener');
    wrapMethod(EventTarget.prototype, 'removeEventListener', 'removeEventListener');
    wrapMethod(window, 'createImageBitmap', 'createImageBitmap');
    wrapMethod(window, 'fetch', 'fetch');
    wrapMethod(window, 'setTimeout', 'setTimeout');
    wrapMethod(window, 'requestAnimationFrame', 'requestAnimationFrame');
    wrapMethod(URL, 'createObjectURL', 'URL.createObjectURL');
});

const url = `http://localhost:${PORT}/?reset=1${MUTE ? '&mute=1' : ''}&ship=nova:164&system=${SYSTEM}&enter=1`;
await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
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

const snapshotCounts = () => page.evaluate(() => ({ ...window.__blinkCounts }));
const heapUsed = () => page.evaluate(() => performance.memory.usedJSHeapSize);

// Settle: full GC so the measured window starts from a clean old space.
await cdp.send('HeapProfiler.collectGarbage');
await new Promise(r => setTimeout(r, 500));
const heapStart = await heapUsed();
const before = await snapshotCounts();
// Sampling allocation profile of the window, INCLUDING objects that the
// GC already discarded: this attributes the allocation RATE (churn), not
// just what is retained.
const ALLOC_PROFILE = process.env.ALLOC_PROFILE === '1';
if (ALLOC_PROFILE) {
    await cdp.send('HeapProfiler.startSampling', {
        samplingInterval: 8192,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
    });
}
await page.keyboard.down('Space');
if (LISTENER_CHURN > 0 || PORT_CHURN > 0 || AUDIO_CHURN > 0) {
    await page.evaluate((perSec, portsPerSec, audioPerSec) => {
        let ctx, buffer;
        if (audioPerSec > 0) {
            ctx = new AudioContext();
            buffer = ctx.createBuffer(1, ctx.sampleRate / 10, ctx.sampleRate);
        }
        window.__churn = setInterval(() => {
            for (let i = 0; i < audioPerSec / 100; i++) {
                const src = ctx.createBufferSource();
                const gain = ctx.createGain();
                src.buffer = buffer;
                src.connect(gain); gain.connect(ctx.destination);
                src.onended = () => { src.disconnect(); gain.disconnect(); };
                src.start();
            }
            for (let i = 0; i < perSec / 100; i++) {
                const handler = () => { void i; };
                window.addEventListener('message', handler);
                window.removeEventListener('message', handler);
            }
            for (let i = 0; i < portsPerSec / 100; i++) {
                const ch = new MessageChannel();
                ch.port1.onmessage = () => { void i; };
                ch.port2.postMessage(1);
                ch.port1.close(); ch.port2.close();
            }
        }, 10);
    }, LISTENER_CHURN, PORT_CHURN, AUDIO_CHURN);
}
const t0 = Date.now();
if (LANDINGS > 0) {
    for (let i = 0; i < LANDINGS; i++) {
        await page.evaluate(planet => window.novaAutopilot.navigateTo(planet), PLANET);
        await page.waitForFunction(() => document.body.classList.contains('nova-docked'), { timeout: 120000 });
        await new Promise(r => setTimeout(r, 1500));
        // Depart (KeyD is the spaceport's depart control); an arrival
        // popup / news dialog may need dismissing first, so keep tapping.
        for (let tries = 0; tries < 20; tries++) {
            // Dismiss whatever popup is up (mission offer, news), then leave.
            const target = await page.evaluate(() => {
                const wanted = ['Button:Refuse', 'Button:OK', 'Button:Done', 'Button:Leave'];
                const found = new Map();
                (function walk(c) {
                    if (c.name && c.worldVisible && wanted.includes(c.name) && !found.has(c.name)) found.set(c.name, c);
                    for (const k of c.children ?? []) walk(k);
                })(window.app.stage);
                for (const w of wanted) {
                    const c = found.get(w);
                    if (c) { const b = c.getBounds(); return { name: w, x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
                }
                return undefined;
            });
            if (target) {
                await page.mouse.click(target.x, target.y);
            } else {
                await page.keyboard.press('KeyD');
            }
            await new Promise(r => setTimeout(r, 1000));
            if (!await page.evaluate(() => document.body.classList.contains('nova-docked'))) break;
        }
        if (await page.evaluate(() => document.body.classList.contains('nova-docked'))) {
            await page.screenshot({ path: path.join(OUT, 'stuck_docked.png') });
            throw new Error('could not leave the spaceport; see stuck_docked.png');
        }
        await new Promise(r => setTimeout(r, 2500));
    }
} else {
    await new Promise(r => setTimeout(r, SECONDS * 1000));
}
const elapsed = (Date.now() - t0) / 1000;
await page.keyboard.up('Space');
await page.evaluate(() => { if (window.__churn) clearInterval(window.__churn); });
const after = await snapshotCounts();
const heapEnd = await heapUsed();
let allocReport = '';
if (ALLOC_PROFILE) {
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    fs.writeFileSync(path.join(OUT, 'alloc.heapprofile'), JSON.stringify(profile));
    const bySelf = new Map(), byIncl = new Map();
    let grand = 0;
    const key = cf => `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\//, '')}:${cf.lineNumber + 1}`;
    (function walk(n, stack) {
        grand += n.selfSize;
        const k = key(n.callFrame);
        bySelf.set(k, (bySelf.get(k) ?? 0) + n.selfSize);
        let total = n.selfSize;
        for (const c of n.children) total += walk(c, stack.concat([k]));
        if (!stack.includes(k)) byIncl.set(k, (byIncl.get(k) ?? 0) + total);
        return total;
    })(profile.head, []);
    const fmt = b => (b / 1048576 / elapsed).toFixed(2).padStart(7) + 'MB/s';
    allocReport += `Allocation rate (sampled, incl. collected): ${fmt(grand)} total\n  top self:\n`;
    for (const [k, v] of [...bySelf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) allocReport += `    ${fmt(v)} ${(100 * v / grand).toFixed(1).padStart(5)}%  ${k}\n`;
    allocReport += '  top inclusive:\n';
    for (const [k, v] of [...byIncl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) allocReport += `    ${fmt(v)} ${(100 * v / grand).toFixed(1).padStart(5)}%  ${k}\n`;
}

// Trace the forced full GC.
await page.tracing.start({
    path: path.join(OUT, 'gc_trace.json'),
    categories: ['disabled-by-default-v8.gc', 'v8', 'blink_gc', 'disabled-by-default-cppgc',
        'devtools.timeline', 'disabled-by-default-devtools.timeline'],
});
const tGc0 = Date.now();
await cdp.send('HeapProfiler.collectGarbage');
const gcWall = Date.now() - tGc0;
await new Promise(r => setTimeout(r, 300));
await page.tracing.stop();
const heapAfterGc = await heapUsed();

const trace = JSON.parse(fs.readFileSync(path.join(OUT, 'gc_trace.json'), 'utf8'));
const events = trace.traceEvents ?? trace;
const byName = new Map();
for (const ev of events) {
    if (ev.ph !== 'X' || typeof ev.dur !== 'number') continue;
    if (!/GC|Gc|cppgc|CppGC/.test(ev.name)) continue;
    const cur = byName.get(ev.name) ?? { count: 0, dur: 0, max: 0 };
    cur.count++; cur.dur += ev.dur; cur.max = Math.max(cur.max, ev.dur);
    byName.set(ev.name, cur);
}
const phases = ['MajorGC', 'V8.GCFinalizeMC', 'V8.GC_MARK_COMPACTOR', 'V8.GC_MC_MARK',
    'V8.GC_MC_SWEEP', 'V8.GC_MC_EVACUATE', 'V8.GC_HEAP_EMBEDDER_TRACING_EPILOGUE',
    'CppGC.AtomicMark', 'CppGC.AtomicWeak', 'CppGC.AtomicSweep', 'CppGC.SweepInvokePreFinalizers',
    'CppGC.IncrementalSweep', 'V8.GC_HEAP_EXTERNAL_WEAK_GLOBAL_HANDLES',
    'V8.GC_HEAP_EXTERNAL_SECOND_PASS_CALLBACKS'];

const rate = {};
for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[k] ?? 0) - (before[k] ?? 0);
    if (d > 0) rate[k] = d;
}
const sorted = Object.entries(rate).sort((a, b) => b[1] - a[1]);

console.log(`\n== ${SECONDS}s of ${BRAWL ? 'brawl' : 'idle'} combat in ${SYSTEM}${MUTE ? ' (muted)' : ''}`);
console.log(`JS heap: start ${(heapStart / 1e6).toFixed(1)}MB, end ${(heapEnd / 1e6).toFixed(1)}MB `
    + `(+${((heapEnd - heapStart) / 1e6 / elapsed).toFixed(2)}MB/s), after forced GC ${(heapAfterGc / 1e6).toFixed(1)}MB`);
console.log(`forced full GC wall: ${gcWall}ms`);
for (const p of phases) {
    const v = byName.get(p);
    if (v) console.log(`  ${p.padEnd(45)} n=${String(v.count).padStart(3)} total=${(v.dur / 1000).toFixed(1).padStart(8)}ms max=${(v.max / 1000).toFixed(1)}ms`);
}
if (allocReport) console.log(allocReport);
console.log('Blink object constructions during the window (per second):');
for (const [k, v] of sorted.slice(0, 30)) console.log(`  ${k.padEnd(40)} ${(v / elapsed).toFixed(1).padStart(8)}/s  (${v})`);

if (SNAPSHOT) {
    // Heap snapshot: count retained wrapper objects by class name.
    const chunks = [];
    cdp.on('HeapProfiler.addHeapSnapshotChunk', m => chunks.push(m.chunk));
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    const snap = JSON.parse(chunks.join(''));
    const meta = snap.snapshot.meta;
    const nf = meta.node_fields;
    const nameIdx = nf.indexOf('name'), typeIdx = nf.indexOf('type'), sizeIdx = nf.indexOf('self_size');
    const types = meta.node_types[typeIdx];
    const nodes = snap.nodes, strings = snap.strings;
    const stride = nf.length;
    const classes = new Map();
    for (let i = 0; i < nodes.length; i += stride) {
        const type = types[nodes[i + typeIdx]];
        if (type !== 'object' && type !== 'native') continue;
        const name = strings[nodes[i + nameIdx]];
        const c = classes.get(name) ?? { n: 0, bytes: 0 };
        c.n++; c.bytes += nodes[i + sizeIdx];
        classes.set(name, c);
    }
    console.log('Heap snapshot: top object classes by count');
    for (const [k, v] of [...classes.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) {
        console.log(`  ${k.slice(0, 50).padEnd(50)} ${String(v.n).padStart(8)}  ${(v.bytes / 1e6).toFixed(2)}MB`);
    }
    fs.writeFileSync(path.join(OUT, 'heap.heapsnapshot'), chunks.join(''));
}
console.log(`artifacts in ${OUT}`);
await browser.close();
