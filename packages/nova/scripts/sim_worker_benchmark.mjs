/**
 * Headless benchmark of the simulation worker's per-tick workload: a
 * real system world (makeSystem, real game data, its own NPC
 * population) plus a scripted brawl of extra NPC warships, driven the
 * way the browser worker drives it — SimulationBridgeHost.step() (world
 * step + rollback ring snapshot) followed by SimulationBridgeHost
 * .snapshot() (the delta frame for the display) every tick.
 *
 * Reports wall time per phase (world.step, rollback snapshot, frame
 * delta) as mean and tail quantiles, GC counts/time (perf_hooks 'gc'
 * entries) and a GOLDEN HASH of the world-state hash stream: the world
 * is seeded per system id and the scenario is scripted, so the hash
 * stream is a pure function of the code. Identical hashes before and
 * after an optimization prove it is behavior-preserving.
 *
 * Usage (from packages/nova, after `npm run build`):
 *   node scripts/sim_worker_benchmark.mjs
 *   node scripts/sim_worker_benchmark.mjs --system nova:130 --steps 1200 \
 *       --brawlers 12 [--json] [--quiet]
 * Profile:
 *   node --cpu-prof --cpu-prof-dir=/tmp/prof scripts/sim_worker_benchmark.mjs
 */
import fs from 'fs';
import path from 'path';
import { performance, PerformanceObserver } from 'perf_hooks';
import { NovaParse } from 'novaparse';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { hashWorld, fnv1a } from 'nova_ecs/plugins/world_hash';
import { snapshotWorld } from 'nova_ecs/plugins/snapshot_plugin';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { GameDataAggregator } from '../dist/src/server/parsing/game_data_aggregator.js';
import { FilesystemData } from '../dist/src/server/parsing/filesystem_data.js';
import { completeEntity } from '../dist/src/nova_plugin/entity_data_loader.js';
import { makeNpc } from '../dist/src/nova_plugin/npc_plugin.js';
import { makeSystem } from '../dist/src/nova_plugin/make_system.js';
import { GovtComponent } from '../dist/src/nova_plugin/govt_component.js';
import { SimulationBridgeHost } from '../dist/src/communication/simulation_bridge_host.js';

const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
// nova:130 (Sol-ish core system) has a real NPC population; the brawl
// adds two hostile factions of Ravens/Fed Carriers on top.
const SYSTEM_ID = argValue('--system', 'nova:130');
const STEPS = Number(argValue('--steps', '1200'));
const BRAWLERS = Number(argValue('--brawlers', '12'));
const HASH_EVERY = Number(argValue('--hash-every', '300'));
const JSON_OUT = args.includes('--json');
const QUIET = args.includes('--quiet');
/** Skip the frame-delta phase (isolates step + rollback snapshot). */
const NO_FRAME = args.includes('--no-frame');

const packageRoot = process.cwd();

async function getGameData() {
    const novaParse = new NovaParse(path.join(packageRoot, 'Nova_Data'), false);
    novaParse.resourceNotFoundFunction = () => { };
    const aggregator = new GameDataAggregator([
        new FilesystemData(path.join(packageRoot, 'objects')),
        novaParse,
    ], () => { });
    aggregator.getSettings = async (file) => JSON.parse(
        await fs.promises.readFile(path.join(packageRoot, 'settings', file), 'utf8'));
    return aggregator;
}

function quantile(sorted, q) {
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx];
}

function summarize(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const total = samples.reduce((a, b) => a + b, 0);
    return {
        totalMs: +total.toFixed(1),
        meanMs: +(total / samples.length).toFixed(3),
        p50Ms: +quantile(sorted, 0.5).toFixed(3),
        p90Ms: +quantile(sorted, 0.9).toFixed(3),
        p99Ms: +quantile(sorted, 0.99).toFixed(3),
        maxMs: +sorted[sorted.length - 1].toFixed(3),
    };
}

