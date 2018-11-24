import { BaseResource } from "novadatainterface/BaseResource";
import { NovaDataType, NovaDataInterface, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Gettable } from "novadatainterface/Gettable";
import { NovaFileReader } from "./NovaFileReader";
import { CachelessGettable } from "./CachelessGettable";
import { GameDataBase } from "./GameDataBase";





// type IDSpace = {
//     [index: string]: { // ResourceType
//         [index: number]: BaseResource // Resource ID
//     }
// };


class IDSpaceHandler extends GameDataBase {

    novaFiles: { [index: string]: NovaFileReader };
    novaPlugins: { [index: string]: NovaFileReader };
    idSpaces: { [index: string]: GameDataInterface };

    constructor() {
        super();
        this.novaFiles = {};
        this.novaPlugins = {};
        this.idSpaces = {};
    }

    // Makes a gettable for the resource 'resourceType'
    makeGettable(resourceType: NovaDataType) {
        var getVals = (o: { [index: string]: NovaFileReader }) => {
            return Object.keys(o).map((i) => { return o[i] });
        }

        return new Gettable<BaseResource>(async (globalID: string): Promise<BaseResource> => {

            // Not an object because of potential name conflicts between plugins and novafiles
            var both = [...getVals(this.novaPlugins), ...getVals(this.novaFiles)];
            for (let i in both) {
                var source = both[i];

                // Not the most efficient way, but there will never be more than 50 or so plugins
                // Still O(n)
                try {
                    return await source.data[resourceType].get(globalID);
                }
                catch (e) {
                    if (!(e instanceof NovaIDNotFoundError)) {
                        throw e;
                    }
                }
            }
            throw new NovaIDNotFoundError("Failed to find " + resourceType + " of id " + globalID);
        });
    }

    // Returns the IDSpace of namespace 'prefix'
    getIDSpace(prefix: string): NovaDataInterface {
        return new Proxy(this.data, {
            get: (target, novaDataType) => {
                if (typeof novaDataType === "symbol") {
                    throw new Error("Can't access idSpace by symbol");
                }

                if (novaDataType in target) {
                    return new CachelessGettable(async (localID) => {
                        var globalID = prefix + ":" + localID;
                        return await target[novaDataType].get(globalID);
                    })
                }
            }
        });
    }


    // Adds a Nova Plug-in 


}



export { IDSpaceHandler, NovaIDNotFoundError };
