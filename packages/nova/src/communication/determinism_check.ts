/**
 * Diagnostic for simulation determinism. Runs two identical worlds in
 * lockstep and reports the first tick at which their state hashes
 * diverge, and which entities differ.
 *
 * Run from packages/nova after `npm run build`:
 *   node dist/src/communication/determinism_check.js [npcCount] [steps] [warmupSteps]
 *
 * Both quiet worlds and NPC combat should report no divergence: the
 * sim runs on a fixed timestep with seeded randomness, deterministic
 * entity ids, and no async data loading mid-simulation.
 */
import { runDeterminismCheck } from "./determinism_harness.js";
import { getIntegrationGameData } from "./simulation_test_fixture.js";

const npcCount = Number(process.argv[2] ?? 0);
const steps = Number(process.argv[3] ?? 240);

async function main() {
    console.log(`npcs=${npcCount} steps=${steps}`);
    const result = await runDeterminismCheck(npcCount, steps, Number(process.argv[4] ?? 0), console.log,
        getIntegrationGameData());
    if (result.divergedAtStep === undefined) {
        console.log(`DETERMINISTIC over ${result.stepsRun} steps`);
        process.exit(0);
    }
    console.log(`NONDETERMINISTIC: diverged at step ${result.divergedAtStep}`
        + ` (${result.differences.length} entities differ)`);
    process.exit(1);
}

main().catch(error => {
    console.error(error);
    process.exit(2);
});
