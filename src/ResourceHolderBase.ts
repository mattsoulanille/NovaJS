import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataType, NovaDataInterface } from "novadatainterface/NovaDataInterface";
import { Gettable } from "novadatainterface/Gettable";
import { BaseResource } from "novadatainterface/BaseResource";
import { NovaResourceBase } from "./resourceParsers/NovaResourceBase";



enum NovaResourceType {
    bööm = "bööm",
    chär = "chär",
    cicn = "cicn",
    cölr = "cölr",
    crön = "crön",
    dësc = "dësc",
    DITL = "DITL",
    DLOG = "DLOG",
    düde = "düde",
    flët = "flët",
    gövt = "gövt",
    ïntf = "ïntf",
    jünk = "jünk",
    mïsn = "mïsn",
    nëbu = "nëbu",
    öops = "öops",
    oütf = "oütf",
    përs = "përs",
    PICT = "PICT",
    ränk = "ränk",
    rlë8 = "rlë8",
    rlëD = "rlëD",
    röid = "röid",
    shän = "shän",
    shïp = "shïp",
    snd = "snd ",
    spïn = "spïn",
    spöb = "spöb",
    STR = "STR ",
    STRH = "STR#",
    sÿst = "sÿst",
    vers = "vers",
    wëap = "wëap"
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
