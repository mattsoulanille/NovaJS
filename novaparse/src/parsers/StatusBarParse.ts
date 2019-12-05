import { BaseResource } from "../resource_parsers/NovaResourceBase";
import { StatusBarData, DefaultStatusBarColors, DefaultStatusBarDataAreas } from "novadatainterface/StatusBarData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";


async function StatusBarParse(baseResource: BaseResource, notFoundFunction: (m: string) => void): Promise<StatusBarData> {
    var base: BaseData = await BaseParse(baseResource, notFoundFunction);

    // TODO: Parse statusbars
    return {
        ...base,
        image: "nova:700", // The default civilian status bar.
        colors: DefaultStatusBarColors,
        dataAreas: DefaultStatusBarDataAreas
    }
}

export { StatusBarParse };
