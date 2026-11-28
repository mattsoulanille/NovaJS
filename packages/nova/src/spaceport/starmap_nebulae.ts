// The star map's nebulae (nëbu): which ones the player sees, which of a
// nebula's pictures is drawn at the map's current scale, where, and how it
// combines with the rest of the map. Measured on the original:
// docs/reference_experiments.md "Star-map nebulae (nëbu), wave 53" (the
// one rule still a GUESS is marked so).
import { NebulaData, NebulaImage } from "novadatainterface/nebula_data";
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from 'pixi.js';
import { MAX_BLEND_MODE } from "../display/max_blend.js";
import { evaluateNCBTest } from "../nova_plugin/ncb/index.js";
import { DISCOVERY_ENTERED, DiscoveryLevel } from "../nova_plugin/player/index.js";
import { BASE_SCALE, WorldBounds } from "./starmap_viewport.js";

/**
 * "The map scales used in Nova are 42.1%, 56.2%, 75.0%, 100.0%, 133.3%,
 * 177.7%, and 237.0%" (EVN Bible, nëbu; the reference's seven zoom
 * levels, wave 53). A scale is screen pixels per map unit. NovaJS zooms
 * continuously, so these are only where the original's measurements were
 * taken: {@link nebulaImageFor} applies its rule at whatever scale the
 * view is at.
 */
export const NEBULA_MAP_SCALES =
    [0.421, 0.562, 0.75, 1, 1.333, 1.777, 2.37] as const;

/** Slack for a picture that fits its target exactly (251 px at 100%). */
const FIT_EPSILON = 1e-6;

/**
 * The picture to draw at `pxPerUnit` screen pixels per map unit: the
 * LARGEST of the nebula's pictures that fits inside the nebula's size at
 * that scale in BOTH dimensions (width <= XSize x s and height <= YSize x
 * s), or the first picture when none fits; undefined when it has none.
 * Whichever is picked is then stretched to exactly that size
 * ({@link NebulaLayer}).
 *
 * Measured (wave 53, all 28 nebula-zoom pairs of the stock four): Holpa
 * at 42.1% draws its 63-wide picture, not the nearer 126; L-1551 at 177.7%
 * draws 146x71, not 292x141; Obatta at 100% draws 33x49 because its 65x98
 * is taller than 90; and a size plug-in showed a picture too wide OR too
 * tall is skipped. "Largest" is by area, ties to the later slot: the
 * Bible asks for pictures sorted by size, the stock sets are, and an
 * unsorted set was not tried on the original.
 */
