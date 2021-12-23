import { getDefaultTargetCornersData, TargetCornersData } from "nova_data_interface/TargetCornersData";
import { BaseResource } from "../resource_parsers/NovaResourceBase";


export async function TargetCornersParse(_base: BaseResource, _notFoundFunction: (m: string) => void): Promise<TargetCornersData> {
    // TODO: Actually parse cicns
    return getDefaultTargetCornersData();
};
