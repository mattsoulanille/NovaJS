import { PlanetData } from "novadatainterface/planet_data";
import { StatusBarData } from "novadatainterface/status_bar_data";
import { GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Position, wrapNearestDelta } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Optional } from "nova_ecs/optional";
import { MovementState, MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import {
    CloakActiveComponent, CloakActiveState, CloakCapability, CloakComponent, deriveCloakScanner,
    DisabledComponent, OutfitsStateComponent, sumOutfitField, ShipDataComponent, TargetComponent,
} from '../nova_plugin/ship/index.js';
import { SimulationGameDataResource, GovtComponent, landable } from '../nova_plugin/core/index.js';
import {
    deriveIff, planetBlipColor, planetDisposition, PLANET_FLAT_COLOR, shipBlipColor,
    shipDisposition, LegalRecordsComponent,
} from '../nova_plugin/reputation/index.js';
import { ActiveRanksComponent } from "../nova_plugin/ncb/index.js";
import { isPacifiedToward, NpcComponent } from "../nova_plugin/npc/index.js";
import { PlanetComponent, PlanetDataComponent, stellarClearanceFor, StellarBribesComponent } from "../nova_plugin/travel/index.js";
import { PlayerShipSelector, MissionsComponent } from '../nova_plugin/player/index.js';
import { SimulationTimeResource } from "./simulation_time.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { MurkOutfitSystem } from "./system_environment_plugin.js";
import { DrawStatusBarTarget } from "./status_bar_target.js";


/**
 * The radar's ONE clock (#358). The original redraws its radar at 4 Hz:
 * in three 60 fps recordings of it (Windows build, 1432 / 3134 / 1733
 * frames) the radar's pixels change only every 15.0 frames — mean period
 * 251.1 / 249.7 / 250.0 ms — blip positions, the centre arrow, the target
 * blip's flash and the sensor static alike, and nothing on it (the player's
 * dot included) changes in between. Everything the radar shows therefore
 * steps on this quantum of the display world's clock (TimeResource), never
 * per display frame and never Date.now. Maintainer ruling 2026-10-03: "We
 * can match the 4 per second update frequency."
 */
export const RADAR_REFRESH_MS = 250;

/** Which radar refresh `time` (display-world ms) falls in. */
export function radarRefreshIndex(time: number): number {
    return Math.floor(time / RADAR_REFRESH_MS);
}

/**
 * Whether the radar's blinking elements — the system-centre arrow and the
 * selected target's white flash — are ON in this refresh: one refresh on,
 * one off. The recordings show exactly that: the arrow is drawn for 15
 * frames and absent for 15 (250 ms / 250 ms, a 500 ms period, over ~47
 * blinks), and a targeted blip alternates white / grey on consecutive
 * refreshes. The two were never recorded together, so their relative phase
 * is unmeasured; they share this one.
 */
export function radarBlinkOn(refresh: number): boolean {
    return ((refresh % 2) + 2) % 2 === 0;
}

/** One radar pixel, in radar-local pixel coordinates. */
export type RadarPixel = readonly [number, number];

/**
 * The system-centre arrow's geometry, as fractions of the radar's
 * half-size (min(width, height) / 2), fitted to 22 arrow-visible frames of
 * the original at bearings from -171° to -125° (radar 176 px, half-size 88;
 * the recording is at 2x, one radar pixel = 2x2 capture pixels):
 *  - the shaft is RADIAL — the tail sits on the centre->tip line to within
 *    a pixel at every bearing — and starts a gap out from the player's dot:
 *    tail radius 26.97 ± 0.32 px (27 / 88), tip radius 50.96 ± 0.29 px
 *    (51 / 88);
 *  - the head is an OPEN chevron: two one-pixel strokes back from the tip,
 *    each about 5 px long (endpoints 4-6 px out, pixel rounding) at about
 *    45° either side of the shaft (measured 35-55°);
 *  - every stroke is one radar pixel wide, in the same grey as the ship
 *    blips and stellar rings (capture value 118 vs blips 119-120; the
 *    player's dot reads 249), i.e. the ïntf's dimRadar.
 * Scaled by the radar's size so a non-stock ïntf radar (#205) keeps the
 * proportions.
 */
export const CENTER_ARROW_TAIL = 27 / 88;
export const CENTER_ARROW_TIP = 51 / 88;
export const CENTER_ARROW_HEAD = 5 / 88;

/** The pixels of a one-pixel line between two integer points (Bresenham). */
export function linePixels(x0: number, y0: number, x1: number,
    y1: number): RadarPixel[] {
    const pixels: RadarPixel[] = [];
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
        pixels.push([x, y]);
        if (x === x1 && y === y1) {
            return pixels;
        }
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y += sy;
        }
    }
}

