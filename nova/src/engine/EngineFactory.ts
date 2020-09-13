import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { Engine } from "./State";
import { SystemFactory } from "./SystemFactory";

export class EngineFactory {
    readonly systemFactory: SystemFactory;

    constructor(private gameData: GameDataInterface) {
        this.systemFactory = new SystemFactory(gameData);
    }

    async newWithSystems(): Promise<Engine> {
        const engine = EngineFactory.base();
        const systems = (await this.gameData.ids).System;

        for (const id of systems) {
            engine.systems.set(id, await this.systemFactory.stateFromId(id));
        }

        return engine;
    }

    static base(): Engine {
        return {
            systems: new Map()
        }
    }
}
