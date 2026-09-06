import {
    circle, polygon, RasterFrame, rasterize, rgb15, rotationFrames, Shape,
    TRANSPARENT,
} from "./raster.js";
import { RLED, SHIP, SHIPS } from "./universe.js";

/**
 * The hand-drawn sprite sheets: which rlëD holds which frames. Every
 * sprite is a few flat-shaded shapes from raster.ts, so the art is
 * original, tiny, and — being integer-rasterized — byte-identical on
 * every machine.
 */

const HULL = rgb15(18, 18, 20);
const HULL_DARK = rgb15(9, 9, 11);
const ACCENT_BLUE = rgb15(6, 12, 28);
const ACCENT_RED = rgb15(26, 6, 4);
const ENGINE = rgb15(31, 16, 4);
const ENGINE_BRIGHT = rgb15(31, 26, 12);
const COCKPIT = rgb15(20, 26, 31);
const SEA = rgb15(6, 18, 22);
const LAND = rgb15(10, 20, 8);
const ICE = rgb15(28, 29, 31);
const MOON = rgb15(22, 22, 18);
const CRATER = rgb15(14, 14, 11);
const GATE = rgb15(10, 10, 14);
const GATE_GLOW = rgb15(16, 24, 31);
const STATION = rgb15(16, 16, 18);
const BOLT = rgb15(31, 28, 8);
const MISSILE = rgb15(24, 24, 24);
const ROCK = rgb15(14, 10, 6);
const ROCK_LIGHT = rgb15(19, 15, 10);

/** The ship hulls, in half-pixel units, nose up. */
const SKIFF: Shape[] = [
    polygon(HULL, [[0, -20], [9, 12], [-9, 12]]),
    polygon(ENGINE, [[-4, 8], [4, 8], [4, 14], [-4, 14]]),
    circle(COCKPIT, [0, -6], 3),
];

const CORSAIR: Shape[] = [
    polygon(HULL, [[-6, -2], [-24, 16], [-6, 14]]),
    polygon(HULL, [[6, -2], [24, 16], [6, 14]]),
    polygon(HULL, [[0, -26], [6, -4], [6, 18], [-6, 18], [-6, -4]]),
    polygon(ACCENT_RED, [[0, -22], [3, -6], [-3, -6]]),
    circle(ENGINE, [-12, 14], 3),
    circle(ENGINE, [12, 14], 3),
];

/** The corsair's engine glow: an additive overlay of the engines alone. */
const CORSAIR_GLOW: Shape[] = [
    circle(ENGINE_BRIGHT, [-12, 14], 4),
    circle(ENGINE_BRIGHT, [12, 14], 4),
];

const WARDEN: Shape[] = [
    polygon(HULL, [[0, -34], [14, -10], [16, 24], [-16, 24], [-14, -10]]),
    polygon(HULL_DARK, [[-6, -14], [6, -14], [6, 18], [-6, 18]]),
    circle(ACCENT_BLUE, [0, -8], 4),
    circle(ACCENT_BLUE, [0, 12], 4),
    circle(ENGINE, [-9, 20], 3),
    circle(ENGINE, [9, 20], 3),
];

const shipFrames = (shapes: Shape[], size: number, framesPer: number) =>
    rotationFrames(size, size, shapes, framesPer);

function shipSprite(shipId: number): { size: number, framesPer: number } {
    const ship = SHIPS.find(s => s.id === shipId);
    if (!ship) {
        throw new Error(`No ship ${shipId}`);
    }
    return { size: ship.animation.size, framesPer: ship.animation.framesPer };
}

/** A planet: sea, a continent and an ice cap. */
const PLANET: Shape[] = [
    circle(SEA, [0, 0], 38),
    circle(LAND, [8, -6], 14),
    circle(LAND, [-14, 12], 9),
    circle(ICE, [0, -30], 9),
];

const MOON_SHAPES: Shape[] = [
    circle(MOON, [0, 0], 26),
    circle(CRATER, [-8, -6], 5),
    circle(CRATER, [7, 9], 4),
];

/**
 * A hypergate: a ring with a pylon above and below, so the sheet is
 * deliberately NON-SQUARE (24 wide, 32 tall) — the packer used to copy
 * the frame height from the width, which is invisible on square ship
 * sprites and wrong on every station and gate.
 */
