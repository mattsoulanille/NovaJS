import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataType, NovaDataInterface, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { Gettable } from "novadatainterface/Gettable";
import { BaseResource } from "novadatainterface/BaseResource";
import { NovaResourceBase } from "./resourceParsers/NovaResourceBase";



enum NovaResourceType {
    bööm = "bööm",
    oütf = "oütf",
    rlëD = "rlëD",
    shän = "shän",
    shïp = "shïp",
    spïn = "spïn",
    weäp = "weäp",
    PICT = "PICT",
    dësc = "dësc",
    spöb = "spöb",
    sÿst = "sÿst"
}

type NovaResources = {
    resources: {
        [index: string]: { // ResourceType
            [index: string]: NovaResourceBase  // ID (local or global depending on prefix)

        }
    }
    prefix: string | null; // Null means it's the global scope
};


abstract class ResourceHolderBase {
    globalIdSpace: NovaResources;

    constructor(prefix: string | null) {
        this.globalIdSpace = {
            resources: {},
            prefix
        };
        //this.setupResources();
    }

    // setupResources() {
    //     for (let val in NovaResourceType) {
    //         this.globalIdSpace.resources[val] = this.makeResourceIDMap(<NovaResourceType>NovaResourceType[val]);
    //     }
    // }

    // abstract makeResourceIDMap(resourceType: NovaResourceType): { [index: string]: NovaResourceBase };
}

export { ResourceHolderBase, NovaResources, NovaResourceType }
