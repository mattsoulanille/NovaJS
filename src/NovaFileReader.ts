import { BaseResource } from "novadatainterface/BaseResource";
import { Gettable } from "novadatainterface/Gettable";
import { NovaDataInterface, NovaDataType, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { resourceFork } from "resourceforkjs"; // TODO: Add a declaration file
import { GameDataBase } from "./GameDataBase";
import { ShipParse } from "./parsers/ShipParse";



// Reads a single plugin or nova file

class NovaFileReader extends GameDataBase {
    path: string;
    idSpace: NovaDataInterface;
    resources: Promise<any>; // TODO: Fix type
    prefix: string;

    constructor(filePath: string, localIDSpace: NovaDataInterface, prefix = filePath) {
        super();
        this.path = filePath;
        this.prefix = prefix;
        this.idSpace = localIDSpace;
        this.resources = this.read();
    }

    makeGettable(dataType: NovaDataType): Gettable<BaseResource> {
        var parseFunction = this.getParser(dataType);
        return new Gettable(async (globalID: string) => {
            var resources = await this.resources;

            var split = globalID.split(":");
            if (split[0] !== this.prefix) {
                throw new NovaIDNotFoundError(globalID + " not found (prefix mismatch).");
            }

            var localID = parseInt(split[split.length - 1]);
            var ofType = resources[dataType];
            if (!ofType) {
                throw new NovaIDNotFoundError(globalID + " not found. None of type " + dataType);
            }

            var resource = ofType[localID];
            if (resource) {
                return parseFunction(resource, this.idSpace);
            }
            else {
                throw new NovaIDNotFoundError(globalID + " not found.");
            }
        });
    }

    async read() {
        var novaFile = this.readRF(this.path);
        return await novaFile.read();
    }

    readRF(p: string) {
        // Whether or not to use resource fork
        var useRF = (p.slice(-5) !== ".ndat");
        return new resourceFork(p, useRF);
    }

    getParser(dataType: NovaDataType) {
        switch (dataType) {
            case NovaDataType.Ship:
                return ShipParse;
            default:
                //Temporary
                return async function(res: any, data: NovaDataInterface): Promise<BaseResource> {
                    return {
                        id: "test",
                        name: "test",
                        prefix: "test"
                    };
                };
            //throw new Error("Unknown data type " + dataType);
        }
    }


}

export { NovaFileReader };
