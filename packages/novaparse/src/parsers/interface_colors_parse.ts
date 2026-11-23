import { InterfaceColorsData } from "novadatainterface/interface_colors_data";
import { ColrResource } from "../resource_parsers/colr_resource.js";
import { BaseParse } from "./base_parse.js";

/** cölr colours are stored as 0x00RRGGBB; drop the high byte for PIXI. */
function toColor(colr: number): number {
    return colr & 0xFFFFFF;
}

/**
 * Projects a parsed cölr resource onto InterfaceColorsData: its colour
 * fields only, each masked to RGB.
 */
export async function InterfaceColorsParse(colr: ColrResource,
    notFoundFunction: (m: string) => void): Promise<InterfaceColorsData> {
    const base = await BaseParse(colr, notFoundFunction);
    return {
        ...base,
        buttonUp: toColor(colr.buttonUp),
        buttonDown: toColor(colr.buttonDown),
        buttonDisabled: toColor(colr.buttonDisabled),
        menuBright: toColor(colr.menuBright),
        menuDim: toColor(colr.menuDim),
        gridBright: toColor(colr.gridBright),
        gridDim: toColor(colr.gridDim),
        progressBright: toColor(colr.progressBright),
        progressDim: toColor(colr.progressDim),
        progressOutline: toColor(colr.progressOutline),
        floatingMapBorder: toColor(colr.floatingMapBorder),
        listText: toColor(colr.listText),
        listBackground: toColor(colr.listBackground),
        listHighlight: toColor(colr.listHighlight),
        escortHighlight: toColor(colr.escortHighlight),
    };
}
