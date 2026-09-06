import "jasmine";
import { SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { getSyntheticGameData, makeSimulationBridgeHarness } from "./simulation_test_fixture.js";

// On the synthetic data set: nothing here is about stock content, only
// about what a bridged world can encode.
describe("SimulationBridge integration", () => {
    it("creates structured-cloneable snapshots from a live simulation world", async () => {
        const { client } = await makeSimulationBridgeHarness(getSyntheticGameData());

        expect(() => client.snapshot()).not.toThrow();
    });

    it("encodes structured-cloneable entities from a live simulation world", async () => {
        const { world } = await makeSimulationBridgeHarness(getSyntheticGameData());
        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error("Expected serializer resource");
        }

        for (const [uuid, entity] of world.entities) {
            if (uuid === "singleton") {
                continue;
            }
            expect(() => structuredClone(serializer.encode(entity))).not.toThrow();
        }
    });
});
