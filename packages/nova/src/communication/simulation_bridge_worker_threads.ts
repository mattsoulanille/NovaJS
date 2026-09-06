import * as Comlink from "comlink";
import nodeEndpointImport from "comlink/dist/umd/node-adapter.js";
import { Worker } from "worker_threads";
import { Serializer } from "nova_ecs/plugins/serializer_plugin";
import { AsyncSimulationBridgeClient } from "./async_simulation_bridge_client.js";
import { AsyncSimulationBridgeHostApi } from "./simulation_bridge_api.js";


const nodeEndpoint = nodeEndpointImport as unknown as typeof nodeEndpointImport.default;

export function makeWorkerThreadSimulationBridgeClient(worker: Worker, serializer: Serializer) {
    const host = Comlink.wrap<AsyncSimulationBridgeHostApi>(nodeEndpoint(worker));
    return new AsyncSimulationBridgeClient(
        host,
        serializer,
        async () => {
            await worker.terminate();
        },
    );
}
