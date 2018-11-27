import { readResourceFork } from "resourceforkjs"; // TODO: Add a declaration file
import { NovaResources, NovaResourceType } from "./ResourceHolderBase";
import { BoomResource } from "./resourceParsers/BoomResource";
import { DescResource } from "./resourceParsers/DescResource";
import { BaseResource } from "./resourceParsers/NovaResourceBase";
import { OutfResource } from "./resourceParsers/OutfResource";
import { PictResource } from "./resourceParsers/PictResource";
import { RledResource } from "./resourceParsers/RledResource";
import { ShanResource } from "./resourceParsers/ShanResource";
import { ShipResource } from "./resourceParsers/ShipResource";
import { SpinResource } from "./resourceParsers/SpinResource";
import { SpobResource } from "./resourceParsers/SpobResource";
import { SystResource } from "./resourceParsers/SystResource";
import { WeapResource } from "./resourceParsers/WeapResource";




// Reads a single plugin or nova file
// Puts results in localIDSpace.
async function readNovaFile(filePath: string, localIDSpace: NovaResources) {
    var rf = await read(filePath);

    //console.log(localIDSpace);

    for (let resourceType in NovaResourceType) {
        var parser = getParser(<NovaResourceType>resourceType);

        for (let id in rf[resourceType]) {
            localIDSpace[resourceType][id] = new parser(rf[resourceType][id], localIDSpace);
        }
    }
}

function read(path: string) {
    // Whether or not to use resource fork
    var useRF = (path.slice(-5) !== ".ndat");
    return readResourceFork(path, useRF);
}


// Since we're storing subclasses, not instances of subclasses.
// TODO: Fill this out as more are implemented
var parserMap: { [index: string]: typeof BaseResource } = {};
parserMap[NovaResourceType.bööm] = BoomResource;
//parserMap[NovaResourceType.chär] = ;
//parserMap[NovaResourceType.cicn] = ;
//parserMap[NovaResourceType.cölr] = ;
//parserMap[NovaResourceType.crön] = ;
parserMap[NovaResourceType.dësc] = DescResource;
//parserMap[NovaResourceType.DITL] = ;
//parserMap[NovaResourceType.DLOG] = ;
//parserMap[NovaResourceType.düde] = ;
//parserMap[NovaResourceType.flët] = ;
//parserMap[NovaResourceType.gövt] = ;
//parserMap[NovaResourceType.ïntf] = ;
//parserMap[NovaResourceType.jünk] = ;
//parserMap[NovaResourceType.mïsn] = ;
//parserMap[NovaResourceType.nëbu] = ;
//parserMap[NovaResourceType.öops] = ;
parserMap[NovaResourceType.oütf] = OutfResource;
//parserMap[NovaResourceType.përs] = ;
parserMap[NovaResourceType.PICT] = PictResource;
//parserMap[NovaResourceType.ränk] = ;
//parserMap[NovaResourceType.rlë8] = ;
parserMap[NovaResourceType.rlëD] = RledResource;
//parserMap[NovaResourceType.röid] = ;
parserMap[NovaResourceType.shän] = ShanResource;
parserMap[NovaResourceType.shïp] = ShipResource;
//parserMap[NovaResourceType.snd] = ;
parserMap[NovaResourceType.spïn] = SpinResource;
parserMap[NovaResourceType.spöb] = SpobResource;
//parserMap[NovaResourceType.STR] = ;
//parserMap[NovaResourceType.STRH] = ;
parserMap[NovaResourceType.sÿst] = SystResource;
//parserMap[NovaResourceType.vers] = ;
parserMap[NovaResourceType.wëap] = WeapResource;


function getParser(resourceType: NovaResourceType): typeof BaseResource {
    if (parserMap[resourceType]) {
        return parserMap[resourceType];
    }
    else {
        return BaseResource;
        //throw new Error("Unknown data type " + resourceType);
    }
}

export { readNovaFile };