/**
 * The radar pixel the player's own dot occupies: the radar's centre,
 * snapped down to a whole pixel (88, 88 on the stock 176 x 176 radar).
 */
export function radarCenterPixel(radarSize: readonly [number, number]):
    RadarPixel {
    return [Math.floor(radarSize[0] / 2), Math.floor(radarSize[1] / 2)];
}

/**
 * The system-centre arrow as whole radar pixels: a radial shaft from
 * CENTER_ARROW_TAIL to CENTER_ARROW_TIP of the radar's half-size along
 * (dx, dy) — the direction to the system centre — and an open two-stroke
 * head. Every endpoint is rounded to a pixel and every stroke rasterised
 * one pixel wide, so the arrow is crisp at any bearing (no anti-aliased
 * half-pixel lines). Empty for a zero direction.
 */
export function centerArrowPixels(dx: number, dy: number,
    radarSize: readonly [number, number]): RadarPixel[] {
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) {
        return [];
    }
    const ux = dx / len;
    const uy = dy / len;
    const [cx, cy] = radarCenterPixel(radarSize);
    const half = Math.min(radarSize[0], radarSize[1]) / 2;
    const at = (r: number) => [Math.round(cx + ux * r * half),
        Math.round(cy + uy * r * half)] as const;
    const [tailX, tailY] = at(CENTER_ARROW_TAIL);
    const [tipX, tipY] = at(CENTER_ARROW_TIP);
    // The head strokes run back from the tip at 45° either side of the
    // shaft: the backward unit vector (-ux, -uy) rotated by ±45°.
    const head = CENTER_ARROW_HEAD * half;
    const s = Math.SQRT1_2;
    const bx = -ux;
    const by = -uy;
    const strokes = [
        [(bx - by) * s, (bx + by) * s],
        [(bx + by) * s, (by - bx) * s],
    ];
    const seen = new Set<string>();
    const pixels: RadarPixel[] = [];
    const add = (line: RadarPixel[]) => {
        for (const p of line) {
            const key = `${p[0]},${p[1]}`;
            if (!seen.has(key)) {
                seen.add(key);
                pixels.push(p);
            }
        }
    };
    add(linePixels(tailX, tailY, tipX, tipY));
    for (const [hx, hy] of strokes) {
        add(linePixels(tipX, tipY, Math.round(tipX + hx * head),
            Math.round(tipY + hy * head)));
    }
    return pixels;
}

/**
 * A ship blip's size in radar pixels. Without a density scanner (oütf
 * ModType 13 — stock Gravimetric Sensors nova:184, Physical Sense
 * nova:252) every ship is one pixel. With one, the Bible's shïp Mass
 * table applies: "1-99 ... small blip on density scanner", "100-199" and
 * "200 and up ... large blip". The recordings agree: without add-ons every
 * tracked ship is 1 px; with Gravimetric Sensors most are 2 x 2 and a few
 * stay 1 px (the two clips show different ships, so the 100-ton threshold
 * is the Bible's, not fitted).
 */
