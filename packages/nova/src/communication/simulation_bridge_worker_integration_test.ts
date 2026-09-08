import "jasmine";
import { once } from "events";
import { Worker } from "worker_threads";
import { makeWorkerThreadSimulationBridgeClient } from "./simulation_bridge_worker_threads.js";
import {
    getSyntheticGameData, makeSimulationBridgeHarness,
} from "./simulation_test_fixture.js";


describe("SimulationBridge worker integration", () => {
    it("runs the simulation bridge across a worker thread", async () => {
        const harness = await makeSimulationBridgeHarness(
            getSyntheticGameData());
        const serializer = harness.client.getSerializer();
        const ship = harness.world.entities.get(harness.shipUuid);
        if (!ship) {
            throw new Error("Expected harness ship to exist");
        }

        const worker = new Worker(
            new URL("./simulation_bridge_worker_entry.js", import.meta.url),
            {
                workerData: {
                    systemId: harness.systemId,
                    communicatorId: "server",
                    // The worker parses the SAME set as the harness, or
                    // the two worlds would not be the same system at all.
                    dataSet: "synthetic",
                },
            },
        );
        await once(worker, "online");

        const client = makeWorkerThreadSimulationBridgeClient(worker, serializer);
        try {
            // Planets, the asteroid field (none in the synthetic
            // scenario's first system, Thessaly Reach), and the NPC
            // population (with its spawner) are loaded before the world
            // ever steps, so the initial frame already contains them.
            // Sim-minted ids carry the system id as a prefix (IdFactory:
            // `nova:128:asteroid:0`); the field and the spawner
            // themselves are named entities ('asteroid field', 'npc
            // spawner').
            const isSystemFurniture = (uuid: string) =>
                uuid.includes('planet') || uuid.includes('asteroid')
                || uuid.includes('npc');
            const initialFrame = await client.snapshot();
            for (const [uuid] of initialFrame.added) {
                expect(isSystemFurniture(uuid)).withContext(uuid).toBeTrue();
            }

            await client.addEntity(harness.shipUuid, ship);
            await client.step();
            const addedFrame = await client.snapshot();
            const addedShips = addedFrame.added.filter(
                ([uuid]) => !isSystemFurniture(uuid));
            expect(addedShips.length).toBe(1);
            expect(addedShips[0]?.[0]).toBe(harness.shipUuid);
            const decoded = client.decodeEntity(addedShips[0]![1]);
            expect(decoded.name).toBe(ship.name);

            await client.step();
            const steppedFrame = await client.snapshot();
            expect(steppedFrame.time?.frame).toBe((addedFrame.time?.frame ?? 0) + 1);

            await client.removeEntity(harness.shipUuid);
            await client.step();
            const removedFrame = await client.snapshot();
            expect(removedFrame.added).toEqual([]);
            expect(removedFrame.removed).toContain(harness.shipUuid);
        } finally {
            await client.close();
        }
        // Full system genesis (planets, asteroids, the NPC spawn
        // table, and the përs table over every përs resource) runs
        // twice here (harness + worker); the default 5s was already
        // borderline before the përs table existed, and the worker
        // still pays for its own module graph and parse.
    }, 30_000);
});
