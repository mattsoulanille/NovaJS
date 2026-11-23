// Government territory on the star map (Show Borders): how explored
// systems and the governments that own them become the shaded political
// regions of ui_screenshots/original_macos_screenshots/map/govt_borders.png.
//
// THE MODEL, fitted to that capture (pixels compared against borders_off.png
// so only the shading is measured; every labeled system matched back to its
// sÿst position — the reference draws ~1.78 px per map unit):
//
//  * Each explored system with a government and an INHABITED stellar
//    radiates territory:
//    FULL strength out to TERRITORY_FLAT_RADIUS map units, then fading
//    linearly to nothing at TERRITORY_OUTER_RADIUS. A least-squares sweep
//    over the capture's ~186,000 shaded pixels puts the two at 32 and 62.5
//    units.
//  * Full strength is HALF the gövt Color: Federation #2c2caf shades to
//    #101052, and the fade walks down #10104a, #101042, #080839, ... — the
//    values of a 16-bit (5 bits per channel) screen, FLOORED: 0.5 x 175 =
//    87.5 is level 10 = #52, 0.5 x 44 = 22 is level 2 = #10.
//  * Where several systems' territory overlaps, a pixel takes the STRONGEST
//    contribution, not the sum: the dark channels between neighbouring
//    blobs (Journey's End / Archenar, Nesre Secundus / Sol) are exactly the
//    falloff of the nearer system. Within one government that is a union of
//    soft discs; between two it puts the boundary where their strengths
//    meet — midway between their nearest systems.
//  * Only EXPLORED systems claim territory: the unexplored Federation
//    system HJG-0637 sits in a dark channel 25 px from its own blob's edge.
//  * And only INHABITED ones — systems holding at least one stellar with
//    spöb Flags 0x0020 clear (landable.ts systemHasInhabitedStellar).
//    HJG-1034 and Procyon are explored Federation systems drawn light grey
//    (landable but uninhabited stellars only), and the capture is dark
//    where only they would reach. Counting them, the model misses 10% of
//    the pixels by more than one 5-bit step; leaving them out, 2.4% (mean
//    channel error 2.3/255, 84% of pixels exact — the rest is the
//    capture's own dithering and the ~1.78 px/unit scale being measured,
//    not known).
//    Habitation, NOT a port: this is where the border rule parts from the
//    blue-dot rule (starmap_draw.ts systemDotColor, landable.ts isPort).
//    Measured on the original (docs/reference_experiments.md, "M5
//    leftover: which systems radiate borders"): an explored system whose
//    only stellar is inhabited but unlandable (Flags 0x0002) draws a light
//    grey dot yet radiates a full disc; an explored system with no stellar
//    radiates nothing; an unexplored one with a port radiates nothing. In
//    the stock data that corner is the four Wraith systems (sÿst
//    510/521/582/593).
//  * MINOR governments (gövt Flags2 0x0002, "considered minor for the
//    purposes of drawing the political boundaries") give way to major ones:
//    the capture's Nesre Secundus (Roughnecks, gövt 145 — the SAME colour as
//    the Federation) and Tuatha (Wild Geese, gövt 144, dark green) are both
//    explored, yet neither adds a pixel: the shading around them is the
//    Federation's own falloff from its nearest systems, and there is no
//    green anywhere — not even 85 px west of Nesre Secundus, where the
//    Federation's falloff has run out and a full-size Roughnecks blob would
//    still be at half strength. So a minor government's territory is drawn
//    UNDER every major one, and smaller: at MINOR_TERRITORY_SCALE of the
//    radii. That size is a guess — the capture only shows that a minor
//    blob is less than ~45 units across, and nothing shows one in open
//    space — kept rather than drawing minors not at all, which would make
//    the Bible's 0x0002 the same as its 0x0004.
//  * Flags2 0x0004 ("this govt's systems don't affect the political
//    boundaries") claims nothing — the caller returns no owner for it.
//
// THE RENDERING. The fade is quantized anyway (5-bit levels), so instead of
// rasterizing a field the territory is painted as concentric opaque discs,
// one per colour level, and the "strongest wins" rule falls out of the
// painter's algorithm: every disc of every system is painted in order of
// increasing strength, so each point ends up the colour of the strongest
// level covering it. Minor governments' discs are all painted first, so the
// faintest major disc already covers them. It is vector geometry in
// laid-out coordinates, so it scales with the map's zoom like everything
// else and is baked once per graph.
import * as PIXI from 'pixi.js';
import { BASE_SCALE } from "./starmap_viewport.js";

/** Full-strength territory radius around a system, in map units. */
export const TERRITORY_FLAT_RADIUS = 32;
/** Where a system's territory has faded to nothing, in map units. */
export const TERRITORY_OUTER_RADIUS = 62.5;
/** A minor gövt's territory radii, relative to a major's (a guess; see
 * the header). */
