// The star map's two zoom buttons (⊖ ⊕). In the original they are not
// labelled pills but ROUND buttons: the standard button's left and right
// caps (PICT 7500/7502 and their pressed/grey twins) with no middle
// between them, which makes a 15 px red disc in the caps' bezel, with a
// white glyph on it. Measured on map_single_jump_route.png (1920x1080):
// the minus disc spans x 1073..1087 and its glyph is a 6x2 bar at
// (1078, 779); the plus disc is 30 px further right with an 8x2 bar at
// (1107, 779) crossed by a 2x8 one at (1110, 776). The game data has no
// art for the glyphs (no PICT between the button caps 7500-7508 and the
// masks at 7600), so they are drawn.
import * as PIXI from 'pixi.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { Button, ButtonState } from './button.js';

export type ZoomGlyph = 'minus' | 'plus';

/** The glyph's bars, relative to the button's top-left (its position). */
export const ZOOM_GLYPH_RECTS: Readonly<Record<ZoomGlyph,
    readonly { x: number, y: number, w: number, h: number }[]>> = {
    minus: [{ x: 11, y: 12, w: 6, h: 2 }],
    plus: [{ x: 10, y: 12, w: 8, h: 2 }, { x: 13, y: 9, w: 2, h: 8 }],
};

/** How far the left cap overlaps the right one (see the constructor). */
export const ZOOM_CAP_OVERLAP = 1;

/** The glyph's colour per state: a label's colours (button.ts fonts). */
const GLYPH_TINT: Readonly<Record<ButtonState, number>> = {
    normal: 0xffffff,
    clicked: 0x808080,
    grey: 0x262626,
};

export class ZoomButton extends Button {
    private glyph?: PIXI.Graphics;

    constructor(displayAssets: DisplayAssetDataInterface, kind: ZoomGlyph,
        position: { x: number, y: number }) {
        // No caption and no middle: the two caps make the disc.
        super(displayAssets, '', 0, position);
        this.container.name = `Button:zoom-${kind === 'minus' ? 'out' : 'in'}`;
        // ...overlapping by a pixel: edge to edge they make a 16 px disc
        // whose left bezel sits 1 px left of the capture's, which is 15.
        for (const state of this.container.children) {
            const leftCap = (state as PIXI.Container).children?.[0];
            if (leftCap instanceof PIXI.Sprite) {
                leftCap.x += ZOOM_CAP_OVERLAP;
            }
        }
        const glyph = new PIXI.Graphics();
        glyph.beginFill(0xffffff);
        for (const { x, y, w, h } of ZOOM_GLYPH_RECTS[kind]) {
            glyph.drawRect(x, y, w, h);
        }
        glyph.endFill();
        this.glyph = glyph;
        this.container.addChild(glyph);
        this.state = super.state;
    }

    override set state(state: ButtonState) {
        super.state = state;
        if (this.glyph) {
            this.glyph.tint = GLYPH_TINT[state];
        }
    }

    override get state(): ButtonState {
        return super.state;
    }
}