async function main() {
    const gameData = await getGameData();
    const world = await makeSystem(SYSTEM_ID, gameData, 'worker');

    // Two hostile factions (Federation vs Auroran) of stock warships,
    // interleaved in a ring so everyone has an enemy in range at once.
    const factions = [
        { govt: 'nova:128', ships: ['nova:164', 'nova:143'] },
        { govt: 'nova:129', ships: ['nova:164', 'nova:143'] },
    ];
    for (let i = 0; i < BRAWLERS; i++) {
        const faction = factions[i % factions.length];
        const shipId = faction.ships[Math.floor(i / factions.length) % faction.ships.length];
        const shipData = await gameData.data.Ship.get(shipId);
        const npc = makeNpc(shipData);
        npc.components.set(MultiplayerData, { owner: 'server' });
        npc.components.set(GovtComponent, { id: faction.govt });
        await completeEntity(world, npc);
        // Fixed-point ring geometry (no trig: genesis state must not
        // depend on the engine's Math).
        const ring = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]];
        const [dx, dy] = ring[i % ring.length];
        const radius = 400 + 150 * Math.floor(i / ring.length);
        npc.components.set(MovementStateComponent, {
            position: new Position(dx * radius, dy * radius),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        world.entities.set(`brawler-${i}`, npc);
    }

    const host = new SimulationBridgeHost(world, gameData);

    // GC accounting.
    let gcCount = 0, gcMs = 0;
    const gcKinds = new Map();
    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            gcCount++;
            gcMs += entry.duration;
            const kind = entry.detail?.kind ?? entry.kind;
            gcKinds.set(kind, (gcKinds.get(kind) ?? 0) + 1);
        }
    });
    observer.observe({ type: 'gc' });

    // Warm up: providers attach hitboxes/hurtboxes; JIT warms; the
    // first frame (all entities 'added') is not representative.
    for (let i = 0; i < 60; i++) {
        host.step(1);
        host.snapshot();
    }
    gcCount = 0; gcMs = 0; gcKinds.clear();

    const stepMs = new Array(STEPS);
    const frameMs = new Array(STEPS);
    const entityCounts = new Array(STEPS);
    const hashes = [];
    let frameBytes = 0;

    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    for (let i = 0; i < STEPS; i++) {
        const a = performance.now();
        host.step(1);
        const b = performance.now();
        if (!NO_FRAME) {
            const frame = host.snapshot();
            if (i % 60 === 0) {
                frameBytes += JSON.stringify(frame).length;
            }
        }
        const c = performance.now();
        stepMs[i] = b - a;
        frameMs[i] = c - b;
        entityCounts[i] = world.entities.size;
        if ((i + 1) % HASH_EVERY === 0) {
            hashes.push(`${i + 1}:${hashWorld(world).hash}`);
        }
    }
    const totalMs = performance.now() - t0;
    // GC entries are delivered asynchronously; let them land.
    await new Promise(resolve => setTimeout(resolve, 50));
    observer.disconnect();

    // Split the step phase once more, out of band: world.step vs the
    // rollback ring's snapshotWorld on the final state.
    const snapSamples = [];
    for (let i = 0; i < 30; i++) {
        const a = performance.now();
        snapshotWorld(world);
        snapSamples.push(performance.now() - a);
    }

    const finalHash = hashWorld(world).hash;
    hashes.push(`end:${finalHash}`);
    const goldenHash = fnv1a(hashes.join('\n')).toString(16);

    let components = 0;
    for (const [, entity] of world.entities) {
        components += entity.components.size;
    }

    const stats = {
        system: SYSTEM_ID,
        steps: STEPS,
        brawlers: BRAWLERS,
        entities: world.entities.size,
        components,
        peakEntities: Math.max(...entityCounts),
        totalMs: +totalMs.toFixed(1),
        msPerTick: +(totalMs / STEPS).toFixed(3),
        step: summarize(stepMs),
        frame: summarize(frameMs),
        snapshotWorldMs: summarize(snapSamples).meanMs,
        frameBytesPerSampledFrame: Math.round(frameBytes / Math.ceil(STEPS / 60)),
        gcCount,
        gcMs: +gcMs.toFixed(1),
        gcKinds: Object.fromEntries(gcKinds),
        heapDeltaMB: +((process.memoryUsage().heapUsed - heapBefore) / 1e6).toFixed(1),
        goldenHash,
    };

    if (JSON_OUT) {
        console.log(JSON.stringify(stats));
    } else {
        console.log(`system=${stats.system} steps=${stats.steps} brawlers=${stats.brawlers} `
            + `entities=${stats.entities} (peak ${stats.peakEntities}) components=${stats.components}`);
        console.log(`total=${stats.totalMs}ms  ${stats.msPerTick}ms/tick`);
        const s = stats.step, f = stats.frame;
        console.log(`  host.step (world.step + rollback snapshot): mean=${s.meanMs} p50=${s.p50Ms} p90=${s.p90Ms} p99=${s.p99Ms} max=${s.maxMs}`);
        console.log(`  host.snapshot (frame delta):               mean=${f.meanMs} p50=${f.p50Ms} p90=${f.p90Ms} p99=${f.p99Ms} max=${f.maxMs}`);
        console.log(`  snapshotWorld alone (final state, x30):    mean=${stats.snapshotWorldMs}`);
        console.log(`  frame JSON bytes (sampled): ${stats.frameBytesPerSampledFrame}`);
        console.log(`gc: ${stats.gcCount} collections, ${stats.gcMs}ms (${JSON.stringify(stats.gcKinds)}); heap delta ${stats.heapDeltaMB}MB`);
        console.log(`goldenHash=${stats.goldenHash}`);
        if (!QUIET) {
            const worst = stepMs.map((ms, i) => [ms, i])
                .sort((a, b) => b[0] - a[0]).slice(0, 5)
                .map(([ms, i]) => `step ${i}: ${ms.toFixed(2)}ms (${entityCounts[i]} entities)`);
            console.log('worst steps:\n  ' + worst.join('\n  '));
        }
    }
}

await main();