export const DENSITY_SCANNER_LARGE_MASS = 100;
export function shipBlipSize(mass: number | undefined,
    densityScanner: boolean): number {
    return densityScanner && (mass ?? 0) >= DENSITY_SCANNER_LARGE_MASS
        ? 2 : 1;
}

/**
 * How a stellar shows on the radar. The original draws planet-sized
 * stellars as a hollow ring and small ones (moons, small stations,
 * destroyed hypergates) as a filled 2 x 2 dot, both centred on the
 * stellar's radar pixel. Evidence: Kiniké (sprite 112) is a ring and Kolan
 * (48) a dot on original_macos_screenshots/space/in_space_2.png; Jupiter
 * (325) and Earth (150) rings, Europa (40) and Mars (48) dots on
 * in_space.png; and in the two new Windows recordings (a system laid out
 * like Porto Rillia: a 120 px planet at the centre and a 53 x 60 hypergate
 * 300, 150 from it) a stationary ring with a stationary 2 x 2 dot exactly
 * (9-9.5, 4-4.5) px from it — the dot that is the one 2 px blip in the
 * no-add-ons clip. The size is read off the stellar's collision hull
 * (≈ its sprite). The cut-off lies somewhere in the unmeasured 61-109 px
 * band; STELLAR_RING_MIN_SIZE sits in the gap in the stock sprite sizes
 * (nothing between 56 and 72).
 */
export const STELLAR_RING_MIN_SIZE = 64;
export type StellarRadarShape = 'ring' | 'dot';
export function stellarRadarShape(size: number | undefined):
    StellarRadarShape {
    return size !== undefined && size < STELLAR_RING_MIN_SIZE ? 'dot' : 'ring';
}

/**
 * The stellar ring's pixels relative to the stellar's radar pixel: a 5 x 5
 * square ring with its corners cut, 12 pixels, one pixel thick — the shape
 * on every unobstructed ring in the Windows recordings (hundreds of
 * frames). The Mac capture in_space.png draws Jupiter's ring 6 x 6 with 16
 * pixels instead; the maintainer's recording is the reference here.
 */
export const STELLAR_RING_PIXELS: readonly RadarPixel[] = [
    [-1, -2], [0, -2], [1, -2],
    [-2, -1], [2, -1],
    [-2, 0], [2, 0],
    [-2, 1], [2, 1],
    [-1, 2], [0, 2], [1, 2],
];

/** A filled size x size blip's pixels, top-left at the blip's pixel. */
export function blipPixels(size: number): RadarPixel[] {
    const pixels: RadarPixel[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            pixels.push([x, y]);
        }
    }
    return pixels;
}

/**
 * The size of a stellar's sprite for stellarRadarShape: the larger extent
 * of its collision hull (SpriteSheetData.hulls, frame 0), which tracks the
 * sprite's own size for every stock stellar. Undefined until the sprite
 * sheet caches.
 */
export function stellarHullSize(hulls: readonly (readonly (readonly
    [number, number])[])[][] | undefined): number | undefined {
    const frame = hulls?.[0];
    if (!frame || frame.length === 0) {
        return undefined;
    }
    let mx = 0;
    let my = 0;
    for (const convex of frame) {
        for (const [x, y] of convex) {
            mx = Math.max(mx, Math.abs(x));
            my = Math.max(my, Math.abs(y));
        }
    }
    return 2 * Math.max(mx, my);
}

/**
 * The radar: the player's bright dot, ship and stellar blips, the blinking
 * system-centre arrow, and — under sensor interference — ppat static.
 */
export class RadarPane {
    private radarScale = new Vector(6000, 6000);

