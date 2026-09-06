import * as Comlink from "comlink";
import nodeEndpointImport from "comlink/dist/umd/node-adapter.js";
import { multiplayer } from "nova_ecs/plugins/multiplayer_plugin";
import { MockCommunicator } from "nova_ecs/plugins/mock_communicator";
import { parentPort, workerData } from "worker_threads";
import { makeSystem } from "../nova_plugin/make_system.js";
import { SimulationBridgeHost } from "./simulation_bridge_host.js";
import { getIntegrationGameData } from "./simulation_test_fixture.js";

const nodeEndpoint = nodeEndpointImport as unknown as typeof nodeEndpointImport.default;

export interface SimulationBridgeWorkerData {
    systemId: string;
    communicatorId?: string;
}

async function main() {
    if (!parentPort) {
        throw new Error("Missing parent port");
    }

    const { systemId, communicatorId = "server" } = workerData as SimulationBridgeWorkerData;
    const gameData = await getIntegrationGameData();
    const world = await makeSystem(systemId, gameData);
    await world.addPlugin(multiplayer(new MockCommunicator(communicatorId)));

    Comlink.expose(new SimulationBridgeHost(world, gameData), nodeEndpoint(parentPort));
}

await main();
