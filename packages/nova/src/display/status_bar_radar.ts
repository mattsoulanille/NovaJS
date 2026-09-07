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
import { CloakActiveComponent, CloakActiveState, CloakCapability, CloakComponent, deriveCloakScanner } from "../nova_plugin/ship/cloak_plugin.js";
import { DisabledComponent } from "../nova_plugin/ship/disabled_component.js";
import { SimulationGameDataResource } from "../nova_plugin/core/game_data_resource.js";
import { GovtComponent } from "../nova_plugin/core/govt_component.js";
import { deriveIff, planetBlipColor, planetDisposition, PLANET_FLAT_COLOR, shipBlipColor, shipDisposition } from "../nova_plugin/reputation/iff_plugin.js";
import { landable } from "../nova_plugin/core/landable.js";
import { ActiveRanksComponent } from "../nova_plugin/ncb/ncb_plugin.js";
import { isPacifiedToward, NpcComponent } from "../nova_plugin/npc/npc_ai_plugin.js";
import { OutfitsStateComponent, sumOutfitField } from "../nova_plugin/ship/outfit_plugin.js";
import { PlanetComponent, PlanetDataComponent, stellarClearanceFor, StellarBribesComponent } from "../nova_plugin/travel/planet_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import { MissionsComponent } from "../nova_plugin/player/player_state_plugin.js";
import { LegalRecordsComponent } from "../nova_plugin/reputation/reputation_plugin.js";
import { ShipDataComponent } from "../nova_plugin/ship/ship_plugin.js";
import { TargetComponent } from "../nova_plugin/ship/target_component.js";
import { SimulationTimeResource } from "./simulation_time.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { MurkOutfitSystem } from "./system_environment_plugin.js";
import { DrawStatusBarTarget } from "./status_bar_target.js";


/** Full on+off period of the blinking system-center radar arrow, in ms. */
const CENTER_ARROW_BLINK_MS = 700;
/**
 * The selected target's radar blip flashes white: on for the first half of
 * each period. Same wall-clock cadence family as the centre arrow and the
 * running lights (display-only; never sim time). Tunables — the original's
 * exact rate isn't recorded in the reference notes.
 */
export const TARGET_FLASH_MS = 800;
const TARGET_FLASH_COLOR = 0xffffff;
const TARGET_FLASH_SIZE = 2;

/** Whether the target blip is in the ON half of its flash at `time`. */
export function targetFlashOn(time: number): boolean {
    return (time % TARGET_FLASH_MS) < TARGET_FLASH_MS / 2;
}

/**
 * The radar: the player's bright dot, ship and stellar blips, the blinking
 * system-centre arrow, and — under sensor interference — ppat static.
 */
export class RadarPane {
    private radarScale = new Vector(6000, 6000);
    /** Blip graphics; class-owned, so it survives an ïntf reload. */
    readonly graphics = new PIXI.Graphics();
    /** How often DrawRadar redraws the blips, in display ms. */
    period = 200;

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

