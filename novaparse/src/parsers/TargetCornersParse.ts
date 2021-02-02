import { Defaults } from "novajs/novadatainterface/Defaults";
import { TargetCornersData } from "../../../novadatainterface/TargetCornersData";
import { BaseResource } from "../resource_parsers/NovaResourceBase";


export async function TargetCornersParse(_base: BaseResource, _notFoundFunction: (m: string) => void): Promise<TargetCornersData> {
    //    var base: BaseData = await BaseParse(spob, notFoundFunction);

    // TODO: Actually parse cicns
    return Defaults.TargetCorners;
};