    /**
     * The system's sensor interference (0-100), from the sÿst resource. Zero
     * is a clear radar; 100 is a complete sensor blackout. Static per system,
     * so it is read display-side and never affects the simulation.
     */
    systemInterference = 0;
    /**
     * Interference removed by outfits (the "Radar Interference" outfit
     * modifier, EVN Bible / ResForge outf case 24). A radar-interference
     * outfit hook can raise this to clear up the radar; the effective
     * interference is clamped so it never drops below zero.
     */
    interferenceReduction = 0;
    /**
     * The sensor-static pixel patterns (the ppat resources from Nova
     * Graphics 1). Each radar tick is replaced wholesale by one of these,
     * tiled, with probability interference / 100 — matching the original
     * engine's static, rather than per-blip noise.
     */
    staticTextures: PIXI.Texture[] = [];
    /** Per-build: sized to the ïntf's radar area. */
    private staticSprite?: PIXI.TilingSprite;

    /**
     * `graphics`: the blip graphics; class-owned, so it survives an ïntf
     * reload. Injectable only so node specs (no canvas, so no real
     * PIXI.Graphics) can record what the radar fills.
     */
    constructor(private data: StatusBarData,
        readonly graphics: PIXI.Graphics = new PIXI.Graphics()) { }

    /** The effective interference after outfit reductions, clamped 0-100. */
    private get interference(): number {
        return Math.max(0, Math.min(100,
            this.systemInterference - this.interferenceReduction));
    }

    /**
     * Half the radar's world span on each axis: a stellar within this of the
     * player shows as a blip. Used to decide when to draw the system-center
     * arrow (when nothing stellar is on the radar).
     */
    get range(): Vector {
        return this.radarScale.scale(0.5);
    }

    /**
     * A different ïntf: new data area and colours from the next draw on.
     * The static sprite was sized for the old area and is destroyed by
     * StatusBar.reload with the rest of the outgoing tree.
     */
    reset(data: StatusBarData) {
        this.data = data;
        this.staticSprite = undefined;
    }

    build(parent: PIXI.Container) {
        const radar = this.data.dataAreas.radar;
        [this.graphics.position.x, this.graphics.position.y] = radar.position;
        parent.addChild(this.graphics);
        this.staticSprite = new PIXI.TilingSprite(PIXI.Texture.EMPTY,
            radar.size[0], radar.size[1]);
        [this.staticSprite.position.x, this.staticSprite.position.y] =
            radar.position;
        this.staticSprite.visible = false;
        parent.addChild(this.staticSprite);
    }

