import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";

export class SystemFactory {
    //    readonly spaceObjectFactory: SpaceObjectFactory;

    constructor(private gameData: GameDataInterface,) {
        //        this.spaceObjectFactory = new SpaceObjectFactory(gameData);
    }

    async stateFromId(_id: string): Promise<System> {
        return {
            spaceObjects: new Map()
        }
    }

    static base(): System {
        return {
            spaceObjects: new Map()
        }
    }
}