export function nebulaImageFor(nebula: Pick<NebulaData, 'size' | 'images'>,
    pxPerUnit: number): NebulaImage | undefined {
    const maxWidth = nebula.size[0] * pxPerUnit + FIT_EPSILON;
    const maxHeight = nebula.size[1] * pxPerUnit + FIT_EPSILON;
    let best: NebulaImage | undefined;
    for (const image of nebula.images) {
        if (image.width <= maxWidth && image.height <= maxHeight
            && (!best || image.width * image.height
                >= best.width * best.height)) {
            best = image;
        }
    }
    return best ?? nebula.images[0];
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
 * The TOP edge is measured (wave 53): Tichel (110, 40) sits exactly on
 * Obatta Nebula's top edge (YPos 40) and K-018 (-15, -226) on L-1551's
 * (YPos -226), and neither reveals its nebula, explored at level 1 or 2.
 * The LEFT, RIGHT and BOTTOM edges are a GUESS (no stock system sits on
 * one): strict like the top.
 */
export function nebulaCovers(nebula: Pick<NebulaData, 'position' | 'size'>,
    [x, y]: readonly [number, number]): boolean {
    const [left, top] = nebula.position;
    const [width, height] = nebula.size;
    return x > left && x < left + width && y > top && y < top + height;
}

/**
 * Whether the player sees the nebula: its ActiveOn passes (a pilot
 * without the bit does not see it, explored or not), and at least one
 * system the player has explored lies inside its rectangle
 * ({@link nebulaCovers}). Then the WHOLE picture shows, never a piece of
 * it, however far its rectangle runs past that system's links.
 *
 * Measured (wave 53): Holpa alone at level 2, in the top-left corner of
 * Holpa Nebula, reveals all 251 x 298 of it; Tocc at level 1 (visited)
 * reveals it as well as level 2 (landed) does; Nibos, explored 8 units
 * outside the rectangle, does not, nor does Tocc inside it while only an
 * unexplored dim ring; ActiveOn naming a bit no pilot holds hides Obatta
 * Nebula on a fully explored map.
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

/**
 * The nebulae the player sees ({@link nebulaVisible}), given every system
 * and how much the player knows about each. Explored = entered (discovery
 * level 1+), the set the Bible's "systems the player has explored" names
 * (discovery.ts), plus wherever the player stands. The sÿst positions
 * decide, not whether a system is drawn.
 */
export function visibleNebulae(nebulae: readonly NebulaData[],
    systems: readonly SystemData[], currentSystem: string,
    bits: ReadonlySet<number>,
    discoveryOf: (systemId: string) => DiscoveryLevel): NebulaData[] {
    const explored = systems
        .filter(s => s.id === currentSystem
            || discoveryOf(s.id) >= DISCOVERY_ENTERED)
        .map(s => s.position);
    return nebulae.filter(n => nebulaVisible(n, bits, explored));
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
 * `bounds` grown to take in every one of `nebulae`'s rectangles, so the
 * map's pan clamp (starmap_viewport.ts) can reach all of each. The
 * original's pan is unbounded (wave 53: ~800 units each way), and a
 * nebula may run past every system: Holpa Nebula's lower right (681,
 * 343) lies beyond the eastmost and southmost systems (587, 300).
 */
export function boundsWithNebulae(bounds: WorldBounds,
    nebulae: readonly Pick<NebulaData, 'position' | 'size'>[]): WorldBounds {
    let { minX, minY, maxX, maxY } = bounds;
    for (const nebula of nebulae) {
        const rect = nebulaRect(nebula);
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
    }
    return { minX, minY, maxX, maxY };
}

/**
 * The drawn nebulae: one sprite per visible nebula, stretched
 * (nearest-neighbour: whole source pixels as blocks, as measured) over
 * exactly its rectangle, re-pointed at the right picture
 * ({@link nebulaImageFor}) whenever the zoom changes.
 *
 * LAYERING (measured, wave 53): over the map's black background and
 * under everything else: the links (opaque lane grey across it), the
 * system rings (their black interiors black it out), the names, the route
 * and the bracket. With Show Borders the territory and the nebula combine
 * by a PER-CHANNEL MAX, neither covering the other, black in the picture
 * being transparent. So the layer is drawn just ABOVE the (opaque)
 * borders with the MAX blend (display/max_blend.ts), which over the black
 * background without borders is the picture itself.
 */
export class NebulaLayer {
    readonly container = new PIXI.Container();
    private readonly sprites: { nebula: NebulaData, sprite: PIXI.Sprite }[] = [];

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
            sprite.blendMode = MAX_BLEND_MODE;
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
     * map unit (the view's scale, continuous). Cheap when no pick moves. */
    update(pxPerUnit: number) {
        for (const { nebula, sprite } of this.sprites) {
            const image = nebulaImageFor(nebula, pxPerUnit);
            if (!image || this.picked.get(nebula.id) === image.id) {
                continue;
            }
            this.picked.set(nebula.id, image.id);
            const texture = this.textureOf(image.id);
            // The PICT is the nebula's own: nothing else draws it smoothed.
            texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
            sprite.texture = texture;
            // Set after the texture: a Sprite keeps its asked-for size
            // through a texture that is still loading.
            const rect = nebulaRect(nebula);
            sprite.width = rect.width;
            sprite.height = rect.height;
        }
    }
}
