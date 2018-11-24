import { BaseResource } from "novadatainterface/BaseResource";
import { NovaDataInterface } from "novadatainterface/NovaDataInterface";

async function BaseParse(resource: any, _data: NovaDataInterface): Promise<BaseResource> {
    return {
        id: resource.globalID,
        name: resource.name,
        prefix: resource.prefix
    };
}


export { BaseParse };
