import { SystResource } from "../resourceParsers/SystResource";
import { SystemData } from "novadatainterface/SystemData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";





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



    return {
        ...base,
        links,
        position: [syst.position[0], syst.position[1]],
    }

}
export { SystemParse }