    drawRadar(source: Position,
        ships: Iterable<readonly [string, MovementState, ...unknown[]]>,
        planets: Iterable<readonly [string, MovementState, PlanetData,
            ...unknown[]]>,
        /**
         * Per-ship blip colour by uuid. When the map is absent or a ship is
         * missing from it, that blip uses the flat dimRadar colour. DrawRadar
         * fills it in for two reasons (iff_plugin's shipBlipColor): a DISABLED
         * ship is always grey, and — when the player owns an IFF outfit
         * (ModType 14) — every ship takes its disposition's colour (EVN Bible:
         * an IFF outfit overrides the radar colours).
         */
        shipColors?: ReadonlyMap<string, number>,
        /**
         * When set, the toroidal-nearest direction from the player to the
         * system centre. The radar draws its thin grey line arrow
         * (centerArrowPixels) pointing that way — the original's cue that
         * you are so far out no stellar shows on the radar. The DrawRadar
         * system passes this only while the arrow should be visible
         * (nothing stellar on radar, and the refresh is a blink-ON one);
         * otherwise it is omitted.
         */
        centerArrow?: { x: number, y: number } | null,
        /**
         * The uuid of the ship the player has targeted, passed only on
         * blink-ON refreshes: that ship's blip is drawn in the bright radar
         * colour at its normal size, so the selected target flashes on the
         * radar (Matthew's playtest, 2026-08-15; the recordings show it
         * white at the blip's own 1 or 2 px, alternating with its grey on
         * consecutive refreshes).
         */
        flashTarget?: string | null,
        /**
         * Per-stellar blip colour by uuid. Stellars are yellow
         * (PLANET_FLAT_COLOR, measured off the original captures) until the
         * player owns an IFF outfit, at which point DrawRadar fills this in
         * with the landing-clearance palette (iff_plugin's planetBlipColor) —
         * the same rule ship blips follow. Missing entries fall back to the
         * flat colour.
         */
        planetColors?: ReadonlyMap<string, number>,
        /**
         * Per-ship blip size in pixels by uuid (shipBlipSize); missing
         * entries are 1 px. DrawRadar fills it in only while the player
         * owns a density scanner.
         */
        shipSizes?: ReadonlyMap<string, number>,
        /**
         * Per-stellar radar shape by uuid (stellarRadarShape); missing
         * entries draw the ring.
         */
        planetShapes?: ReadonlyMap<string, StellarRadarShape>) {
        this.graphics.clear();

        // Interference (0-100) makes sensors unreliable: on each radar tick,
        // with probability interference / 100, the whole radar is replaced by
        // one of the ppat static patterns, tiled — the original engine's
        // behavior. At 100 the radar is pure static (a complete sensor
        // blackout); otherwise this tick draws normally.
        if (this.drawSensorStatic()) {
            return;
        }

        this.drawDot(source, this.data.colors.brightRadar, source);

        for (const [uuid, { position }] of ships) {
            const size = shipSizes?.get(uuid) ?? 1;
            const color = uuid === flashTarget
                ? this.data.colors.brightRadar
                : shipColors?.get(uuid) ?? this.data.colors.dimRadar;
            this.drawDot(position, color, source, size);
        }

        for (const [uuid, { position }] of planets) {
            const color = planetColors?.get(uuid) ?? PLANET_FLAT_COLOR;
            if (planetShapes?.get(uuid) === 'dot') {
                this.drawDot(position, color, source, 2);
            } else {
                this.drawPixels(this.radarPixelOf(position, source),
                    STELLAR_RING_PIXELS, color);
            }
        }

        if (centerArrow) {
            this.drawPixels([0, 0], centerArrowPixels(centerArrow.x,
                centerArrow.y, this.data.dataAreas.radar.size),
                this.data.colors.dimRadar);
        }
    }

    /**
     * The whole radar pixel a world position falls on, relative to the
     * player at the radar's centre pixel. Uses the toroidal-nearest delta
     * so an object just across the loop boundary still blips near the
     * player instead of falling off the far edge; snapped down to a pixel
     * so every blip is crisp.
     */
    private radarPixelOf(position: Position, source: Position): RadarPixel {
        const [w, h] = this.data.dataAreas.radar.size;
        const [cx, cy] = radarCenterPixel([w, h]);
        return [
            cx + Math.floor(wrapNearestDelta(position.x - source.x)
                * w / this.radarScale.x),
            cy + Math.floor(wrapNearestDelta(position.y - source.y)
                * h / this.radarScale.y),
        ];
    }

    /**
     * Fills single radar pixels at `origin` + each offset, clipped to the
     * radar area (a ring at the edge shows only its inside part, as the
     * original's does).
     */
    private drawPixels(origin: RadarPixel, pixels: readonly RadarPixel[],
        color: number) {
        const [w, h] = this.data.dataAreas.radar.size;
        this.graphics.beginFill(color);
        for (const [dx, dy] of pixels) {
            const x = origin[0] + dx;
            const y = origin[1] + dy;
            if (x >= 0 && y >= 0 && x < w && y < h) {
                this.graphics.drawRect(x, y, 1, 1);
            }
        }
        this.graphics.endFill();
    }

    /**
     * Probabilistically replaces this radar tick with static. Returns whether
     * it did, in which case no blips should be drawn.
     */
    private drawSensorStatic(): boolean {
        if (!this.staticSprite || this.staticTextures.length === 0 ||
            Math.random() * 100 >= this.interference) {
            if (this.staticSprite) {
                this.staticSprite.visible = false;
            }
            return false;
        }
        this.staticSprite.texture = this.staticTextures[
            Math.floor(Math.random() * this.staticTextures.length)];
        this.staticSprite.visible = true;
        return true;
    }

