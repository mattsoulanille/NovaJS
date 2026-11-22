import * as Comlink from "comlink";
import { Serializer } from "nova_ecs/plugins/serializer_plugin";
import { AsyncSimulationBridgeClient } from "./async_simulation_bridge_client.js";
import { AsyncSimulationBridgeHostApi } from "./simulation_bridge_api.js";
import type { WorkerRoomState } from "./worker_room_communicator.js";
import type { GameDataSeed } from "../client/gamedata/simulation_game_data.js";


/** What the main thread forwards (worker_room_communicator.ts). */
export type BrowserWorkerRoomState = WorkerRoomState;

export interface BrowserSimulationBridgeWorkerApi extends AsyncSimulationBridgeHostApi {
    init(
        args: {
            systemId: string,
            roomState: BrowserWorkerRoomState,
            initialSpeedVote?: { wantFast: boolean, inSpace: boolean },
            /**
             * Game data the worker's fresh SimulationGameData starts
             * with: the destination's genesis data from the main
             * thread's caches, so the worker's makeSystem need not
             * fetch it again (#370; see GameDataSeed).
             */
            gameDataSeed?: GameDataSeed,
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
