/**
 * Diagnostic: prints the world hash at every 100th step of an 8-NPC
 * determinism world, for comparing a candidate branch against the pin.
 * Usage: node scripts/world_hash_trace.mjs [npcCount] [steps]
 */
import { makeDeterminismWorld } from '../dist/src/communication/determinism_harness.js';
import { hashWorld } from 'nova_ecs/plugins/world_hash';

const npcCount = Number(process.argv[2] ?? 8);
const steps = Number(process.argv[3] ?? 3000);

const world = await makeDeterminismWorld(npcCount, 'worker');
for (let i = 1; i <= steps; i++) {
    world.step();
    if (i % 10 === 0) {
        await new Promise(resolve => setImmediate(resolve));
    }
    if (i % 100 === 0) {
        console.log(`step=${i} hash=${hashWorld(world).hash}`);
    }
}