const GATE_SHAPES: Shape[] = [
    polygon(GATE, [[-3, -31], [3, -31], [3, -20], [-3, -20]]),
    polygon(GATE, [[-3, 20], [3, 20], [3, 31], [-3, 31]]),
    circle(GATE_GLOW, [0, 0], 22),
    circle(TRANSPARENT, [0, 0], 15),
];

/** A station: a hub, four spokes and an outer ring. */
const STATION_SHAPES: Shape[] = [
    circle(STATION, [0, 0], 34),
    circle(TRANSPARENT, [0, 0], 28),
    polygon(STATION, [[-3, -34], [3, -34], [3, 34], [-3, 34]]),
    polygon(STATION, [[-34, -3], [34, -3], [34, 3], [-34, 3]]),
    circle(HULL_DARK, [0, 0], 12),
    circle(ACCENT_BLUE, [0, 0], 5),
];

const BOLT_SHAPES: Shape[] = [
    polygon(BOLT, [[0, -7], [3, 0], [0, 7], [-3, 0]]),
];

const MISSILE_SHAPES: Shape[] = [
    polygon(MISSILE, [[0, -9], [2, -3], [2, 7], [-2, 7], [-2, -3]]),
    polygon(ACCENT_RED, [[-2, 4], [2, 4], [4, 9], [-4, 9]]),
];

/** The explosion: eight frames of a fireball that grows, then dims. */
function burstFrames(): RasterFrame[] {
    const radii = [4, 8, 11, 14, 15, 14, 11, 7];
    return radii.map((radius, i) => rasterize(16, 16, [
        circle(i < 5 ? ENGINE : ACCENT_RED, [0, 0], radius),
        circle(i < 5 ? ENGINE_BRIGHT : ENGINE, [0, 0], Math.max(1, radius - 5)),
    ]));
}

const ROCK_SHAPES: Shape[] = [
    polygon(ROCK, [[0, -17], [12, -10], [16, 4], [8, 16], [-6, 15], [-16, 4], [-12, -11]]),
    circle(ROCK_LIGHT, [-4, -5], 5),
];

/** Every sprite sheet of the scenario, keyed by rlëD id. */
export function spriteSheets(): Map<number, RasterFrame[]> {
    const skiff = shipSprite(SHIP.skiff);
    const corsair = shipSprite(SHIP.corsair);
    const warden = shipSprite(SHIP.warden);
    return new Map<number, RasterFrame[]>([
        [RLED.skiff, shipFrames(SKIFF, skiff.size, skiff.framesPer)],
        [RLED.corsair, shipFrames(CORSAIR, corsair.size, corsair.framesPer)],
        [RLED.corsairGlow, shipFrames(CORSAIR_GLOW, corsair.size, corsair.framesPer)],
        [RLED.warden, shipFrames(WARDEN, warden.size, warden.framesPer)],
        [RLED.planet, [rasterize(40, 40, PLANET)]],
        [RLED.moon, [rasterize(28, 28, MOON_SHAPES)]],
        [RLED.gate, [rasterize(24, 32, GATE_SHAPES)]],
        [RLED.station, [rasterize(36, 36, STATION_SHAPES)]],
        [RLED.bolt, [rasterize(8, 8, BOLT_SHAPES)]],
        [RLED.missile, rotationFrames(10, 10, MISSILE_SHAPES, 36)],
        [RLED.burst, burstFrames()],
        [RLED.shoal, rotationFrames(20, 20, ROCK_SHAPES, 12)],
    ]);
}

/** The frame geometry a spec can check a parsed sheet against. */
export const SPRITE_GEOMETRY: { [rled: number]: { width: number, height: number, frames: number } } = {
    [RLED.skiff]: { width: 24, height: 24, frames: 36 },
    [RLED.corsair]: { width: 32, height: 32, frames: 36 },
    [RLED.corsairGlow]: { width: 32, height: 32, frames: 36 },
    [RLED.warden]: { width: 40, height: 40, frames: 36 },
    [RLED.planet]: { width: 40, height: 40, frames: 1 },
    [RLED.moon]: { width: 28, height: 28, frames: 1 },
    [RLED.gate]: { width: 24, height: 32, frames: 1 },
    [RLED.station]: { width: 36, height: 36, frames: 1 },
    [RLED.bolt]: { width: 8, height: 8, frames: 1 },
    [RLED.missile]: { width: 10, height: 10, frames: 36 },
    [RLED.burst]: { width: 16, height: 16, frames: 8 },
    [RLED.shoal]: { width: 20, height: 20, frames: 12 },
};
