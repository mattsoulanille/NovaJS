// The star map's nebulae (nëbu): which ones the player sees, which of a
// nebula's pictures is drawn at the map's current scale, and where. Every
// rule that is not measured on the original yet lives here, marked GUESS,
// so matching the reference is an edit to this one file.
import { NebulaData, NebulaImage } from "novadatainterface/nebula_data";
import * as PIXI from 'pixi.js';
import { evaluateNCBTest } from "../nova_plugin/ncb/index.js";
import { BASE_SCALE } from "./starmap_viewport.js";

/**
 * "The map scales used in Nova are 42.1%, 56.2%, 75.0%, 100.0%, 133.3%,
 * 177.7%, and 237.0%" (EVN Bible, nëbu). A scale is screen pixels per
 * map unit: the original opens its map at 177.7% (starmap_viewport.ts
 * DEFAULT_PX_PER_UNIT, measured at 1.77), and the stock nebulae's largest
 * pictures are exactly their XSize/YSize, the 100% size.
 */
export const NEBULA_MAP_SCALES =
    [0.421, 0.562, 0.75, 1, 1.333, 1.777, 2.37] as const;

/**
 * The original scale nearest `pxPerUnit` (by ratio). NovaJS zooms
 * continuously (a wheel or pinch lands anywhere between MIN_ZOOM and
 * MAX_ZOOM), the original in those seven steps, so a picture is chosen
 * for the step the view is closest to and then stretched to the exact
 * zoom like any other map element.
 */
export function nearestMapScale(pxPerUnit: number): number {
    let best: number = NEBULA_MAP_SCALES[0];
    for (const scale of NEBULA_MAP_SCALES) {
        if (Math.abs(Math.log(scale / pxPerUnit))
            < Math.abs(Math.log(best / pxPerUnit))) {
            best = scale;
        }
    }
    return best;
}

/**
 * The picture to draw at `pxPerUnit`: of the nebula's existing pictures,
 * the one whose width is closest (by ratio) to the nebula's width at the
 * nearest original scale; ties go to the larger picture. Undefined when
 * the nebula has none.
 *
 * GUESS (reference pending). The Bible: "The engine will pick the best
 * nebula image to display for a given map scale ... If a nebula image of
 * the proper size for the current map scale isn't available, Nova will
 * pick the closest one and stretch it as necessary." Read here as
 * closest IN SIZE, because the stock data cannot mean slot = scale: every
 * stock nebula fills slots 0-2 only, Holpa at 1/4, 1/2 and 1x its size and
 * L-1551 at 1/2, 1x and 2x, so "slot 3 is 100%" would stretch Holpa's
 * full-size picture down at 75% while L-1551 drew its double-size one.
 * The two readings differ only at the small scales.
 */
export function nebulaImageFor(nebula: Pick<NebulaData, 'size' | 'images'>,
    pxPerUnit: number): NebulaImage | undefined {
    const wanted = Math.max(1, nebula.size[0]) * nearestMapScale(pxPerUnit);
    let best: NebulaImage | undefined;
    let bestError = Infinity;
    for (const image of nebula.images) {
        const error = Math.abs(Math.log(Math.max(1, image.width) / wanted));
        if (error < bestError - 1e-9
            || (Math.abs(error - bestError) <= 1e-9
                && best !== undefined && image.width > best.width)) {
            best = image;
            bestError = error;
        }
    }
    return best;
}

/**
 * Whether the nebula's ActiveOn passes against the player's bits. A blank
 * expression passes; a malformed one shows the nebula (as a malformed sÿst
 * visibility shows the system: system_graph_data.ts systemVisible).
 */
export function nebulaActive(nebula: Pick<NebulaData, 'id' | 'activeOn'>,
    bits: ReadonlySet<number>): boolean {
    try {
        return evaluateNCBTest(nebula.activeOn ?? '', {
            getBit: bit => bits.has(bit),
        });
    } catch (e) {
        console.warn(`Bad ActiveOn NCB test for nëbu ${nebula.id}: ${e}`);
        return true;
    }
}

