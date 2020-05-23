import { SystemState } from "novajs/nova/src/proto/protobufjs_bundle";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
//import { SpaceObjectFactory } from "./SpaceObjectFactory";

export class SystemFactory {
    //    readonly spaceObjectFactory: SpaceObjectFactory;

    constructor(private gameData: GameDataInterface) {
        //        this.spaceObjectFactory = new SpaceObjectFactory(gameData);
    }

    async stateFromId(_id: string) {
        const system = new SystemState();
        return system;
    }
}
