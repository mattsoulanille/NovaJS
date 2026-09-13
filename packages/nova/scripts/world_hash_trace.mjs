/**
 * Diagnostic: prints the world hash at every 100th step of an 8-NPC
 * determinism world, for comparing a candidate branch against the pin.
 * Usage: node scripts/world_hash_trace.mjs [npcCount] [steps] [--synthetic]
 *
 * Defaults to the integration game data (Nova_Data); `--synthetic`
 * runs on the checked-in fixture set instead, matching
 * ambiguity_report.mjs, so the script works where Nova_Data is not
 * installed. Compare hashes only against a run with the same source.
 */
import { makeDeterminismWorld } from '../dist/src/communication/determinism_harness.js';
import { getSyntheticGameData } from '../dist/src/communication/simulation_test_fixture.js';
import { hashWorld } from 'nova_ecs/plugins/world_hash';

const positional = [];
let synthetic = false;
for (const arg of process.argv.slice(2)) {
    if (arg === '--synthetic') {
        synthetic = true;
    } else {
        positional.push(arg);
    }
}
const npcCount = Number(positional[0] ?? 8);
const steps = Number(positional[1] ?? 3000);

const world = await makeDeterminismWorld(npcCount, 'worker',
    synthetic ? getSyntheticGameData() : undefined);
for (let i = 1; i <= steps; i++) {
    world.step();
    if (i % 10 === 0) {
        await new Promise(resolve => setImmediate(resolve));
    }
    if (i % 100 === 0) {
        console.log(`step=${i} hash=${hashWorld(world).hash}`);
    }
}