    /**
     * A size x size filled blip with its top-left on the position's radar
     * pixel (a 1 px ship, a 2 x 2 large ship or small stellar).
     */
    private drawDot(dotPos: Position, color: number, source: Position,
        size = 1) {
        this.drawPixels(this.radarPixelOf(dotPos, source),
            blipPixels(size), color);
    }
}

/** The radar refresh (radarRefreshIndex) DrawRadar last drew. */
const RadarTime = new Component<{ lastRefresh: number }>('RadarTime');

/**
 * Whether a ship's cloak takes it off the radar: actively cloaked with a
 * device whose 0x0002 "Visible on radar" bit is CLEAR (EVN Bible, oütf
 * ModType 17; CloakData.hidesFromRadar is that bit inverted). Five of
 * the six stock cloaks set the bit — Fed nova:211, Rebel nova:234/347,
 * Wraith nova:266, Cloaking Organ v1.0 nova:268 — so those ships stay
 * blips; only Cloaking Organ v1.1 nova:269 hides.
 *
 * `cloak` is the ship's CloakComponent, which the display derives from
 * its synced outfits (cloak_display_plugin.ts); the sim never sends it,
 * and before that plugin existed it was always undefined here, so the
 * conservative default hid EVERY cloaked ship. The default stays: a
 * cloak whose data has not cached yet hides until it has.
 */
export function radarHidesShip(cloakActive: CloakActiveState | undefined,
    cloak: CloakCapability | undefined): boolean {
    return cloakActive?.active === true && (cloak?.hidesFromRadar ?? true);
}

