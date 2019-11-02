import { SystResource } from "../resourceParsers/SystResource";
import { SystemData } from "novadatainterface/SystemData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";




// TODO: Refactor redundant code
async function SystemParse(syst: SystResource, notFoundFunction: (m: string) => void): Promise<SystemData> {
    var base: BaseData = await BaseParse(syst, notFoundFunction);

    var links: Array<string> = [];
    for (let i in [...syst.links]) {
        let linkLocal = [...syst.links][i];

        let systLinkedTo = syst.idSpace.sÿst[linkLocal];
        if (systLinkedTo) {
            links.push(systLinkedTo.globalID);
        }
        else {
            notFoundFunction("No corresponding system " + linkLocal + " for link from " + base.id);
        }
    }

    var planets: Array<string> = [];

    for (let i in syst.spobs) {
        let planetLocal = syst.spobs[i];

        let planetGlobal = syst.idSpace.spöb[planetLocal];
        if (planetGlobal) {
            planets.push(planetGlobal.globalID);
        }
        else {
            notFoundFunction("Missing spöb id " + planetLocal + " for sÿst " + base.id);
        }
    }


    return {
        ...base,
        links,
        position: [syst.position[0], syst.position[1]],
        planets
    }

}
export { SystemParse }
