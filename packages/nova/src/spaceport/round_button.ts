// The original's ROUND buttons: the star map's zoom − / + and the scroll
// arrows (the shops' grids, the hire dialog, a long mission-text popup).
// They are not separate art but the standard button's left and right caps
// (PICT 7500/7502 and their pressed/grey twins, drawn through their masks
// 7600-7608 like every button) with no middle between them, which makes a
// 15 px disc in the caps' bezel, with a small glyph on it. (The Wine build
// betrays the construction: it draws one middle slice between the caps.)
// The game data has no art for the glyphs (no PICT between the caps
// 7500-7508 and the masks at 7600, no cicn for them), so they are drawn as
// the pixel rectangles measured on the macOS captures, in the label colour
// of the button's state.
import * as PIXI from 'pixi.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { Button, ButtonState } from './button.js';

export type RoundGlyph = 'minus' | 'plus' | 'up' | 'down';

type Rect = { x: number, y: number, w: number, h: number };

/**
 * The up chevron, one rectangle per row: 10 px wide and 6 tall with a
 * stroke 2-3 px thick (outfitter/earth_outfitter_cant_have_any.png
 * x734..743 y678..683, and the mission popup's pair on
 * spaceport/kiniké_kont_probe_mission_offer_in_spaceport.png).
 */
const CHEVRON_UP: readonly Rect[] = [
    { x: 13, y: 10, w: 2, h: 1 },
    { x: 12, y: 11, w: 4, h: 1 },
    { x: 11, y: 12, w: 6, h: 1 },
    { x: 10, y: 13, w: 3, h: 1 }, { x: 15, y: 13, w: 3, h: 1 },
    { x: 9, y: 14, w: 3, h: 1 }, { x: 16, y: 14, w: 3, h: 1 },
    { x: 9, y: 15, w: 2, h: 1 }, { x: 17, y: 15, w: 2, h: 1 },
];

/**
 * Each glyph's bars, relative to the button's top-left (its position; the
 * caps' top row). The zoom glyphs are measured on map_single_jump_route.png
 * (1920x1080, button at x 1067 / 1097, y 767): the minus is a 6x2 bar at
 * (1078, 779); the plus an 8x2 bar at (1107, 779) crossed by a 2x8 one at
 * (1110, 776). The down chevron is the up one upside down (the captures
 * show exactly that).
 */
export const ROUND_GLYPH_RECTS: Readonly<Record<RoundGlyph,
    readonly Rect[]>> = {
    minus: [{ x: 11, y: 12, w: 6, h: 2 }],
    plus: [{ x: 10, y: 12, w: 8, h: 2 }, { x: 13, y: 9, w: 2, h: 8 }],
    up: CHEVRON_UP,
    down: CHEVRON_UP.map(({ x, y, w, h }) => ({ x, y: 25 - y, w, h })),
};

/** How far the left cap overlaps the right one (see the constructor). */
export const ROUND_CAP_OVERLAP = 1;

/** The glyph's colour per state: a label's colours (button.ts fonts). */
const GLYPH_TINT: Readonly<Record<ButtonState, number>> = {
    normal: 0xffffff,
    clicked: 0x808080,
    grey: 0x262626,
};

export class RoundButton extends Button {
    private glyph?: PIXI.Graphics;

    constructor(displayAssets: DisplayAssetDataInterface, kind: RoundGlyph,
        position: { x: number, y: number } = { x: 0, y: 0 }) {
        // No caption and no middle: the two caps make the disc.
        super(displayAssets, '', 0, position);
        this.container.name = `Button:round-${kind}`;
        // ...overlapping by a pixel: edge to edge they make a 16 px disc
        // whose left bezel sits 1 px left of the capture's, which is 15.
        for (const state of this.container.children) {
            const leftCap = (state as PIXI.Container).children?.[0];
            if (leftCap instanceof PIXI.Sprite) {
                leftCap.x += ROUND_CAP_OVERLAP;
            }
        }
        const glyph = new PIXI.Graphics();
        glyph.beginFill(0xffffff);
        for (const { x, y, w, h } of ROUND_GLYPH_RECTS[kind]) {
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