export const DrawRadar = new System({
    name: 'DrawRadar',
    args: [Optional(RadarTime), TimeResource, SimulationTimeResource,
        StatusBarResource, MovementStateComponent,
    new Query([UUID, MovementStateComponent, ShipDataComponent,
        Optional(CloakActiveComponent), Optional(CloakComponent),
        Optional(GovtComponent), Optional(DisabledComponent),
        Optional(NpcComponent)] as const),
    new Query([UUID, MovementStateComponent, PlanetDataComponent,
        PlanetComponent] as const),
        SimulationGameDataResource, GetEntity, UUID,
        PlayerShipSelector] as const,
    step(radarTime, { time }, simTime, statusBar, { position }, ships, planets,
        gameData, entity, playerUuid) {
        if (!radarTime) {
            radarTime = { lastRefresh: NaN };
            entity.components.set(RadarTime, radarTime);
        }
        // One redraw per RADAR_REFRESH_MS quantum of the display clock, on
        // the quantum boundary: everything below — blip positions, sizes,
        // the static roll, the arrow's direction and blink, the target
        // flash — holds still for the whole quantum, as the original's does.
        const refresh = radarRefreshIndex(time);
        if (refresh !== radarTime.lastRefresh) {
            // Hide ships that are actively cloaked with a radar-hiding
            // cloak (bit 0x0002 "visible on radar" clear), unless the
            // player has a cloak scanner that reveals cloaked ships on
            // radar (ModVal 0x0001). Builds on the merged interference/
            // static radar. The player's own ship is drawn separately
            // from `source`, so it always shows.
            // Like IFF below, the scanner capability is derived here from
            // the player's delta-synced outfits: CloakScannerComponent is a
            // sim-side provider output that never crosses the bridge, so
            // reading it off the mirrored entity always came back empty.
            const scannerOutfits =
                entity.components.get(OutfitsStateComponent);
            const revealsCloaked = scannerOutfits
                ? deriveCloakScanner(scannerOutfits, gameData)
                    ?.revealsOnRadar === true
                : false;
            const visibleShips = revealsCloaked ? ships : ships.filter(
                ([, , , cloakActive, cloak]) =>
                    !radarHidesShip(cloakActive, cloak));

            // IFF (ModType 14): when the player owns an IFF outfit, colour
            // each ship's blip by its disposition toward the player. Without
            // IFF, or before govt data caches, blips stay the flat dim colour.
            // The capability is derived here from the player's (delta-synced)
            // outfits rather than read off a component: the radar runs in the
            // display world, and IffComponent lives only in the sim worker.
            //
            // DISABLED ships (DisabledComponent — real, serializer-registered
            // sim state, so it is here in the display world) are GREY with or
            // without IFF, ahead of hostile red: dead in space is a fact about
            // the ship, not about the pilot, exactly as the gray corner set
            // reads it (hostility.ts's styleForTarget).
            const playerOutfits = entity.components.get(OutfitsStateComponent);
            const hasIff = playerOutfits
                ? deriveIff(playerOutfits, gameData)?.hasIff === true : false;
            const playerGovtId = hasIff
                ? entity.components.get(GovtComponent)?.id : undefined;
            const playerGovt = playerGovtId
                ? gameData.data.Govt.getCached(playerGovtId) : undefined;
            // The player's legal records (delta-synced): a govt the
            // player is criminal with shows hostile blips.
            const playerRecords = hasIff
                ? entity.components.get(LegalRecordsComponent) : undefined;
            const shipColors = new Map<string, number>();
            for (const [uuid, , , , , shipGovt, disabled, npc]
                of visibleShips) {
                const govt = (hasIff && shipGovt)
                    ? gameData.data.Govt.getCached(shipGovt.id) : undefined;
                // A ship this player has BOUGHT OFF (beg for mercy) reads
                // neutral until the reprieve lapses, the same tier the
                // target corners and the point defense prey filter honour
                // (hostility.ts's styleForTarget) — Matthew: "its IFF should
                // become neutral again". A pirate's politics never soften,
                // so without this the blip stayed red for a truce the player
                // had already paid for. Judged on the MIRRORED SIM CLOCK,
                // which is what stamped pacifiedUntil; this world's
                // TimeResource is wall-clock epoch ms and would call every
                // reprieve expired.
                const color = shipBlipColor(
                    hasIff && !isPacifiedToward(npc, playerUuid, simTime.time)
                        ? shipDisposition(govt, playerGovt, playerRecords)
                        : 'neutral',
                    hasIff, disabled !== undefined);
                if (color !== undefined) {
                    shipColors.set(uuid, color);
                }
            }
            // Stellars are coloured by LANDING CLEARANCE: neutral (you may
            // land) yellow, forbidden orange, hostile red — one reading of
            // the ONE clearance predicate the landing gate and the comm
            // dialog use (stellar_clearance.ts), so a blip can never promise
            // a landing the gate refuses — under the same IFF gate as ships
            // (without IFF every landable stellar stays the flat yellow).
            // UNLANDABLE stellars (Jupiter, scenery worlds, dead gates —
            // landable.ts) are GREY with or without IFF: that is a fact
            // about the stellar, not about the pilot.
            const planetRecords = entity.components.get(LegalRecordsComponent);
            const bribes = entity.components.get(StellarBribesComponent);
            const shipData = entity.components.get(ShipDataComponent);
            const planetRanks = entity.components.get(ActiveRanksComponent);
            const planetMissions = entity.components.get(MissionsComponent);
            const planetColors = new Map<string, number>();
            for (const [uuid, , planetData, planet] of planets) {
                const isLandable = landable(planetData);
                const clearance = (hasIff && isLandable)
                    ? stellarClearanceFor({
                        planetData, gameData, records: planetRecords,
                        shipData, outfits: playerOutfits, bribes,
                        ranks: planetRanks, missions: planetMissions,
                        // Bribe expiries are SIM-clock stamps (0-based
                        // logical time); this world's TimeResource is the
                        // wall clock, ~50 years past every expiry.
                        planetId: planet.id, now: simTime.time,
                    })
                    : { cleared: true } as const;
                planetColors.set(uuid, planetBlipColor(
                    planetDisposition(clearance, isLandable), hasIff));
            }
            // System-center arrow: when no stellar object falls within the
            // radar's range, the original blinks a thin grey line arrow out
            // from the player's dot toward the system centre (0, 0) —
            // one refresh on, one off (centerArrowPixels). Chosen gate:
            // "no stellar within the radar's range" (radarScale/2 on each
            // axis) — i.e. nothing stellar is on the radar. Blinks on the
            // radar's own refresh clock (radarBlinkOn).
            const range = statusBar.radar.range;
            let stellarOnRadar = false;
            for (const [, { position: planetPos }] of planets) {
                if (Math.abs(wrapNearestDelta(planetPos.x - position.x)) <= range.x
                    && Math.abs(wrapNearestDelta(planetPos.y - position.y)) <= range.y) {
                    stellarOnRadar = true;
                    break;
                }
            }
            const blinkOn = radarBlinkOn(refresh);
            const centerArrow = (!stellarOnRadar && blinkOn)
                ? {
                    x: wrapNearestDelta(0 - position.x),
                    y: wrapNearestDelta(0 - position.y),
                }
                : null;
            // Density scanner (oütf ModType 13): ship blips sized by hull
            // mass. Derived from the player's delta-synced outfits, like
            // IFF above; display-only.
            const densityScanner = playerOutfits
                ? (sumOutfitField(playerOutfits, gameData,
                    o => o.densityScanner ? 1 : 0) ?? 0) > 0
                : false;
            const shipSizes = new Map<string, number>();
            if (densityScanner) {
                for (const [uuid, , shipData] of visibleShips) {
                    shipSizes.set(uuid,
                        shipBlipSize(shipData.physics.mass, true));
                }
            }
            // Planet-sized stellars are rings, small ones 2 x 2 dots. The
            // stellar's sprite sheet (hulls) is needed to tell; until it
            // caches the stellar draws as a ring, and the fetch is started
            // so the next refresh knows.
            const planetShapes = new Map<string, StellarRadarShape>();
            for (const [uuid, , planetData] of planets) {
                const spriteId = planetData.animation.images.baseImage.id;
                const sheet = gameData.data.SpriteSheet.getCached(spriteId);
                if (!sheet) {
                    gameData.data.SpriteSheet.get(spriteId).catch(() => { });
                }
                planetShapes.set(uuid,
                    stellarRadarShape(stellarHullSize(sheet?.hulls)));
            }
            // The selected target flashes on blink-ON refreshes.
            const targetUuid = entity.components.get(TargetComponent)?.target;
            statusBar.radar.drawRadar(position, visibleShips, planets, shipColors,
                centerArrow,
                targetUuid && blinkOn ? targetUuid : null,
                planetColors, shipSizes, planetShapes);
            radarTime.lastRefresh = refresh;
        }
    },
    // #156 pin (shared: OutfitsState, ShipControl, SimulationGameData):
    // StatusBarPlugin registers after SystemEnvironmentPlugin.
    after: [MurkOutfitSystem],
});

/**
 * Feeds the interference-mod outfits (oütf ModType 24) into the radar: sums
 * the player ship's owned outfits' interferenceReduction and writes it to the
 * status bar. The Bible: "Subtracts the value in ModVal from the current star
 * system's Interference value when calculating how fuzzy to make the radar."
 * Display-only (interference never affects the simulation), so this reads the
 * player's outfits directly. A stock Sensor Boost (nova:203) clears 20
 * interference; several stack. Runs every step so buying/selling updates it.
 */
export const DrawStatusBarInterference = new System({
    name: 'DrawStatusBarInterference',
    args: [StatusBarResource, OutfitsStateComponent,
        SimulationGameDataResource, PlayerShipSelector] as const,
    step(statusBar, outfits, gameData) {
        const reduction = sumOutfitField(
            outfits, gameData, o => o.interferenceReduction);
        if (reduction !== undefined) {
            statusBar.radar.interferenceReduction = reduction;
        }
    },
    // #156 pin (shared: *): StatusBarPlugin's registration order.
    after: [DrawStatusBarTarget],
});