    constructor(private data: StatusBarData) { }

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
         * system centre. The radar draws a blinking white arrow at its edge
         * pointing that way — the original's cue that you are so far out no
         * stellar shows on the radar. The DrawRadar system passes this only
         * while the arrow should be visible (nothing stellar on radar, and the
         * blink is in its ON phase); otherwise it is omitted.
         */
        centerArrow?: { x: number, y: number } | null,
        /**
         * The uuid of the ship the player has targeted, passed only on the
         * ON phase of its blink: that ship's blip is drawn white and larger
         * over its normal colour, so the selected target flashes on the
         * radar (Matthew's playtest, 2026-08-15 — the original's radar
         * flashes the selected target white).
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
        planetColors?: ReadonlyMap<string, number>) {
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
            const color = shipColors?.get(uuid)
                ?? this.data.colors.dimRadar;
            if (uuid === flashTarget) {
                this.drawDot(position, TARGET_FLASH_COLOR, source,
                    TARGET_FLASH_SIZE);
                continue;
            }
            this.drawDot(position, color, source);
        }

        for (const [uuid, { position }] of planets) {
            this.drawDot(position,
                planetColors?.get(uuid) ?? PLANET_FLAT_COLOR, source, 2);
        }

        if (centerArrow) {
            this.drawCenterArrow(centerArrow.x, centerArrow.y);
        }
    }

    /**
     * Draws a white arrowhead at the radar's edge pointing along (dx, dy) —
     * toward the system centre. Called only when the DrawRadar system has
     * decided the arrow should show this tick.
     */
    private drawCenterArrow(dx: number, dy: number) {
        const radarSize = new Vector(...this.data.dataAreas.radar.size);
        const len = Math.hypot(dx, dy);
        if (len === 0) {
            return;
        }
        const nx = dx / len;
        const ny = dy / len;
        const cx = radarSize.x / 2;
        const cy = radarSize.y / 2;
        // Sit the arrowhead just inside the radar's edge (min half-dimension).
        const edge = Math.min(radarSize.x, radarSize.y) / 2;
        const tipR = edge * 0.95;
        const tipX = cx + nx * tipR;
        const tipY = cy + ny * tipR;
        // Arrowhead triangle: a tip along (nx, ny) and a base behind it.
        const length = 8;
        const halfWidth = 4;
        const baseX = cx + nx * (tipR - length);
        const baseY = cy + ny * (tipR - length);
        const px = -ny;
        const py = nx;
        this.graphics.beginFill(0xFFFFFF);
        this.graphics.moveTo(tipX, tipY);
        this.graphics.lineTo(baseX + px * halfWidth, baseY + py * halfWidth);
        this.graphics.lineTo(baseX - px * halfWidth, baseY - py * halfWidth);
        this.graphics.lineTo(tipX, tipY);
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

    private drawDot(dotPos: Position, color: number, source = new Position(0, 0), size = 1) {
        // draws a dot from nova position. The offset from the player uses the
        // toroidal-nearest delta so an object just across the loop boundary
        // still blips near the player instead of falling off the far edge.
        const radarSize = new Vector(...this.data.dataAreas.radar.size);
        const delta = new Vector(wrapNearestDelta(dotPos.x - source.x),
            wrapNearestDelta(dotPos.y - source.y));
        const pixiPos = delta
            .times(radarSize).div(this.radarScale).add(radarSize.scale(0.5));

        if (pixiPos.x <= radarSize.x && pixiPos.x >= 0 &&
            pixiPos.y <= radarSize.y && pixiPos.y >= 0) {
            // TODO: Make this work with any sizes
            this.graphics.moveTo(pixiPos.x, pixiPos.y);
            this.graphics.beginFill(color);
            this.graphics.lineTo(pixiPos.x + size, pixiPos.y);
            this.graphics.lineTo(pixiPos.x + size, pixiPos.y + size);
            this.graphics.lineTo(pixiPos.x, pixiPos.y + size);
            this.graphics.endFill()
        }
    }
}

const RadarTime = new Component<{ lastTime: number }>('RadarTime');

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
            radarTime = { lastTime: 0 };
            entity.components.set(RadarTime, radarTime);
        }
        if (time - radarTime.lastTime > statusBar.radar.period) {
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
            // radar's range, the original blinks a white arrow at the radar's
            // edge pointing back toward the system centre (0, 0). Chosen gate:
            // "no stellar within the radar's range" (radarScale/2 on each
            // axis) — i.e. nothing stellar is on the radar. Blinks on a
            // wall-clock cadence, like the running lights.
            const range = statusBar.radar.range;
            let stellarOnRadar = false;
            for (const [, { position: planetPos }] of planets) {
                if (Math.abs(wrapNearestDelta(planetPos.x - position.x)) <= range.x
                    && Math.abs(wrapNearestDelta(planetPos.y - position.y)) <= range.y) {
                    stellarOnRadar = true;
                    break;
                }
            }
            const blinkOn = (time % CENTER_ARROW_BLINK_MS)
                < CENTER_ARROW_BLINK_MS / 2;
            const centerArrow = (!stellarOnRadar && blinkOn)
                ? {
                    x: wrapNearestDelta(0 - position.x),
                    y: wrapNearestDelta(0 - position.y),
                }
                : null;
            // The selected target flashes white on the radar.
            const targetUuid = entity.components.get(TargetComponent)?.target;
            statusBar.radar.drawRadar(position, visibleShips, planets, shipColors,
                centerArrow,
                targetUuid && targetFlashOn(time) ? targetUuid : null,
                planetColors);
            radarTime.lastTime = time;
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
