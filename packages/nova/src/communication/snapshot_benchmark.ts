/**
 * Benchmark for the per-frame simulation -> display sync pipeline.
 *
 * Measures each stage of what happens every frame when the simulation
 * runs in a worker:
 *   1. world.step()            (simulation cost)
 *   2. host.snapshot()         (io-ts encode of every entity)
 *   3. structuredClone(frame)  (what Comlink pays to postMessage the frame)
 *   4. serializer.decode(...)  (display-side decode of every entity)
 *
 * Run from packages/nova after `npm run build`:
 *   node dist/src/communication/snapshot_benchmark.js [npcCount] [iterations]
 */
import { isLeft } from "fp-ts/lib/Either.js";
import { MockCommunicator } from "nova_ecs/plugins/mock_communicator";
import { multiplayer, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { World } from "nova_ecs/world";
import { v4 } from "uuid";
import { makeNpc } from "../nova_plugin/npc/npc_plugin.js";
import { makeShip } from "../nova_plugin/ship/make_ship.js";
import { makeSystem } from "../nova_plugin/make_system.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import { SimulationBridgeHost } from "./simulation_bridge_host.js";
import { SimulationFrame } from "./simulation_frame.js";
import { getIntegrationGameData } from "./simulation_test_fixture.js";

const npcCount = Number(process.argv[2] ?? 30);
const iterations = Number(process.argv[3] ?? 240);
const warmupSteps = Number(process.argv[4] ?? 300);
const useMultiplayer = process.argv[5] !== 'nomp';

function stats(samples: number[]) {
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    return { mean, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]! };
}

function row(name: string, samples: number[]) {
    const { mean, p50, p95, max } = stats(samples);
    const fmt = (n: number) => n.toFixed(3).padStart(8);
    console.log(`${name.padEnd(18)} mean${fmt(mean)}  p50${fmt(p50)}  p95${fmt(p95)}  max${fmt(max)}`);
}

async function settle(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        // Let AsyncSystem / ProvideAsync promises resolve between steps.
        await new Promise(resolve => setImmediate(resolve));
    }
}

async function main() {
    const gameData = await getIntegrationGameData();
    const ids = await gameData.ids;
    const systemId = [...ids.System].sort()[0]!;
    const shipIds = [...ids.Ship].sort().slice(0, 5);

    const world = await makeSystem(systemId, gameData);
    if (useMultiplayer) {
        const communicator = new MockCommunicator("server");
        await world.addPlugin(multiplayer(communicator));
    }

    const playerShipData = await gameData.data.Ship.get(shipIds[0]!);
    const player = makeShip(playerShipData);
    player.components.set(MultiplayerData, { owner: "server" });
    player.components.set(PlayerShipSelector, undefined);
    world.entities.set(v4(), player);

    for (let i = 0; i < npcCount; i++) {
        const shipData = await gameData.data.Ship.get(shipIds[i % shipIds.length]!);
        const npc = makeNpc(shipData);
        npc.components.set(MultiplayerData, { owner: "server" });
        world.entities.set(v4(), npc);
    }

    const serializer = world.resources.get(SerializerResource);
    if (!serializer) {
        throw new Error("Expected serializer resource");
    }
    const host = new SimulationBridgeHost(world, gameData);

    console.log(`system=${systemId} npcs=${npcCount} warmup=${warmupSteps} iterations=${iterations}`);
    await settle(world, warmupSteps);
    console.log(`entities after warmup: ${world.entities.size}`);

    const stepTimes: number[] = [];
    const encodeTimes: number[] = [];
    const cloneTimes: number[] = [];
    const decodeTimes: number[] = [];
    const totalTimes: number[] = [];
    const frameSizes: number[] = [];
    const changedCounts: number[] = [];

    // Prime the delta tracker so measurements reflect steady-state deltas,
    // not the initial full snapshot.
    host.snapshot();

    for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        host.step();
        const t1 = performance.now();
        const frame: SimulationFrame = host.snapshot();
        const t2 = performance.now();
        const cloned = structuredClone(frame);
        const t3 = performance.now();
        for (const [, encoded] of cloned.added) {
            const decoded = serializer.decode(encoded);
            if (isLeft(decoded)) {
                throw new Error("Failed to decode entity in benchmark");
            }
        }
        for (const [, delta] of cloned.changed) {
            for (const [componentName, encoded] of delta.changed) {
                const decoded = serializer.decodeComponent(componentName, encoded);
                if (decoded && isLeft(decoded)) {
                    throw new Error("Failed to decode component in benchmark");
                }
            }
        }
        const t4 = performance.now();

        stepTimes.push(t1 - t0);
        encodeTimes.push(t2 - t1);
        cloneTimes.push(t3 - t2);
        decodeTimes.push(t4 - t3);
        totalTimes.push(t4 - t0);
        frameSizes.push(JSON.stringify(frame).length);
        changedCounts.push(frame.added.length + frame.changed.length);
        // Keep async providers alive so entity population stays realistic.
        if (i % 10 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    const sizes = stats(frameSizes);
    const changes = stats(changedCounts);
    console.log(`\nentities in world: ${world.entities.size}`);
    console.log(`added+changed entities/frame: mean ${changes.mean.toFixed(1)}  max ${changes.max}`);
    console.log(`frame JSON size: mean ${(sizes.mean / 1024).toFixed(1)} KiB  p95 ${(sizes.p95 / 1024).toFixed(1)} KiB\n`);
    console.log('per-frame times (ms):');
    row('world.step', stepTimes);
    row('snapshot encode', encodeTimes);
    row('structuredClone', cloneTimes);
    row('decode delta', decodeTimes);
    row('TOTAL pipeline', totalTimes);
    console.log('\n(16.67ms budget per frame at 60Hz; display step + PIXI render not included)');
    process.exit(0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