export const MINOR_TERRITORY_SCALE = 0.5;
/** Full-strength shading as a fraction of the gövt Color. */
export const TERRITORY_STRENGTH = 0.5;

/** Who owns a system's territory. */
export interface TerritoryOwner {
    /** The gövt Color, 0xRRGGBB. */
    color: number;
    /** gövt Flags2 0x0002: drawn smaller, and under every major gövt. */
    minor: boolean;
}

/** One system's claim, at its laid-out (BASE_SCALE) map position. */
export interface TerritorySite extends TerritoryOwner {
    x: number;
    y: number;
}

/** One opaque disc of the painted territory. */
export interface TerritoryDisc {
    x: number;
    y: number;
    /** Laid-out radius. */
    radius: number;
    color: number;
    /** The disc's territory strength, 0..1 (paint order within a class). */
    strength: number;
    minor: boolean;
}

/** A 0..255 channel value as a 16-bit screen shows it: 5 bits, floored,
 * expanded back the way the Mac does ((v << 3) | (v >> 2)). */
function to5Bit(value: number): number {
    // The epsilon keeps a value that is exactly on a level in real numbers
    // (territoryDiscs asks for exactly level j) from flooring to j - 1
    // when the float arithmetic lands a hair under.
    const level = Math.max(0, Math.min(31,
        Math.floor(value * 31 / 255 + 1e-9)));
    return (level << 3) | (level >> 2);
}

/** A gövt Color scaled by `strength` and quantized to 5 bits/channel. */
export function territoryShade(color: number, strength: number): number {
    const scale = TERRITORY_STRENGTH * strength;
    return to5Bit(((color >> 16) & 0xff) * scale) << 16
        | to5Bit(((color >> 8) & 0xff) * scale) << 8
        | to5Bit((color & 0xff) * scale);
}

/**
 * The territory strength (0..1) a system exerts at `distance` map units —
 * full out to the flat radius, then a linear fade to the outer radius.
 */
export function territoryStrength(distance: number): number {
    if (distance <= TERRITORY_FLAT_RADIUS) {
        return 1;
    }
    return Math.max(0, (TERRITORY_OUTER_RADIUS - distance)
        / (TERRITORY_OUTER_RADIUS - TERRITORY_FLAT_RADIUS));
}

/**
 * The discs that paint `sites`' territory, IN PAINT ORDER: all minor
 * governments' discs, then all major ones, each class from the weakest
 * level to the strongest. One disc per visible colour level of a site:
 * level j of the gövt's brightest channel starts where the faded strength
 * first reaches it, and the disc's colour is the shade at that strength.
 */
export function territoryDiscs(sites: readonly TerritorySite[])
    : TerritoryDisc[] {
    const discs: TerritoryDisc[] = [];
    for (const site of sites) {
        const color = site.color & 0xffffff;
        const brightest = Math.max((color >> 16) & 0xff,
            (color >> 8) & 0xff, color & 0xff);
        // How many 5-bit steps the brightest channel climbs at full
        // strength, as a fraction (the last step may be partial).
        const steps = brightest * TERRITORY_STRENGTH * 31 / 255;
        const scale = (site.minor ? MINOR_TERRITORY_SCALE : 1) * BASE_SCALE;
        for (let level = 1; level <= Math.floor(steps); level++) {
            const strength = level / steps;
            const fade = (1 - strength)
                * (TERRITORY_OUTER_RADIUS - TERRITORY_FLAT_RADIUS);
            discs.push({
                x: site.x,
                y: site.y,
                radius: (TERRITORY_FLAT_RADIUS + fade) * scale,
                color: territoryShade(color, strength),
                strength,
                minor: site.minor,
            });
        }
    }
    // Array.prototype.sort is stable: equal strengths keep site order.
    return discs.sort((a, b) => (Number(b.minor) - Number(a.minor))
        || (a.strength - b.strength));
}

/**
 * The colour the painted territory shows at a laid-out point (black where
 * none reaches): the last disc in paint order that covers it. What
 * {@link drawTerritory} puts on screen, as data — for specs.
 */
export function territoryColorAt(discs: readonly TerritoryDisc[],
    x: number, y: number): number {
    let color = 0;
    for (const disc of discs) {
        if (Math.hypot(x - disc.x, y - disc.y) <= disc.radius) {
            color = disc.color;
        }
    }
    return color;
}

/** Paints `sites`' territory into `graphics` (cleared first). */
export function drawTerritory(graphics: PIXI.Graphics,
    sites: readonly TerritorySite[]) {
    graphics.clear();
    graphics.lineStyle(0);
    for (const disc of territoryDiscs(sites)) {
        graphics.beginFill(disc.color);
        graphics.drawCircle(disc.x, disc.y, disc.radius);
        graphics.endFill();
    }
}
