import * as Comlink from "comlink";
import { Serializer } from "nova_ecs/plugins/serializer_plugin";
import { AsyncSimulationBridgeClient } from "./async_simulation_bridge_client.js";
import { AsyncSimulationBridgeHostApi } from "./simulation_bridge_api.js";


export interface BrowserWorkerRoomState {
    uuid?: string;
    peers?: Set<string>;
    connected?: boolean;
    servers?: Set<string>;
}

export interface BrowserSimulationBridgeWorkerApi extends AsyncSimulationBridgeHostApi {
    init(
        args: {
            systemId: string,
            roomState: BrowserWorkerRoomState,
        },
        sendMessage: (message: unknown, destination?: string | Set<string>) => void | Promise<void>,
    ): Promise<void>;
    updateRoomState(state: BrowserWorkerRoomState): Promise<void>;
    receiveRoomMessage(source: string, message: unknown): Promise<void>;
}

export function makeBrowserSimulationBridgeClient(worker: Worker, serializer: Serializer) {
    const host = Comlink.wrap<BrowserSimulationBridgeWorkerApi>(worker);
    return {
        host,
        client: new AsyncSimulationBridgeClient(
            host,
            serializer,
            async () => {
                worker.terminate();
            },
        ),
    };
}
