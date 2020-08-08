import { EngineState, MapKeys } from "novajs/nova/src/proto/protobufjs_bundle";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { SystemFactory } from "./SystemFactory";
import { EngineView, engineViewFactory } from "./TreeView";

export class EngineFactory {
    readonly systemFactory: SystemFactory;

    constructor(private gameData: GameDataInterface) {
        this.systemFactory = new SystemFactory(gameData);
    }

    async newView(): Promise<EngineView> {
        const engineState = new EngineState();
        const systems = (await this.gameData.ids).System;

        // System IDs are also their UUIDs because they're only
        // ever instantiated once. 
        engineState.systemsKeys = new MapKeys();
        engineState.systemsKeys.keySet = new MapKeys.KeySet();
        engineState.systemsKeys.keySet.keys = systems;

        for (const id of systems) {
            engineState.systems[id] = await this.systemFactory.stateFromId(id);
        }
        return engineViewFactory(engineState);
    }
}
