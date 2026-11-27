/**
 * Headless benchmark of the simulation worker in a BIG FIGHT: many
 * warships plus a scripted missile battery that keeps hundreds of guided
 * missiles in flight, and point defense turrets shooting at them. Built
 * for the hot spots a ~735-entity Sol brawl showed in the worker
 * (2026-11-27): the proximity fuse (every fused shot against every
 * collidable), point defense target choice, the asteroid decoy search
 * and SAT polygon recalculation.
 *
 * Driven the way the browser worker drives a world: SimulationBridgeHost
 * .step() (world step + rollback ring snapshot), then .snapshot() (the
 * display delta frame), every tick. Reports ms per tick (mean and tail
 * quantiles), GC, and a GOLDEN HASH of the world-state hash stream: the
 * scenario is scripted (a fixed LCG picks shooters and targets) and the
 * world is seeded per system, so identical hashes before and after a
 * change prove the change is behavior-preserving on this scene.
 *
 * Data:
 *   --data synthetic (default): the checked-in original scenario
 *     (test_fixtures/synthetic; no copyrighted data, runs anywhere).
 *     System Ossory Shoal (nova:130, an asteroid field), Gannet Corsairs
 *     and Heron Wardens, Harrier missiles (patched IN MEMORY to be
 *     decoyed by asteroids, so the decoy search runs) and Flak point
 *     defense.
 *   --data real: the stock files through the parser (Nova_Data must be
 *     linked in; never copied). Sol-ish nova:130, Ravens, Radar Missiles
 *     (nova:135) and the Quad Light Blaster Turret PD (nova:133).
 *
 * Usage (from packages/nova, after `npm run build`):
 *   node scripts/big_fight_benchmark.mjs [--data synthetic|real]
 *       [--system nova:130] [--brawlers 84] [--missiles 260]
 *       [--pd-ships 24] [--steps 600] [--warmup 120]
 *       [--systems]   per-system self time (adds overhead; the headline
 *                     ms/tick of a --systems run is not comparable)
 *       [--json] [--quiet]
 * Profile:
 *   node --cpu-prof --cpu-prof-dir=/tmp/prof scripts/big_fight_benchmark.mjs
 */
import fs from 'fs';
import path from 'path';
import { performance, PerformanceObserver } from 'perf_hooks';
import { NovaParse } from 'novaparse';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { hashWorld, fnv1a } from 'nova_ecs/plugins/world_hash';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { GameDataAggregator } from '../dist/src/server/parsing/game_data_aggregator.js';
import { FilesystemData } from '../dist/src/server/parsing/filesystem_data.js';
import { completeEntity } from '../dist/src/nova_plugin/spawn/entity_data_loader.js';
import { makeNpc } from '../dist/src/nova_plugin/npc/npc_plugin.js';
import { makeSystem } from '../dist/src/nova_plugin/make_system.js';
import { GovtComponent } from '../dist/src/nova_plugin/core/govt_component.js';
import { ProjectileDataComponent } from '../dist/src/nova_plugin/core/projectile_data.js';
import { WeaponEntries } from '../dist/src/nova_plugin/combat/fire_weapon_plugin.js';
import { SimulationBridgeHost } from '../dist/src/communication/simulation_bridge_host.js';

const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const DATA = argValue('--data', 'synthetic');
const PRESETS = {
    synthetic: {
        system: 'nova:130',
        govts: ['nova:128', 'nova:129'],
        ships: ['nova:129', 'nova:130'],
        missile: 'nova:129',
        pointDefense: 'nova:132',
    },
    real: {
        system: 'nova:130',
        govts: ['nova:128', 'nova:129'],
        ships: ['nova:164', 'nova:150', 'nova:141'],
        missile: 'nova:135',
        pointDefense: 'nova:133',
    },
};
const preset = PRESETS[DATA];
if (!preset) {
    throw new Error(`--data must be one of ${Object.keys(PRESETS)}`);
}
const SYSTEM_ID = argValue('--system', preset.system);
const STEPS = Number(argValue('--steps', '600'));
const WARMUP = Number(argValue('--warmup', '120'));
const BRAWLERS = Number(argValue('--brawlers', '84'));
const MISSILES = Number(argValue('--missiles', '260'));
const PD_SHIPS = Number(argValue('--pd-ships', '24'));
/** Missiles the battery may launch per tick (ramps the swarm up). */
const LAUNCH_PER_TICK = Number(argValue('--launch-per-tick', '12'));
/** Ticks between two shots of one scripted PD turret. */
const PD_EVERY = Number(argValue('--pd-every', '6'));
const HASH_EVERY = Number(argValue('--hash-every', '100'));
const JSON_OUT = args.includes('--json');
const QUIET = args.includes('--quiet');
const PER_SYSTEM = args.includes('--systems');

