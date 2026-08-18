import { BaseData } from "novadatainterface/base_data";
import { BaseResource } from "../resource_parsers/nova_resource_base.js";


export async function BaseParse(resource: BaseResource, _notFoundFunction: (message: string) => void): Promise<BaseData> {
    if (typeof resource === "undefined") {
        // Why can't I make the typechecker do this?
        throw new Error("Resource was undefined");
    }

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
        prefix: resource.prefix,
        // Which plug-in supplied this resource, as opposed to which
        // namespace its id landed in (see BaseData.writerPrefix). Only
        // hand-made resources leave it unset, and for those the two are
        // the same thing.
        writerPrefix: resource.writerPrefixIfSet ?? resource.prefix,
    };
}