/**
 * Whether a map position lies INSIDE the nebula's picture (upper-left
 * anchored, normal-zoom units), its edges excluded.
 *
 * Edges excluded on the one piece of evidence there is: the reference
 * capture map/map_zoomed_out_showing_far_away_mission.png (100% scale) is a
 * pilot who has explored Tichel (110, 40), which sits exactly on the top
 * edge of Obatta Nebula (nova:129, 60..125 x 40..130), and the nebula's
 * rectangle there is pure black. (SPC-050 (118, 78), strictly inside, is
 * only the dim unexplored ring in that capture, so the ring does not
 * reveal a nebula either.)
 */
export function nebulaCovers(nebula: Pick<NebulaData, 'position' | 'size'>,
    [x, y]: readonly [number, number]): boolean {
    const [left, top] = nebula.position;
    const [width, height] = nebula.size;
    return x > left && x < left + width && y > top && y < top + height;
}

/**
 * Whether the player sees the nebula: its ActiveOn passes, and it is
 * EXPLORED — at least one system the player has explored lies on it.
 *
 * GUESS (reference pending) for the second half. The Bible says only that
 * the nebulae's "explored state ... is recalculated every time based on
 * the systems the player has explored", and that OnExplore runs when a
 * nebula "is tested for visibility and found to be visible" — so a nebula
 * is visible exactly when explored, and explored is a function of the
 * explored systems. Which systems count (inside the picture's rectangle?
 * near it? only the dim ring around it?) and whether a nebula is revealed
 * whole or in pieces is what the reference agent is measuring.
 */
export function nebulaVisible(nebula: NebulaData, bits: ReadonlySet<number>,
    exploredPositions: Iterable<readonly [number, number]>): boolean {
    if (!nebulaActive(nebula, bits)) {
        return false;
    }
    for (const position of exploredPositions) {
        if (nebulaCovers(nebula, position)) {
            return true;
        }
    }
    return false;
}

/** The nebula's picture rectangle in laid-out (BASE_SCALE) coordinates. */
export function nebulaRect(nebula: Pick<NebulaData, 'position' | 'size'>) {
    return {
        x: nebula.position[0] * BASE_SCALE,
        y: nebula.position[1] * BASE_SCALE,
        width: nebula.size[0] * BASE_SCALE,
        height: nebula.size[1] * BASE_SCALE,
    };
}

/**
 * The drawn nebulae: one sprite per visible nebula, stretched over its
 * rectangle, re-pointed at the right picture whenever the zoom changes.
 *
 * DRAW ORDER, GUESS (reference pending): beneath everything else on the
 * map — the Show Borders territory, the links and the dots are all drawn
 * over it — and opaque, with the normal blend: the stock pictures are
 * clouds on black, and the map is black.
 */
export class NebulaLayer {
    readonly container = new PIXI.Container();
    private readonly sprites: { nebula: NebulaData, sprite: PIXI.Sprite }[] = [];
    private shownFor?: number;

    constructor(nebulae: readonly NebulaData[],
        private readonly textureOf: (pictId: string) => PIXI.Texture) {
        this.container.name = 'Nebulae';
        for (const nebula of nebulae) {
            if (nebula.images.length === 0) {
                continue;
            }
            const rect = nebulaRect(nebula);
            const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
            sprite.name = nebula.id;
            sprite.position.set(rect.x, rect.y);
            this.sprites.push({ nebula, sprite });
            this.container.addChild(sprite);
        }
    }

    /** The nebulae drawn, by id. */
    get shown(): string[] {
        return this.sprites.map(s => s.nebula.id);
    }

    /** The PICT each drawn nebula shows now, by nebula id. */
    get pictures(): ReadonlyMap<string, string> {
        return this.picked;
    }

    private readonly picked = new Map<string, string>();

    /** Points every sprite at its picture for `pxPerUnit` screen pixels per
     * map unit. Cheap when the chosen scale has not changed. */
    update(pxPerUnit: number) {
        const scale = nearestMapScale(pxPerUnit);
        if (scale === this.shownFor) {
            return;
        }
        this.shownFor = scale;
        for (const { nebula, sprite } of this.sprites) {
            const image = nebulaImageFor(nebula, pxPerUnit);
            if (!image || this.picked.get(nebula.id) === image.id) {
                continue;
            }
            this.picked.set(nebula.id, image.id);
            sprite.texture = this.textureOf(image.id);
            // Set after the texture: a Sprite keeps its asked-for size
            // through a texture that is still loading.
            const rect = nebulaRect(nebula);
            sprite.width = rect.width;
            sprite.height = rect.height;
        }
    }
}
