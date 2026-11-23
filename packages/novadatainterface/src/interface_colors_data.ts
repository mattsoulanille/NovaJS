import { BaseData, getDefaultBaseData } from "./base_data.js";

/**
 * The game-wide interface colours of the cölr resource (EVN Bible, "The
 * cölr resource"): the menu, button, list, progress-bar and floating-panel
 * chrome. Only the colours are carried; the fonts and layout points in the
 * same resource are not used by anything yet.
 *
 * Every colour is 0xRRGGBB (the resource's high byte dropped), ready for
 * PIXI. The original loads only the first cölr, id 128; a plug-in that
 * overrides it keeps that id, so consumers ask for INTERFACE_COLORS_ID.
 */
export interface InterfaceColorsData extends BaseData {
    buttonUp: number;
    buttonDown: number;
    buttonDisabled: number;
    menuBright: number;
    menuDim: number;
    gridBright: number;
    gridDim: number;
    progressBright: number;
    progressDim: number;
    progressOutline: number;
    /** "Floating hyperspace map / escort menu border color". */
    floatingMapBorder: number;
    listText: number;
    listBackground: number;
    listHighlight: number;
    /** "Escort menu item highlight color". */
    escortHighlight: number;
}

/** The one cölr the game reads. */
export const INTERFACE_COLORS_ID = 'nova:128';

/**
 * The stock Nova Files cölr 128 values, for a data set without one (and for
 * the mocks). The original-hardware captures measure floatingMapBorder as
 * RGB (8,8,8) and escortHighlight as (132,0,0): the data's (12,12,12) and
 * (128,0,0) after the reference Mac's colour management.
 */
export function getDefaultInterfaceColorsData(): InterfaceColorsData {
    return {
        ...getDefaultBaseData(),
        buttonUp: 0xffffff,
        buttonDown: 0x808080,
        buttonDisabled: 0x262626,
        menuBright: 0xff0000,
        menuDim: 0x800000,
        gridBright: 0xff0000,
        gridDim: 0x404040,
        progressBright: 0xff0000,
        progressDim: 0x800000,
        progressOutline: 0x404040,
        floatingMapBorder: 0x0c0c0c,
        listText: 0xffffff,
        listBackground: 0x000000,
        listHighlight: 0x800000,
        escortHighlight: 0x800000,
    };
}
