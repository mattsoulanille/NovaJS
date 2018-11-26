import * as fs from "fs";
import * as path from "path";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { IDSpaceHandler } from "./IDSpaceHandler";
import { NovaResources } from "./ResourceHolderBase"


class NovaParse implements GameDataInterface {
    public data: NovaDataInterface;
    path: string
    private ids: IDSpaceHandler;
    public readonly idSpace: Promise<NovaResources>;

    constructor(dataPath: string) {
        this.path = path.join(dataPath);
        this.data = {};
        this.ids = new IDSpaceHandler(dataPath);
        this.idSpace = this.ids.getIDSpace();
        this.build();
    }
    private build() {
        this.data[NovaDataType.Ship] = makeGettable(
    }

    makeGettable(parseFunction: ()) {

    }

}


export { NovaParse };
