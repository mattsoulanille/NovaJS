import { BaseData } from "novadatainterface/BaseData";
import { BaseParse } from "./BaseParse";
import { BaseResource } from "../resourceParsers/NovaResourceBase";
import { TargetCornersData, DefaultTargetCornersData } from "novadatainterface/TargetCornersData";


async function TargetCornersParse(_base: BaseResource, _notFoundFunction: (m: string) => void): Promise<TargetCornersData> {
    //    var base: BaseData = await BaseParse(spob, notFoundFunction);

    // TODO: Actually parse cicns
    return DefaultTargetCornersData;
};


export { TargetCornersParse }
