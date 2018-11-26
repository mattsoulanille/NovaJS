
import { BaseData } from "novadatainterface/BaseData";
import { NovaResources } from "../ResourceHolderBase";
import { NovaResourceBase } from "../resourceParsers/NovaResourceBase";


async function BaseParse(resource: NovaResourceBase, idSpace: NovaResources): Promise<BaseData> {
    // These must have been set (by IDSpaceHandler::getIDSpaceUnsafe) when this function is called.
    if (resource.globalID == null) {
        throw new Error("Resource id was not set");
    }
    if (resource.prefix == null) {
        throw new Error("Resource prefix was not set");
    }

    return {
        id: resource.globalID,
        name: resource.name,
        prefix: resource.prefix
    };
}


export { BaseParse };
