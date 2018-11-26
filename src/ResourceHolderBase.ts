import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataType, NovaDataInterface } from "novadatainterface/NovaDataInterface";
import { Gettable } from "novadatainterface/Gettable";
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
    [index: string]: { // ResourceType
        [index: string]: NovaResourceBase  // ID (local or global depending on prefix)

    }
};




export { NovaResources, NovaResourceType }
