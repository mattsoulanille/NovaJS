/**
 * Headless-browser check of NPC hypergate traffic (reference "NPC
 * hypergate traffic, wave 60"; nova_plugin/npc/npc_hypergate.ts): a fresh
 * pilot launches in a system with a working hypergate and gövt Flags2
 * 0x0040 traffic (default Koria, nova:483: HG-Koria, the 0x0040 Rebels and
 * Sigma Shipyards), flies over beside the gate (the autopilot, cancelled
 * GATE_PARK px out) and watches the display world for SECONDS:
 *   - every NPC first seen within 60 px of the gate's centre (a ship that
 *     came OUT of it), with its govt and mode;
 *   - every NPC that was in mode 'gate' (flying INTO it) and is gone,
 *     with its last distance from the gate;
 *   - the gate's animation frame (open or closed) at those moments,
 * with a screenshot whenever the gate is open (up to SHOTS of them).
 *
 * Passes (exit 0) when at least one ship came out of the gate, at least
 * one went into it, and the page logged no errors; the govts of the ships
 * that came out are printed (expect only 0x0040 / neither-flag ones).
 *
 *   PORT=<own server port> node scripts/npc_gate_browser.mjs
 *       [SYSTEM=nova:483] [SECONDS=240] [OUT=<dir for screenshots>]
 *       [SHOTS=8] [GATE_PARK=260]
 *   (from packages/nova, with `PORT=<port> node dist/server.js` running)
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT;
if (!PORT) {
    throw new Error('Set PORT to your own server\'s port');
}
const SYSTEM = process.env.SYSTEM ?? 'nova:483';
const SECONDS = Number(process.env.SECONDS ?? '240');
const OUT = process.env.OUT ?? os.tmpdir();
const SHOTS = Number(process.env.SHOTS ?? '8');
const GATE_PARK = Number(process.env.GATE_PARK ?? '260');
const CHROME = process.env.CHROME_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800',
        '--mute-audio'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    userDataDir: path.join(os.tmpdir(), `nova-npc-gate-${process.pid}`),
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

// A sturdy Leviathan, so nothing in the system ends the watch early.
await page.goto(`http://localhost:${PORT}/?reset=1&mute=1&ship=nova:131`
    + `&system=${SYSTEM}&enter=1`, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.displayWorld && window.app
    && window.communicator?.uuid, { timeout: 90000 });
await wait(4000);

/** The page-side census: the gate, the player, every NPC. */
const census = () => page.evaluate(() => {
    const get = (entity, name) => {
        for (const [component, value] of entity.components) {
            if (component.name === name) {
                return value;
            }
        }
        return undefined;
    };
    let gate;
    let player;
    const npcs = [];
    for (const [uuid, entity] of window.displayWorld.entities) {
        const planet = get(entity, 'PlanetData');
        const movement = get(entity, 'MovementState');
        if (planet?.gate?.kind === 'hypergate' && planet.gate.destinations.length > 0
            && movement) {
            const animation = get(entity, 'GateAnimation');
            gate = { uuid, id: planet.id, x: movement.position.x,
                y: movement.position.y, frame: animation?.frame ?? 0,
                mode: animation?.mode };
        }
        const controlled = get(entity, 'ControlledBy');
        if (controlled?.peerId === window.communicator.uuid && movement) {
            player = { uuid, x: movement.position.x, y: movement.position.y };
        }
        const npc = get(entity, 'NpcComponent');
        if (npc && movement) {
            npcs.push({ uuid, govt: get(entity, 'GovtComponent')?.id,
                mode: npc.mode, destination: npc.destination,
                name: entity.name,
                x: movement.position.x, y: movement.position.y });
        }
    }
    return { gate, player, npcs };
});

let state = await census();
if (!state.gate) {
    throw new Error(`no working hypergate in ${SYSTEM}`);
}
console.log(`gate ${state.gate.id} at (${state.gate.x}, ${state.gate.y}); `
    + `${state.npcs.length} NPCs at launch`);

// The watch starts at launch (the ships already in the system that fly
// into the gate do so in the first seconds) while the autopilot flies the
// player over beside the gate; it lets go GATE_PARK px out and brakes, so
// the ship never lands on the gate.
const seen = new Map();      // uuid -> first sample
const last = new Map();      // uuid -> last sample
const outOfGate = [];
const intoGate = [];
let shots = 0;
let lastShot = 0;
for (const npc of state.npcs) {
    const d = Math.hypot(npc.x - state.gate.x, npc.y - state.gate.y);
    seen.set(npc.uuid, { ...npc, d });
    last.set(npc.uuid, { ...npc, d });
}
await page.evaluate(uuid => window.novaAutopilot.navigateTo(uuid),
    state.gate.uuid);
let flying = true;
let brakeUntil = 0;
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
    await wait(200);
    state = await census();
    const { gate } = state;
    if (flying && state.player && Math.hypot(state.player.x - gate.x,
        state.player.y - gate.y) < GATE_PARK) {
        flying = false;
        await page.evaluate(() => window.novaAutopilot.cancel());
        await page.keyboard.down('ArrowDown');
        brakeUntil = Date.now() + 3000;
    }
    if (brakeUntil && Date.now() > brakeUntil) {
        brakeUntil = 0;
        await page.keyboard.up('ArrowDown');
    }
    const live = new Set();
    for (const npc of state.npcs) {
        live.add(npc.uuid);
        const d = Math.hypot(npc.x - gate.x, npc.y - gate.y);
        if (!seen.has(npc.uuid)) {
            seen.set(npc.uuid, { ...npc, d });
            if (d < 60) {
                outOfGate.push({ ...npc, d: Math.round(d) });
                console.log(`OUT  ${npc.name} (${npc.govt}) at ${Math.round(d)} px, `
                    + `mode ${npc.mode}; gate frame ${gate.frame} ${gate.mode}`);
            }
        }
        last.set(npc.uuid, { ...npc, d });
    }
    for (const [uuid, npc] of last) {
        if (!live.has(uuid)) {
            last.delete(uuid);
            if (npc.mode === 'gate' && npc.destination === gate.uuid) {
                intoGate.push({ ...npc, d: Math.round(npc.d) });
                console.log(`INTO ${npc.name} (${npc.govt}), last seen `
                    + `${Math.round(npc.d)} px from the gate; gate frame `
                    + `${gate.frame} ${gate.mode}`);
            }
        }
    }
    if (gate.frame > 0 && shots < SHOTS && Date.now() - lastShot > 1500) {
        const file = path.join(OUT, `npc_gate_${String(shots).padStart(2, '0')}.png`);
        await page.screenshot({ path: file });
        console.log(`shot ${file} (gate frame ${gate.frame} ${gate.mode})`);
        shots++;
        lastShot = Date.now();
    }
}
await page.screenshot({ path: path.join(OUT, 'npc_gate_end.png') });
await browser.close();

const govts = [...new Set(outOfGate.map(n => n.govt))];
console.log(JSON.stringify({ outOfGate: outOfGate.length,
    intoGate: intoGate.length, outGovts: govts, npcsSeen: seen.size,
    errors }));
const ok = outOfGate.length > 0 && intoGate.length > 0 && errors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