const packageRoot = process.cwd();

function makeGameData() {
    const root = DATA === 'real'
        ? path.join(packageRoot, 'Nova_Data')
        : path.join(packageRoot, 'test_fixtures', 'synthetic');
    const novaParse = new NovaParse(root, false,
        { novaFiles: 'Nova Files', novaPlugins: 'Plug-ins' });
    novaParse.resourceNotFoundFunction = () => { };
    const aggregator = new GameDataAggregator([
        new FilesystemData(path.join(packageRoot, 'objects')),
        novaParse,
    ], () => { });
    aggregator.getSettings = async (file) => JSON.parse(
        await fs.promises.readFile(path.join(packageRoot, 'settings', file), 'utf8'));
    return aggregator;
}

/** A fixed LCG: the scripted battery's choices, identical every run. */
function lcg(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function quantile(sorted, q) {
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx];
}

function summarize(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const total = samples.reduce((a, b) => a + b, 0);
    return {
        meanMs: +(total / samples.length).toFixed(3),
        p50Ms: +quantile(sorted, 0.5).toFixed(3),
        p90Ms: +quantile(sorted, 0.9).toFixed(3),
        p99Ms: +quantile(sorted, 0.99).toFixed(3),
        maxMs: +sorted[sorted.length - 1].toFixed(3),
    };
}

/**
 * Wraps every system's step with SELF-time accounting (time inside
 * nested systems run by emitNow is charged to them, not the caller).
 */
function instrumentSystems(world) {
    const totals = new Map();
    const stack = [];
    for (const system of world.systems) {
        const step = system.step;
        const name = system.name;
        system.step = function (...stepArgs) {
            const start = performance.now();
            stack.push(0);
            try {
                return step.apply(this, stepArgs);
            } finally {
                const elapsed = performance.now() - start;
                const children = stack.pop();
                if (stack.length) {
                    stack[stack.length - 1] += elapsed;
                }
                const entry = totals.get(name) ?? { self: 0, calls: 0 };
                entry.self += elapsed - children;
                entry.calls++;
                totals.set(name, entry);
            }
        };
    }
    return totals;
}

