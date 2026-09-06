import { getDefaultTargetCornersData, TargetCornersData } from "novadatainterface/target_corners_data";
import { BaseResource } from "../resource_parsers/nova_resource_base.js";


export async function TargetCornersParse(_base: BaseResource, _notFoundFunction: (m: string) => void): Promise<TargetCornersData> {
    // Tracker issue: parse the target-corner cicns; until then every id
    // resolves to the default corner set.
    return getDefaultTargetCornersData();
};
