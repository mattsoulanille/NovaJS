import { BaseData, getDefaultBaseData } from "./base_data.js";

/** One of a nebula's pictures: a PICT global id and its pixel size. */
export interface NebulaImage {
    /** The PICT's global id (served through Pict / PictImage). */
    id: string;
    /** The picture's width in pixels, from its QuickDraw frame. */
    width: number;
    /** The picture's height in pixels, from its QuickDraw frame. */
    height: number;
}

/**
 * A nëbu: a picture drawn behind the star map. The EVN Bible: "Nëbu
 * resources contain info on the nebulae (or other space phenomena) which
 * are displayed in the background of the star map. These images don't
 * actually have any effect on events in the game, they're just there to
 * look pretty", except through OnExplore.
 *
 * Its pictures are PICTs "9500-9724. Each nebula can have up to seven PICT
 * resources associated with it; the first nebula's PICTs are 9500-96, the
 * second's are 9507-13, etc. The engine will pick the best nebula image to
 * display for a given map scale (the map scales used in Nova are 42.1%,
 * 56.2%, 75.0%, 100.0%, 133.3%, 177.7%, and 237.0%). If a nebula image of
 * the proper size for the current map scale isn't available, Nova will pick
 * the closest one and stretch it as necessary. PICTs for a given nebula
 * should be sorted by size in ascending order."
 *
 * The stock data uses three of the seven slots per nebula, at a quarter,
 * a half and the whole of the nebula's normal-zoom size (Holpa Nebula
 * nova:128 is 251x298 with PICTs 63x75, 126x149 and 251x298), so the slot
 * number is NOT a map scale: the display picks by pixel size
 * (spaceport/starmap_nebulae.ts).
 */
export interface NebulaData extends BaseData {
    /**
     * XPos / YPos: the picture's UPPER-LEFT corner on the star map, "in
     * the scale of the 'normal' map zoom level (not zoomed in or out)" —
     * the 100% scale, one pixel per sÿst coordinate unit.
     */
    position: [number, number];
    /** XSize / YSize: how big it is drawn at the normal zoom, in the same
     * units. */
    size: [number, number];
    /** "Control bit test expression. Leave blank if unused." */
    activeOn: string;
    /**
     * "Control bit set expression that is evaluated whenever the nebula is
     * tested for visibility and found to be visible." Only setting and
     * clearing bits is meaningful here: the Bible warns it "may get
     * evaluated multiple times", so random and other operators are not
     * supported by it.
     */
    onExplore: string;
    /**
     * The PICTs among the nebula's seven slots (9500 + 7 * (id - 128) +
     * 0..6) that exist, in slot order — which the Bible asks plug-in
     * authors to keep ascending by size. Empty when none exists.
     */
    images: NebulaImage[];
}

export function getDefaultNebulaData(): NebulaData {
    return {
        ...getDefaultBaseData(),
        position: [0, 0],
        size: [0, 0],
        activeOn: "",
        onExplore: "",
        images: [],
    };
}
