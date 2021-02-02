import { BaseResource } from "./NovaResourceBase";
import { BoomResource } from "./BoomResource";
import { DescResource } from "./DescResource";
import { OutfResource } from "./OutfResource";
import { RledResource } from "./RledResource";
import { PictResource } from "./PictResource";
import { ShanResource } from "./ShanResource";
import { ShipResource } from "./ShipResource";
import { SpinResource } from "./SpinResource";
import { SpobResource } from "./SpobResource";
import { SystResource } from "./SystResource";
import { WeapResource } from "./WeapResource";



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

type ResList<T> = {
    [index: string]: T
}

// type NovaResources = {
//     [index: string]: { // ResourceType
//         [index: string]: BaseResource  // ID (local or global depending on prefix)

//     }
// };


// TODO: Make more parsers
type NovaResources = {
    [index: string]: ResList<BaseResource>;
    bööm: ResList<BoomResource>;
    chär: ResList<BaseResource>;
    cicn: ResList<BaseResource>;
    cölr: ResList<BaseResource>;
    crön: ResList<BaseResource>;
    dësc: ResList<DescResource>;
    DITL: ResList<BaseResource>;
    DLOG: ResList<BaseResource>;
    düde: ResList<BaseResource>;
    flët: ResList<BaseResource>;
    gövt: ResList<BaseResource>;
    ïntf: ResList<BaseResource>;
    jünk: ResList<BaseResource>;
    mïsn: ResList<BaseResource>;
    nëbu: ResList<BaseResource>;
    öops: ResList<BaseResource>;
    oütf: ResList<OutfResource>;
    përs: ResList<BaseResource>;
    PICT: ResList<PictResource>;
    ränk: ResList<BaseResource>;
    rlë8: ResList<BaseResource>;
    rlëD: ResList<RledResource>;
    röid: ResList<BaseResource>;
    shän: ResList<ShanResource>;
    shïp: ResList<ShipResource>;
    "snd ": ResList<BaseResource>;
    spïn: ResList<SpinResource>;
    spöb: ResList<SpobResource>;
    "STR ": ResList<BaseResource>;
    STRH: ResList<BaseResource>;
    sÿst: ResList<SystResource>;
    vers: ResList<BaseResource>;
    wëap: ResList<WeapResource>;
}
function getEmptyNovaResources(): NovaResources {
    return {
        bööm: {},
        chär: {},
        cicn: {},
        cölr: {},
        crön: {},
        dësc: {},
        DITL: {},
        DLOG: {},
        düde: {},
        flët: {},
        gövt: {},
        ïntf: {},
        jünk: {},
        mïsn: {},
        nëbu: {},
        öops: {},
        oütf: {},
        përs: {},
        PICT: {},
        ränk: {},
        rlë8: {},
        rlëD: {},
        röid: {},
        shän: {},
        shïp: {},
        "snd ": {},
        spïn: {},
        spöb: {},
        "STR ": {},
        STRH: {},
        sÿst: {},
        vers: {},
        wëap: {}
    };
}





export { NovaResources, NovaResourceType, getEmptyNovaResources, ResList }
