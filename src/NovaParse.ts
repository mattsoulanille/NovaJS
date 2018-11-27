import * as fs from "fs";
import * as path from "path";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataInterface, NovaDataType, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { IDSpaceHandler } from "./IDSpaceHandler";
import { NovaResources, NovaResourceType } from "./ResourceHolderBase"
import { Gettable } from "novadatainterface/Gettable";
import { BaseData } from "novadatainterface/BaseData";
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
            var resource = <T>idSpace[resourceType][id];

            if (typeof resource === "undefined") {
                throw new NovaIDNotFoundError("NovaParse could not find " + resourceType + " of ID " + id + ".");
            }

            return await parseFunction(resource);

        });
    }
}


export { NovaParse };