async function main() {
    const gameData = makeGameData();
    const missileData = await gameData.data.Weapon.get(preset.missile);
    if (DATA === 'synthetic') {
        // The Harrier carries no seeker flags; make it decoyable (in
        // memory only) so the asteroid decoy search is exercised.
        missileData.seeker = { ...missileData.seeker, decoyedByAsteroids: true };
    }
    await gameData.data.Weapon.get(preset.pointDefense);
    const world = await makeSystem(SYSTEM_ID, gameData, 'worker');

    const factions = [[], []];
    for (let i = 0; i < BRAWLERS; i++) {
        const side = i % 2;
        const shipId = preset.ships[Math.floor(i / 2) % preset.ships.length];
        const shipData = await gameData.data.Ship.get(shipId);
        const npc = makeNpc(shipData);
        npc.components.set(MultiplayerData, { owner: 'server' });
        npc.components.set(GovtComponent, { id: preset.govts[side] });
        await completeEntity(world, npc);
        // Fixed-point ring geometry (no trig in genesis state).
        const ring = [[1, 0], [0, 1], [-1, 0], [0, -1],
            [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]];
        const [dx, dy] = ring[i % ring.length];
        const radius = 300 + 120 * Math.floor(i / ring.length);
        npc.components.set(MovementStateComponent, {
            position: new Position(dx * radius, dy * radius),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        const uuid = `brawler-${i}`;
        world.entities.set(uuid, npc);
        factions[side].push(uuid);
    }

    const host = new SimulationBridgeHost(world, gameData);
    const weaponEntries = world.resources.get(WeaponEntries);
    weaponEntries.get(preset.missile);
    weaponEntries.get(preset.pointDefense);
    const random = lcg(12345);
    const missileId = preset.missile;

    function liveMissiles() {
        let count = 0;
        for (const [, entity] of world.entities) {
            if (entity.components.get(ProjectileDataComponent)?.id === missileId) {
                count++;
            }
        }
        return count;
    }
    function alive(uuid) {
        return world.entities.has(uuid);
    }
    function pick(list) {
        const live = list.filter(alive);
        return live.length ? live[Math.floor(random() * live.length)] : undefined;
    }
    /** The scripted battery: top the swarm up, fire the PD turrets. */
    function battery(tick) {
        const missile = weaponEntries.getCached(missileId);
        const pd = weaponEntries.getCached(preset.pointDefense);
        if (missile) {
            const want = Math.min(LAUNCH_PER_TICK, MISSILES - liveMissiles());
            for (let n = 0; n < want; n++) {
                const side = Math.floor(random() * 2);
                const shooter = pick(factions[side]);
                const target = pick(factions[1 - side]);
                if (shooter && target) {
                    missile.fireFromEntity(shooter, true, target);
                }
            }
        }
        if (pd) {
            for (let i = 0; i < PD_SHIPS; i++) {
                const side = factions[i % 2];
                const uuid = side[Math.floor(i / 2) % side.length];
                if ((tick + i) % PD_EVERY === 0 && alive(uuid)) {
                    pd.fireFromEntity(uuid);
                }
            }
        }
    }

    let gcCount = 0, gcMs = 0;
    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            gcCount++;
            gcMs += entry.duration;
        }
    });
    observer.observe({ type: 'gc' });

    let tick = 0;
    for (let i = 0; i < WARMUP; i++, tick++) {
        battery(tick);
        host.step(1);
        host.snapshot();
    }
    gcCount = 0; gcMs = 0;
    const systemTotals = PER_SYSTEM ? instrumentSystems(world) : undefined;

    const stepMs = new Array(STEPS);
    const frameMs = new Array(STEPS);
    const entityCounts = new Array(STEPS);
    const missileCounts = [];
    const hashes = [];
    const t0 = performance.now();
    for (let i = 0; i < STEPS; i++, tick++) {
        battery(tick);
        const a = performance.now();
        host.step(1);
        const b = performance.now();
        host.snapshot();
        const c = performance.now();
        stepMs[i] = b - a;
        frameMs[i] = c - b;
        entityCounts[i] = world.entities.size;
        if ((i + 1) % HASH_EVERY === 0) {
            hashes.push(`${i + 1}:${hashWorld(world).hash}`);
            missileCounts.push(liveMissiles());
        }
    }
    const totalMs = performance.now() - t0;
    await new Promise(resolve => setTimeout(resolve, 50));
    observer.disconnect();

    hashes.push(`end:${hashWorld(world).hash}`);
    const goldenHash = fnv1a(hashes.join('\n')).toString(16);
    const tickMs = stepMs.map((s, i) => s + frameMs[i]);
    const stats = {
        data: DATA,
        system: SYSTEM_ID,
        steps: STEPS,
        brawlers: BRAWLERS,
        entities: world.entities.size,
        meanEntities: Math.round(entityCounts.reduce((a, b) => a + b, 0) / STEPS),
        missilesSampled: missileCounts,
        msPerTick: +(totalMs / STEPS).toFixed(3),
        tick: summarize(tickMs),
        step: summarize(stepMs),
        frame: summarize(frameMs),
        gcCount,
        gcMs: +gcMs.toFixed(1),
        goldenHash,
    };
    if (systemTotals) {
        stats.systems = [...systemTotals]
            .sort((p, q) => q[1].self - p[1].self)
            .slice(0, 25)
            .map(([name, { self, calls }]) => ({
                name,
                msPerTick: +(self / STEPS).toFixed(3),
                callsPerTick: +(calls / STEPS).toFixed(1),
            }));
    }

    if (JSON_OUT) {
        console.log(JSON.stringify(stats));
        return;
    }
    console.log(`data=${DATA} system=${SYSTEM_ID} steps=${STEPS} brawlers=${BRAWLERS} `
        + `entities=${stats.entities} (mean ${stats.meanEntities}) missiles sampled=${missileCounts.join(',')}`);
    console.log(`${stats.msPerTick} ms/tick (host.step + host.snapshot)`);
    const t = stats.tick, s = stats.step, f = stats.frame;
    console.log(`  tick:          mean=${t.meanMs} p50=${t.p50Ms} p90=${t.p90Ms} p99=${t.p99Ms} max=${t.maxMs}`);
    console.log(`  host.step:     mean=${s.meanMs} p50=${s.p50Ms} p90=${s.p90Ms} p99=${s.p99Ms} max=${s.maxMs}`);
    console.log(`  host.snapshot: mean=${f.meanMs} p50=${f.p50Ms} p90=${f.p90Ms} p99=${f.p99Ms} max=${f.maxMs}`);
    console.log(`gc: ${stats.gcCount} collections, ${stats.gcMs}ms`);
    console.log(`goldenHash=${stats.goldenHash}`);
    if (stats.systems && !QUIET) {
        console.log('top systems by self time (ms/tick, calls/tick):');
        for (const { name, msPerTick, callsPerTick } of stats.systems) {
            console.log(`  ${msPerTick.toFixed(3).padStart(8)}  ${String(callsPerTick).padStart(7)}  ${name}`);
        }
    }
}

await main();
