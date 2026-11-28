// The star map's two zoom buttons (⊖ ⊕): ROUND buttons (round_button.ts),
// the standard button's two caps with no middle and a drawn glyph.
// Measured on map_single_jump_route.png (1920x1080): the minus disc spans
// x 1073..1087 and its glyph is a 6x2 bar at (1078, 779); the plus disc is
// 30 px further right with an 8x2 bar at (1107, 779) crossed by a 2x8 one
// at (1110, 776).
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { ROUND_CAP_OVERLAP, ROUND_GLYPH_RECTS, RoundButton } from './round_button.js';

export type ZoomGlyph = 'minus' | 'plus';

/** The glyph's bars, relative to the button's top-left (its position). */
export const ZOOM_GLYPH_RECTS = {
    minus: ROUND_GLYPH_RECTS.minus,
    plus: ROUND_GLYPH_RECTS.plus,
} as const;

/** How far the left cap overlaps the right one (round_button.ts). */
export const ZOOM_CAP_OVERLAP = ROUND_CAP_OVERLAP;

export class ZoomButton extends RoundButton {
    constructor(displayAssets: DisplayAssetDataInterface, kind: ZoomGlyph,
        position: { x: number, y: number }) {
        super(displayAssets, kind, position);
        this.container.name = `Button:zoom-${kind === 'minus' ? 'out' : 'in'}`;
    }
}
