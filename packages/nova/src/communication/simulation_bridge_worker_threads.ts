import * as Comlink from "comlink";
import { Worker } from "worker_threads";
import { Serializer } from "nova_ecs/plugins/serializer_plugin";
import { nodeEndpoint } from "../util/comlink_node_endpoint.js";
import { AsyncSimulationBridgeClient, AsyncSimulationBridgeHostApi } from "./simulation_bridge.js";

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
