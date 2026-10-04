import * as Comlink from "comlink";
import { CommunicatorResource } from "nova_ecs/plugins/multiplayer_plugin";
import { MockCommunicator } from "nova_ecs/plugins/mock_communicator";
import { parentPort, workerData } from "worker_threads";
import { makeSystem } from "../nova_plugin/make_system.js";
import { nodeEndpoint } from "../util/comlink_node_endpoint.js";
import { SimulationBridgeHost } from "./simulation_bridge_host.js";
import { getIntegrationGameData, getSyntheticGameData } from "./simulation_test_fixture.js";

export interface SimulationBridgeWorkerData {
    systemId: string;
    communicatorId?: string;
    /**
     * Which data set the worker parses: the real Nova Files (the default,
     * as before) or the checked-in synthetic scenario, so a spec that
     * drives a worker can run without the copyrighted data.
     */
    dataSet?: "integration" | "synthetic";
}

async function main() {
    if (!parentPort) {
        throw new Error("Missing parent port");
    }

    const { systemId, communicatorId = "server", dataSet = "integration" } =
        workerData as SimulationBridgeWorkerData;
    const gameData = dataSet === "synthetic"
        ? await getSyntheticGameData() : await getIntegrationGameData();
    const world = await makeSystem(systemId, gameData);
    // As the browser worker does: the bridge host reads the
    // communicator, and no legacy delta-sync plugin runs (#317).
    world.resources.set(CommunicatorResource, new MockCommunicator(communicatorId));

    Comlink.expose(new SimulationBridgeHost(world, gameData), nodeEndpoint(parentPort));
}

await main();
