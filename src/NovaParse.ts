import * as fs from "fs";
import * as path from "path";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { IDSpaceHandler } from "./IDSpaceHandler";
import { NovaResources, NovaResourceType } from "./ResourceHolderBase"
import { Gettable } from "../../NovaDataInterface/Gettable";
import { BaseData } from "../../NovaDataInterface/BaseData";
import { BaseResource } from "./resourceParsers/NovaResourceBase";
import { ShipParse } from "./parsers/ShipParse";
import { ShipResource } from "./resourceParsers/ShipResource";

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
        this.data[NovaDataType.Ship] = this.makeGettable<ShipResource>(NovaResourceType.shïp, ShipParse)
    }

    makeGettable<T extends BaseResource>(resourceType: NovaResourceType, parseFunction: (resource: T) => Promise<BaseData>): Gettable<BaseData> {
        return new Gettable(async (id: string) => {
            var idSpace = await this.idSpace;
            return await parseFunction(<T>idSpace[resourceType][id]);
        });
    }
}


export { NovaParse };
