import "jasmine";
import { runDeterminismCheck } from "./determinism_harness.js";
import { getSyntheticGameData } from "./simulation_test_fixture.js";

describe("Simulation determinism", () => {
    // Entities are staged (fully loaded before insertion) and the sim
    // never resolves data asynchronously mid-step, so two identical
    // worlds must produce identical state hash streams from tick 0.
    it("is deterministic for a quiet world", async () => {
        const messages: string[] = [];
        const result = await runDeterminismCheck(0, 240, 0,
            message => messages.push(message), getSyntheticGameData());
        expect(result.divergedAtStep)
            .withContext(messages.join('\n'))
            .toBeUndefined();
        expect(result.stepsRun).toBe(240);
    }, 60_000);

    // Exercises seeded weapon spread, submunition cones, NPC targeting,
    // damage, and deterministic entity ids for spawned projectiles.
    it("is deterministic with NPCs fighting", async () => {
        const messages: string[] = [];
        const result = await runDeterminismCheck(4, 240, 0,
            message => messages.push(message), getSyntheticGameData());
        expect(result.divergedAtStep)
            .withContext(messages.join('\n'))
            .toBeUndefined();
        expect(result.stepsRun).toBe(240);
    }, 120_000);
});

describe("Cross-platform determinism", () => {
    // A server world (node platform) and a client world (worker
    // platform) must run the same simulation systems and produce
    // identical state, or peers diverge by construction.
    it("simulates identically on node and worker platforms", async () => {
        const { compareWorlds, makeDeterminismWorld } =
            await import("./determinism_harness.js");
        const { applySimulationInputs } =
            await import("./simulation_input.js");
        const nodeWorld = await makeDeterminismWorld(2, undefined,
            getSyntheticGameData());
        const workerWorld = await makeDeterminismWorld(2, 'worker',
            getSyntheticGameData());
        for (const world of [nodeWorld, workerWorld]) {
            applySimulationInputs(world, [{
                kind: 'control',
                events: [{ action: 'accelerate', state: 'start' }],
            }], 'test peer');
        }
        const messages: string[] = [];
        const result = await compareWorlds(nodeWorld, workerWorld, 240,
            message => messages.push(message));
        expect(result.divergedAtStep)
            .withContext(messages.join("\n"))
            .toBeUndefined();
    }, 120_000);
});
