/**
 * Headless-Chrome reproduction for #355: looping weapon sounds that keep
 * looping after firing stops, and loops that run out of phase after the
 * tab is hidden and shown again.
 *
 * Audio cannot be heard headless, so this INSTRUMENTS @pixi/sound: it
 * wraps the display's Sound gettable (`displayAssetData.data.Sound`) to
 * learn which Sound object belongs to which sound id, then reports per
 * sound id the number of live @pixi/sound instances, whether each is
 * paused/looping and its playback progress, plus the display's
 * looping-sound bookkeeping (the `LoopingSounds` resource keys). Nothing
 * in the game is changed: it reads only existing window hooks
 * (window.displayWorld, window.displayAssetData) and dispatches the same
 * keyboard events the game listens for.
 *
 * Scenario (player ship: the Raven, nova:164, whose Capacitor Pulse
 * Laser — wëap 146, snd 225 — has the "sound is looped" flag 0x0010):
 *   1. hold Space (firePrimary) 3 s, release, wait 3 s:
 *      a looping fire sound must have NO live instance after release;
 *   2. fire again, then "click off the tab": a real background (a second
 *      page brought to the front, so the game page's document.hidden is
 *      true and visibilitychange fires) plus the window `blur` that
 *      @pixi/sound's auto-pause listens to; hold Space while hidden;
 *      come back (bringToFront + focus), fire once more and release:
 *      there must be at most one live instance per looping sound id while
 *      firing, every loop must cycle its WHOLE sample (loopStart 0 — a
 *      resumed @pixi/sound instance loops only [pause offset, end), the
 *      "different periods" of the report), and none may survive release;
 *   3. spawn NPCs whose stock guns loop, hide the page for HIDDEN_MS
 *      (default 20 s) mid-brawl, show it: same one-instance / whole-period
 *      checks.
 *
 * Not part of the jasmine suite. Run against YOUR OWN server:
 *   PORT=8355 node dist/server.js &          (from packages/nova)
 *   PORT=8355 node scripts/looping_sound_repro.mjs
 * Exit code 0 = no stranded/duplicate loop observed, 1 = observed.
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT ?? '8355';
const SHIP = process.env.SHIP ?? 'nova:164';
const SYSTEM = process.env.SYSTEM ?? 'nova:130';
const CHROME = process.env.CHROME_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HIDDEN_MS = Number(process.env.HIDDEN_MS ?? '20000');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 180000,
    args: ['--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox',
        '--window-size=1280,800',
        // Let the AudioContext run without a user gesture, so instances
        // really progress (and really loop) in headless Chrome.
        '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    userDataDir: path.join(os.tmpdir(), `nova-loop-repro-${process.pid}`),
});

let failed = false;
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)));
    // mute=1 sets volumeAll = 0: instances are still created and still
    // advance, they are just silent.
    await page.goto(`http://localhost:${PORT}/?reset=1&mute=1&ship=${SHIP}`
        + `&system=${SYSTEM}&enter=1`,
        { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction(
        () => window.displayWorld && window.app && window.communicator?.uuid,
        { timeout: 90000 });
    await sleep(4000);

    await page.evaluate(() => {
        const gettable = window.displayAssetData.data.Sound;
        const seen = window.__loopRepro = { sounds: new Map() };
        const getCached = gettable.getCached.bind(gettable);
        gettable.getCached = (id) => {
            const s = getCached(id);
            if (s) {
                seen.sounds.set(id, s);
            }
            return s;
        };
        // Every sound event that reaches the display world, by channel.
        seen.events = [];
        seen.windowEvents = { blur: 0, focus: 0, visibilitychange: 0 };
        for (const name of ['blur', 'focus']) {
            window.addEventListener(name, () => seen.windowEvents[name]++);
        }
        document.addEventListener('visibilitychange',
            () => seen.windowEvents.visibilitychange++);
        // Wrap emit on each display world (the bridge forwards sim events
        // with world.emit; UiSoundEvent is emitted there too).
        seen.wrapped = new WeakSet();
        seen.subscribe = () => {
            const world = window.displayWorld;
            if (!world || seen.wrapped.has(world)) {
                return;
            }
            seen.wrapped.add(world);
            const emit = world.emit.bind(world);
            world.emit = (event, data, ...rest) => {
                if (/SoundEvent$/.test(event?.name ?? '')
                    && (data?.loop || data?.stop)) {
                    seen.events.push(`${event.name}:${data.id}:${
                        data.stop ? 'stop' : 'loop'}`);
                }
                return emit(event, data, ...rest);
            };
        };
        seen.subscribe();
        seen.snapshot = () => {
            seen.subscribe();
            seen.worlds = seen.worlds ?? new WeakMap();
            if (!seen.worlds.has(window.displayWorld)) {
                seen.worlds.set(window.displayWorld,
                    (seen.worldCount = (seen.worldCount ?? 0) + 1));
            }
            const events = {};
            for (const e of seen.events.splice(0)) {
                events[e] = (events[e] ?? 0) + 1;
            }
            let loopMap;
            for (const [key, value] of window.displayWorld.resources) {
                if (key.name === 'LoopingSounds') {
                    loopMap = value;
                }
            }
            const sounds = {};
            let ctxState;
            for (const [id, s] of seen.sounds) {
                ctxState = s.context?.audioContext?.state;
                const live = s.instances.map(i => ({
                    progress: Number(i.progress.toFixed(3)),
                    paused: i.paused, loop: i.loop,
                    // The WebAudio loop region actually playing (the
                    // "period"): @pixi/sound re-plays a resumed instance
                    // with loopStart = where it was paused.
                    loopStart: i._source
                        ? Number(i._source.loopStart.toFixed(3)) : undefined,
                    loopEnd: i._source
                        ? Number(i._source.loopEnd.toFixed(3)) : undefined,
                    duration: i._duration !== undefined
                        ? Number(i._duration.toFixed(3)) : undefined,
                }));
                if (live.length) {
                    sounds[id] = live;
                }
            }
            return {
                displayWorld: seen.worlds.get(window.displayWorld),
                hidden: document.hidden,
                windowEvents: { ...seen.windowEvents },
                loopStopEventsSinceLast: events,
                audioContext: ctxState,
                // LoopingSounds: id -> Sound before #355, a LoopPlayback
                // (its `playing` map) after.
                loopingSoundsKeys: loopMap
                    ? [...(loopMap.playing ?? loopMap).keys()] : null,
                liveInstances: sounds,
            };
        };
    });
    /** Audible looping instances of `id` (not pinned paused). */
    const loops = (snapshot, id) => (snapshot.liveInstances[id] ?? [])
        .filter(i => i.loop && !i.paused);
    /**
     * Looping instances that cycle only the tail of their sample: after
     * a pause/resume @pixi/sound re-plays with loopStart = the pause
     * offset and loopEnd 0, and Chrome then loops [loopStart, end).
     */
    const shortened = snapshot => Object.entries(snapshot.liveInstances)
        .flatMap(([id, list]) => list
            .filter(i => i.loop && !i.paused && i.loopStart > 0.001)
            .map(i => `${id} loops ${i.loopStart}s..${i.duration}s`
                + ` (period ${(i.duration - i.loopStart).toFixed(3)}s`
                + ` of ${i.duration}s)`));
    const snap = async label => {
        const s = await page.evaluate(() => window.__loopRepro.snapshot());
        console.log(label.padEnd(34), JSON.stringify(s));
        return s;
    };
    const key = (type, code) => page.evaluate((t, c) => {
        document.dispatchEvent(new KeyboardEvent(t,
            { code: c, key: c, bubbles: true }));
    }, type, code);
    const loopIds = async () => page.evaluate(() => {
        const ids = [];
        for (const [id, s] of window.__loopRepro.sounds) {
            if (s.instances.some(i => i.loop)) {
                ids.push(id);
            }
        }
        return ids;
    });

    // ── Symptom 1: stop after release ──────────────────────────────
    await snap('baseline');
    await key('keydown', 'Space');
    await sleep(1500);
    const firing = await snap('holding fire 1.5s');
    await sleep(1500);
    const firing3 = await snap('holding fire 3s');
    await key('keyup', 'Space');
    await sleep(500);
    await snap('released 0.5s');
    await sleep(2500);
    const released = await snap('released 3s');
    // The simulation can lag the keyboard by a second in headless Chrome
    // (SwiftShader), and the first shot only starts the sound loading, so
    // take every id that looped at any point while the trigger was held.
    const loopedWhileFiring = [...new Set([firing, firing3].flatMap(
        snapshot => Object.keys(snapshot.liveInstances)
            .filter(id => loops(snapshot, id).length > 0)))];
    if (loopedWhileFiring.length === 0) {
        console.log('NO LOOP STARTED while firing: the check below is '
            + 'vacuous; rerun');
        failed = true;
    }
    console.log('looping ids while firing:', JSON.stringify(loopedWhileFiring));
    const stranded = loopedWhileFiring.filter(
        id => loops(released, id).length > 0);
    console.log(`SYMPTOM 1 (loop survives release): ${stranded.length
        ? 'OBSERVED ' + JSON.stringify(stranded) : 'not observed'}`);
    if (stranded.length) {
        failed = true;
    }

    // ── Symptom 2: hide/show ───────────────────────────────────────
    await key('keydown', 'Space');
    await sleep(1500);
    await key('keyup', 'Space');
    await snap('fired again, released');
    const other = await browser.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    // A real tab switch fires `blur` (what @pixi/sound auto-pauses on);
    // only synthesize one if Chrome did not. Dispatching a second blur
    // would make @pixi/sound remember "paused" as the pre-blur state.
    await page.evaluate(() => {
        if (window.__loopRepro.windowEvents.blur === 0) {
            window.dispatchEvent(new Event('blur'));
        }
    });
    await sleep(500);
    await snap('hidden 0.5s');
    await key('keydown', 'Space');
    await sleep(2000);
    await snap('hidden, holding fire 2s');
    await key('keyup', 'Space');
    await sleep(2000);
    await snap('hidden, released 2s');
    await page.bringToFront();
    await page.evaluate(() => {
        if (window.__loopRepro.windowEvents.focus === 0) {
            window.dispatchEvent(new Event('focus'));
        }
    });
    await sleep(800);
    await snap('shown 0.8s');
    await key('keydown', 'Space');
    await sleep(1500);
    const reshown = await snap('shown, holding fire 1.5s');
    await sleep(300);
    await snap('shown, holding fire 1.8s');
    await key('keyup', 'Space');
    await sleep(3000);
    const after = await snap('shown, released 3s');

    const ids = new Set([...loopedWhileFiring, ...await loopIds()]);
    const duplicated = [...ids].filter(id => loops(reshown, id).length > 1);
    console.log(`several instances of one loop after hide/show: ${
        duplicated.length ? 'OBSERVED ' + JSON.stringify(duplicated.map(
            id => [id, reshown.liveInstances[id]])) : 'not observed'}`);
    const short = shortened(reshown);
    console.log(`SYMPTOM 2 (loop period changed after hide/show): ${
        short.length ? 'OBSERVED ' + JSON.stringify(short) : 'not observed'}`);
    const strandedAfter = [...ids].filter(id => loops(after, id).length > 0);
    console.log(`after hide/show, loop survives release: ${strandedAfter.length
        ? 'OBSERVED ' + JSON.stringify(strandedAfter) : 'not observed'}`);
    if (duplicated.length || short.length || strandedAfter.length) {
        failed = true;
    }

    // ── Phase 3: NPCs with looping weapons, long hidden interval ───
    // NPC fire goes through the same SoundEvent path. Ships whose stock
    // primaries carry the loop flag: Manticore (nova:229, Ionic Particle
    // Cannon), Arachnid (nova:158, Capacitor Pulse Laser), Manta
    // (nova:161, BioRelay Laser), Argosy (nova:205, Hail Chaingun).
    await page.evaluate(() => {
        const world = window.displayWorld;
        let addEnemy;
        for (const [k] of world.events) {
            if (k.name === 'AddEnemyEvent') addEnemy = k;
        }
        for (const id of ['nova:229', 'nova:158', 'nova:161', 'nova:205']) {
            world.emit(addEnemy, { shipId: id });
        }
    });
    await sleep(15000);
    const brawl = await snap('NPC brawl 15s');
    await other.bringToFront();
    await sleep(HIDDEN_MS);
    await snap(`hidden ${HIDDEN_MS / 1000}s during brawl`);
    await page.bringToFront();
    await sleep(1000);
    const back = await snap('shown 1s during brawl');
    await sleep(5000);
    await snap('shown 6s during brawl');
    const multi = Object.keys(back.liveInstances)
        .filter(id => loops(back, id).length > 1);
    const brawlShort = shortened(back);
    console.log(`brawl: ${Object.keys(brawl.liveInstances)
        .filter(id => loops(brawl, id).length).length} looping ids; after `
        + `hide/show: several instances of one loop ${multi.length
            ? 'OBSERVED ' + JSON.stringify(multi) : 'not observed'}, `
        + `loop period changed ${brawlShort.length
            ? 'OBSERVED ' + JSON.stringify(brawlShort) : 'not observed'}`);
    if (multi.length || brawlShort.length) {
        failed = true;
    }
    await other.close();
} finally {
    await browser.close();
}
process.exit(failed ? 1 : 0);
