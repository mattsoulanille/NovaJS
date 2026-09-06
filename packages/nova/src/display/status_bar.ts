import { PlanetData } from "novadatainterface/planet_data";
import { StatusBarData, StatusBarDataArea } from "novadatainterface/status_bar_data";
import { Position, wrapNearestDelta } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { EcsEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementState } from "nova_ecs/plugins/movement_plugin";
import * as PIXI from "pixi.js";
import { Subject } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { ControlAction } from "../nova_plugin/controls.js";
import { discoveryLevel } from "../nova_plugin/discovery_store.js";
import { DisplayAssetDataResource, SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { FUEL_PER_JUMP } from "../nova_plugin/health_plugin.js";
import { PLANET_FLAT_COLOR } from "../nova_plugin/iff_plugin.js";
import { Stat } from "../nova_plugin/stat.js";
import { SystemIdResource } from "../nova_plugin/system_id_resource.js";
import { Button, ButtonClick } from "../spaceport/button.js";
import { AnimationGraphic } from "./animation_graphic.js";
import { DockedShipResource } from "./docked_ship.js";
import { PixiAppResource } from "./pixi_app_resource.js";
import { ScreenSize } from "./screen_size_plugin.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { Stage } from "./stage_resource.js";
import { DrawStatusBarCargo } from "./status_bar_cargo.js";
import { CargoLine, formatCredits, NavReadout } from "./status_bar_content.js";
import { DrawDockedStatus } from "./status_bar_docked.js";
import { DrawStatusBarStats, statFullness } from "./status_bar_gauges.js";
import {
    DEFAULT_STATUS_BAR_ID, SelectStatusBarInterface, StatusBarResize,
} from "./status_bar_interface.js";
import {
    CARGO_CREDITS_LABEL_Y, CARGO_CREDITS_VALUE_Y, CARGO_FREE_VALUE_X,
    CARGO_FREE_Y, CARGO_LABEL_X, CARGO_LINE_PITCH, CARGO_LINE_Y, CARGO_NAME_X,
    CARGO_QUANTITY_X, CARGO_SPECIAL_LABEL_Y, CARGO_SPECIAL_VALUE_Y,
    CARGO_VALUE_X, DEBUG_BUTTON_X, NAV_HEADER_Y, NAV_VALUE_Y,
    NO_TARGET_CENTER_BELOW_MIDDLE, TARGET_NAME_Y, TARGET_SPRITE_TINT,
    TARGET_SUBTITLE_Y,
} from "./status_bar_layout.js";
import { DiscoveryLevelResource, DrawStatusBarNavigation } from "./status_bar_navigation.js";
import {
    DrawRadar, DrawStatusBarInterference, TARGET_FLASH_COLOR,
    TARGET_FLASH_SIZE,
} from "./status_bar_radar.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { DrawStatusBarTarget } from "./status_bar_target.js";
import { DrawStatusBarSecondaryWeapon } from "./status_bar_weapon.js";
import { targetReadout } from "./target_readout.js";

export class StatusBar {
    readonly container = new PIXI.Container();
    /** Resolves when the current build (or reload) has finished. */
    buildPromise: Promise<void>;
    built = false;
    width = 0;
    private radarScale = new Vector(6000, 6000);
    private radar = new PIXI.Graphics();
    radarPeriod = 200;
    private statsGraphics = new PIXI.Graphics();

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
    private staticSprite?: PIXI.TilingSprite;

    /** The effective interference after outfit reductions, clamped 0-100. */
    private get interference(): number {
        return Math.max(0, Math.min(100,
            this.systemInterference - this.interferenceReduction));
    }

    private targetContainer = new PIXI.Container();
    private noTargetContainer = new PIXI.Container();
    private targetSprite = new PIXI.Sprite();

    /**
     * A single RenderTexture reused across frames to draw the locked
     * target's ship graphic. Reallocated (destroying the old one and its
     * base texture) only when the required size changes, so a locked
     * target no longer leaks a fresh GPU texture every display frame.
     */
    private targetRenderTexture?: PIXI.RenderTexture;

    private text: { [index: string]: PIXI.Text } = {};
    private brightFont!: PIXI.TextStyle;
    private dimFont!: PIXI.TextStyle;
    private subtitleFont!: PIXI.TextStyle;
    /**
     * Reused text objects for the regular-cargo manifest (left column): the
     * dim commodity name and the bright quantity are separate so the
     * quantities share one column (CARGO_QUANTITY_X) regardless of how wide
     * the name is, the way the original stacks "Food: 9 / Ind: 9 / LuxG: 9".
     */
    private cargoNameTexts: PIXI.Text[] = [];
    private cargoQuantityTexts: PIXI.Text[] = [];
    private cargoContainer?: PIXI.Container;
    private static readonly MAX_CARGO_LINES = 6;
    private addEnemyButton: Button;
    private giveCreditsButton: Button;
    private clearRecordButton: Button;
    readonly addEnemy: Subject<ButtonClick>;
    /** "Give 1M Credits" debug cheat. */
    readonly giveCredits: Subject<ButtonClick>;
    /** "Clear Legal Record" debug cheat. */
    readonly clearRecord: Subject<ButtonClick>;

    constructor(private statusBarData: StatusBarData, private displayAssets: DisplayAssetDataInterface,
                private renderer: PIXI.Renderer | PIXI.IRenderer) {
        this.buildPromise = this.build();
        this.container.name = 'StatusBar';
        this.addEnemyButton = new Button(displayAssets, 'Add Enemy', 60);
        this.addEnemyButton.container.position.x = DEBUG_BUTTON_X;
        // One full button height (25px) below its old spot, clear of the
        // status bar's credits readout it used to clip over.
        this.addEnemyButton.container.position.y = 555;
        this.addEnemy = this.addEnemyButton.click;

        // The two cheat buttons stacked one button height (25px) apart
        // directly under Add Enemy, at the same x. Named for scene-graph
        // queries and hidden by the visual-compare harness.
        this.giveCreditsButton = new Button(displayAssets, 'Give 1M Credits', 100);
        this.giveCreditsButton.container.position.x = DEBUG_BUTTON_X;
        this.giveCreditsButton.container.position.y = 580;
        this.giveCredits = this.giveCreditsButton.click;

        this.clearRecordButton = new Button(displayAssets, 'Clear Legal Record', 110);
        this.clearRecordButton.container.position.x = DEBUG_BUTTON_X;
        this.clearRecordButton.container.position.y = 605;
        this.clearRecord = this.clearRecordButton.click;
    }

    private async build() {
        const background = await this.displayAssets.spriteFromPictAsync(this.statusBarData.image);
        this.container.addChild(background);
        this.width = background.width;
        // Hit-testable so a click on the panel (radar, readouts) is seen
        // as a click on UI by tap_targeting's isBlocked hit test, not as a
        // click on the space drawn behind it.
        background.eventMode = 'static';
        const dataAreas = this.statusBarData.dataAreas;
        [this.radar.position.x, this.radar.position.y] = dataAreas.radar.position;
        this.container.addChild(this.radar);
        this.staticSprite = new PIXI.TilingSprite(PIXI.Texture.EMPTY,
            dataAreas.radar.size[0], dataAreas.radar.size[1]);
        [this.staticSprite.position.x, this.staticSprite.position.y] =
            dataAreas.radar.position;
        this.staticSprite.visible = false;
        this.container.addChild(this.staticSprite);
        this.container.addChild(this.statsGraphics);
        this.targetContainer.addChild(this.targetSprite);
        this.targetSprite.anchor.set(0.5, 0.5);
        this.targetSprite.tint = TARGET_SPRITE_TINT;
        this.targetSprite.position.x =
            this.statusBarData.dataAreas.targeting.size[0] / 2;
        this.targetSprite.position.y =
            this.statusBarData.dataAreas.targeting.size[1] / 2;

        this.makeText();
        this.container.addChild(this.addEnemyButton.container);
        this.container.addChild(this.giveCreditsButton.container);
        this.container.addChild(this.clearRecordButton.container);
        this.built = true;
    }

    private makeText() {
        // Text sizes and colours come from the parsed ïntf resource
        // (StatFontSize / SubtitleSize and the bright/dim text colours).
        const fontFamily = 'Geneva';
        const fontSize = this.statusBarData.fontSize || 12;
        const subtitleSize = this.statusBarData.subtitleSize || 10;
        const font = new PIXI.TextStyle({
            fontFamily,
            fontSize,
            align: 'center',
            fill: this.statusBarData.colors.brightText,
        });
        const dimFont = new PIXI.TextStyle({
            fontFamily,
            fontSize,
            align: 'center',
            fill: this.statusBarData.colors.dimText,
        });
        // The ship-class subtitle is BRIGHT, not dim: "31d Model" under
        // "Leviathan" is the same white as the name in in_space.png (its ink
        // reads 765 on the probe's 0-765 scale, the dim grey reads 408).
        const subtitleFont = new PIXI.TextStyle({
            fontFamily,
            fontSize: subtitleSize,
            align: 'center',
            fill: this.statusBarData.colors.brightText,
        });
        this.brightFont = font;
        this.dimFont = dimFont;
        this.subtitleFont = subtitleFont;

        this.makeNavigationText(font, dimFont);

        const secondaryWeaponContainer = new PIXI.Container();
        this.container.addChild(secondaryWeaponContainer);
        secondaryWeaponContainer.position.x =
            this.statusBarData.dataAreas.weapons.position[0];
        secondaryWeaponContainer.position.y =
            this.statusBarData.dataAreas.weapons.position[1];

        this.text.noWeapon = new PIXI.Text("No Secondary Weapon", dimFont);
        this.text.noWeapon.anchor.x = 0.5;
        this.text.noWeapon.anchor.y = 0.5;
        this.text.noWeapon.position.x = this.statusBarData.dataAreas.weapons.size[0] / 2;
        this.text.noWeapon.position.y = this.statusBarData.dataAreas.weapons.size[1] / 2;;
        secondaryWeaponContainer.addChild(this.text.noWeapon);

        this.text.weapon = new PIXI.Text("", font);
        this.text.weapon.anchor.x = 0.5;
        this.text.weapon.anchor.y = 0.5;
        this.text.weapon.position.x = this.statusBarData.dataAreas.weapons.size[0] / 2;
        this.text.weapon.position.y = this.statusBarData.dataAreas.weapons.size[1] / 2;;
        secondaryWeaponContainer.addChild(this.text.weapon);

        this.targetContainer.visible = false;
        this.container.addChild(this.targetContainer);
        this.container.addChild(this.noTargetContainer);

        this.targetContainer.position.x = this.statusBarData.dataAreas.targeting.position[0];
        this.targetContainer.position.y = this.statusBarData.dataAreas.targeting.position[1];
        this.noTargetContainer.position.x = this.statusBarData.dataAreas.targeting.position[0];
        this.noTargetContainer.position.y = this.statusBarData.dataAreas.targeting.position[1];

        var size = [this.statusBarData.dataAreas.targeting.size[0],
        this.statusBarData.dataAreas.targeting.size[1]];

        this.text.shield = new PIXI.Text('Shield:', dimFont);
        this.text.shield.anchor.y = 1;
        this.text.shield.position.x = 6;
        this.text.shield.position.y = size[1] - 3;

        this.targetContainer.addChild(this.text.shield);

        this.text.armor = new PIXI.Text('Armor:', dimFont);
        this.text.armor.anchor.y = 1;
        this.text.armor.position.x = 6;
        this.text.armor.position.y = size[1] - 3;
        this.text.armor.visible = false;
        this.targetContainer.addChild(this.text.armor);


        this.text.percent = new PIXI.Text("100%", font);
        this.text.percent.anchor.y = 1;
        this.text.percent.position.x = 49;
        this.text.percent.position.y = size[1] - 3;

        this.targetContainer.addChild(this.text.percent);

        // Replaces the whole shield/armor readout while the target is
        // disabled (bright text, per the original game's target pane).
        this.text.disabled = new PIXI.Text('Disabled', font);
        this.text.disabled.anchor.y = 1;
        this.text.disabled.position.x = 6;
        this.text.disabled.position.y = size[1] - 3;
        this.text.disabled.visible = false;
        this.targetContainer.addChild(this.text.disabled);

        const middle = [this.statusBarData.dataAreas.targeting.size[0] / 2,
        this.statusBarData.dataAreas.targeting.size[1] / 2];

        this.text.noTarget = new PIXI.Text("No Target", dimFont);
        this.text.noTarget.anchor.x = 0.5;
        this.text.noTarget.anchor.y = 0.5;
        this.text.noTarget.position.x = middle[0];
        this.text.noTarget.position.y = middle[1] - NO_TARGET_CENTER_BELOW_MIDDLE;

        this.noTargetContainer.addChild(this.text.noTarget);

        this.text.targetName = new PIXI.Text("Name Placeholder", font);
        this.text.targetName.anchor.x = 0.5;
        this.text.targetName.anchor.y = 0;
        this.text.targetName.position.x = middle[0];
        this.text.targetName.position.y = TARGET_NAME_Y;

        this.targetContainer.addChild(this.text.targetName);

        // The ship class subtitle (shïp SubTitle), smaller and dim, sits just
        // beneath the target name — "Heavy Fighter Class" under "Pirate Viper".
        this.text.targetSubtitle = new PIXI.Text("", subtitleFont);
        this.text.targetSubtitle.anchor.x = 0.5;
        this.text.targetSubtitle.anchor.y = 0;
        this.text.targetSubtitle.position.x = middle[0];
        this.text.targetSubtitle.position.y = TARGET_SUBTITLE_Y;
        this.targetContainer.addChild(this.text.targetSubtitle);

        // The target's government, dim, in the lower-right of the pane
        // ("Sigma" / "Trader" / "Pirate" in the reference screenshots).
        this.text.targetGovt = new PIXI.Text("", dimFont);
        this.text.targetGovt.anchor.x = 1;
        this.text.targetGovt.anchor.y = 1;
        this.text.targetGovt.position.x = size[0] - 6;
        this.text.targetGovt.position.y = size[1] - 3;
        this.targetContainer.addChild(this.text.targetGovt);

        this.text.targetImagePlaceholder = new PIXI.Text("No target image", dimFont);
        this.text.targetImagePlaceholder.anchor.x = 0.5;
        this.text.targetImagePlaceholder.anchor.y = 0.5;

        this.makeCargoText(font, dimFont);
    }

    private makeNavigationText(font: PIXI.TextStyle, dimFont: PIXI.TextStyle) {
        const nav = this.statusBarData.dataAreas.navigation;
        const container = new PIXI.Container();
        this.container.addChild(container);
        container.position.set(nav.position[0], nav.position[1]);

        this.text.navHeader = new PIXI.Text("Stellar Navigation", dimFont);
        this.text.navHeader.anchor.x = 0.5;
        this.text.navHeader.anchor.y = 0;
        this.text.navHeader.position.x = nav.size[0] / 2;
        this.text.navHeader.position.y = NAV_HEADER_Y;
        container.addChild(this.text.navHeader);

        this.text.navValue = new PIXI.Text("No Destination", dimFont);
        this.text.navValue.anchor.x = 0.5;
        this.text.navValue.anchor.y = 0;
        this.text.navValue.position.x = nav.size[0] / 2;
        this.text.navValue.position.y = NAV_VALUE_Y;
        container.addChild(this.text.navValue);
    }

    /**
     * The cargo panel: a manifest in the left column and the
     * Free / Special / Credits readouts in the right one, all at FIXED
     * positions (see the CARGO_* constants). Every readout is a dim label
     * plus a bright value, so each is two text objects — the original's
     * "Free:390" is a grey "Free:" with a white "390" butted against it, and
     * a manifest line's quantity sits in its own column so the numbers line
     * up under one another however wide the commodity abbreviations are.
     */
    private makeCargoText(font: PIXI.TextStyle, dimFont: PIXI.TextStyle) {
        const cargo = this.statusBarData.dataAreas.cargo;
        const container = new PIXI.Container();
        this.container.addChild(container);
        container.position.set(cargo.position[0], cargo.position[1]);
        this.cargoContainer = container;

        // Regular-cargo manifest lines (left column), reused across frames.
        for (let i = 0; i < StatusBar.MAX_CARGO_LINES; i++) {
            const y = CARGO_LINE_Y + i * CARGO_LINE_PITCH;
            const name = new PIXI.Text("", dimFont);
            name.anchor.set(0, 0);
            name.position.set(CARGO_NAME_X, y);
            name.visible = false;
            container.addChild(name);
            this.cargoNameTexts.push(name);

            const quantity = new PIXI.Text("", font);
            quantity.anchor.set(0, 0);
            quantity.position.set(CARGO_QUANTITY_X, y);
            quantity.visible = false;
            container.addChild(quantity);
            this.cargoQuantityTexts.push(quantity);
        }

        this.text.freeLabel = new PIXI.Text("Free:", dimFont);
        this.text.freeLabel.anchor.set(0, 0);
        this.text.freeLabel.position.set(CARGO_LABEL_X, CARGO_FREE_Y);
        container.addChild(this.text.freeLabel);

        this.text.free = new PIXI.Text("0", font);
        this.text.free.anchor.set(0, 0);
        this.text.free.position.set(CARGO_FREE_VALUE_X, CARGO_FREE_Y);
        container.addChild(this.text.free);

        this.text.specialLabel = new PIXI.Text("Special:", dimFont);
        this.text.specialLabel.anchor.set(0, 0);
        this.text.specialLabel.position.set(
            CARGO_LABEL_X, CARGO_SPECIAL_LABEL_Y);
        this.text.specialLabel.visible = false;
        container.addChild(this.text.specialLabel);

        this.text.special = new PIXI.Text("", font);
        this.text.special.anchor.set(0, 0);
        this.text.special.position.set(
            CARGO_VALUE_X, CARGO_SPECIAL_VALUE_Y);
        this.text.special.visible = false;
        container.addChild(this.text.special);

        this.text.creditsLabel = new PIXI.Text("Credits:", dimFont);
        this.text.creditsLabel.anchor.set(0, 0);
        this.text.creditsLabel.position.set(
            CARGO_LABEL_X, CARGO_CREDITS_LABEL_Y);
        container.addChild(this.text.creditsLabel);

        this.text.credits = new PIXI.Text("0", font);
        this.text.credits.anchor.set(0, 0);
        this.text.credits.position.set(
            CARGO_VALUE_X, CARGO_CREDITS_VALUE_Y);
        container.addChild(this.text.credits);
    }

    /**
     * Half the radar's world span on each axis: a stellar within this of the
     * player shows as a blip. Used to decide when to draw the system-center
     * arrow (when nothing stellar is on the radar).
     */
    get radarRange(): Vector {
        return this.radarScale.scale(0.5);
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
        this.radar.clear();

        // Interference (0-100) makes sensors unreliable: on each radar tick,
        // with probability interference / 100, the whole radar is replaced by
        // one of the ppat static patterns, tiled — the original engine's
        // behavior. At 100 the radar is pure static (a complete sensor
        // blackout); otherwise this tick draws normally.
        if (this.drawSensorStatic()) {
            return;
        }

        this.drawDot(source, this.statusBarData.colors.brightRadar, source);

        for (const [uuid, { position }] of ships) {
            const color = shipColors?.get(uuid)
                ?? this.statusBarData.colors.dimRadar;
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
        const radarSize = new Vector(...this.statusBarData.dataAreas.radar.size);
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
        this.radar.beginFill(0xFFFFFF);
        this.radar.moveTo(tipX, tipY);
        this.radar.lineTo(baseX + px * halfWidth, baseY + py * halfWidth);
        this.radar.lineTo(baseX - px * halfWidth, baseY - py * halfWidth);
        this.radar.lineTo(tipX, tipY);
        this.radar.endFill();
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
        const radarSize = new Vector(...this.statusBarData.dataAreas.radar.size);
        const delta = new Vector(wrapNearestDelta(dotPos.x - source.x),
            wrapNearestDelta(dotPos.y - source.y));
        const pixiPos = delta
            .times(radarSize).div(this.radarScale).add(radarSize.scale(0.5));

        if (pixiPos.x <= radarSize.x && pixiPos.x >= 0 &&
            pixiPos.y <= radarSize.y && pixiPos.y >= 0) {
            // TODO: Make this work with any sizes
            this.radar.moveTo(pixiPos.x, pixiPos.y);
            this.radar.beginFill(color);
            this.radar.lineTo(pixiPos.x + size, pixiPos.y);
            this.radar.lineTo(pixiPos.x + size, pixiPos.y + size);
            this.radar.lineTo(pixiPos.x, pixiPos.y + size);
            this.radar.endFill()
        }
    }

    private drawLine(dataArea: StatusBarDataArea, color: number, fullness: number) {
        var pos = [dataArea.position[0], dataArea.position[1]];
        var size = [dataArea.size[0], dataArea.size[1]];
        pos[1] += size[1] / 2;

        this.statsGraphics.lineStyle(size[1], color);
        this.statsGraphics.moveTo(pos[0], pos[1]);
        this.statsGraphics.lineTo(pos[0] + size[0] * fullness, pos[1]);
    }

    drawStats(shield: Stat, armor: Stat,
        fuel?: { current: number, max: number }) {
        this.statsGraphics.clear();

        this.drawLine(this.statusBarData.dataAreas.shield,
            this.statusBarData.colors.shield, statFullness(shield));

        this.drawLine(this.statusBarData.dataAreas.armor,
            this.statusBarData.colors.armor, statFullness(armor));

        if (fuel && fuel.max > 0) {
            // Partial-jump fuel in the dim color, with the whole jumps'
            // worth (100 units each) drawn over it in the full color.
            const fuelFullness = statFullness(fuel);
            this.drawLine(this.statusBarData.dataAreas.fuel,
                this.statusBarData.colors.fuelPartial, fuelFullness);
            const fullJumps = Math.max(0, Math.floor(
                fuel.current / FUEL_PER_JUMP) * FUEL_PER_JUMP / fuel.max);
            this.drawLine(this.statusBarData.dataAreas.fuel,
                this.statusBarData.colors.fuelFull, fullJumps);
        }
    }

    private lastSecondary: string | null | undefined;
    drawSecondary(name: string | null | undefined) {
        if (!this.built || name === this.lastSecondary) {
            return;
        }
        this.lastSecondary = name;
        if (name) {
            this.text.weapon.text = name;
            this.text.weapon.visible = true;
            this.text.noWeapon.visible = false;
        } else {
            this.text.weapon.visible = false;
            this.text.noWeapon.visible = true;
        }
    }

    drawTarget(name: string, shield?: number, armor?: number,
        shipGraphic?: AnimationGraphic, disabled = false,
        subtitle = "", government = "") {
        // Mid-reload (an ïntf swap) the texts are destroyed and `text`
        // is empty until build() has awaited the new PICT. The other
        // draw methods already wait it out; this one dereferenced
        // text.targetName and threw, and the ECS flush has no per-system
        // try/catch, so every draw system after it was skipped for the
        // frame. DrawStatusBarTarget calls this every frame, so the
        // first built frame redraws the target.
        if (!this.built) {
            return;
        }
        this.targetContainer.visible = true;
        this.noTargetContainer.visible = false;
        this.text.targetName.text = name;
        this.text.targetSubtitle.text = subtitle;
        this.text.targetSubtitle.visible = subtitle.length > 0;
        this.text.targetGovt.text = government;
        this.text.targetGovt.visible = government.length > 0;

        const readout = targetReadout(disabled, shield, armor);
        this.text.disabled.visible = readout.kind === 'disabled';
        this.text.shield.visible = readout.kind === 'shield';
        this.text.armor.visible = readout.kind === 'armor';
        this.text.percent.visible = readout.kind === 'shield'
            || readout.kind === 'armor';
        if (readout.kind === 'shield' || readout.kind === 'armor') {
            this.text.percent.text = `${String(readout.percent)}%`;
        }

        if (shipGraphic) {
            const shipContainer = shipGraphic?.container;
            const width = shipGraphic.size.x;
            const height = shipGraphic.size.y;

            // Reuse the cached RenderTexture across frames; only reallocate
            // (destroying the old one and its base texture) when the target's
            // size changes. Without this a fresh texture would leak every
            // display frame while a target is locked.
            let renderTexture = this.targetRenderTexture;
            if (!renderTexture ||
                renderTexture.width !== width ||
                renderTexture.height !== height) {
                renderTexture?.destroy(true);
                const baseRenderTexture = new PIXI.BaseRenderTexture({
                    width, height,
                });
                renderTexture = new PIXI.RenderTexture(baseRenderTexture);
                this.targetRenderTexture = renderTexture;
            }

            shipContainer.setTransform();
            shipContainer.position.x = shipGraphic.size.x / 2;
            shipContainer.position.y = shipGraphic.size.y / 2;
            this.renderer.render(shipContainer, { renderTexture });
            this.targetSprite.texture = renderTexture;
            let scale = 1;
            const maxSize = 110;
            const targetMaxDim = Math.max(shipGraphic.size.x, shipGraphic.size.y);
            if (targetMaxDim > maxSize) {
                scale = maxSize / targetMaxDim;
            }
            this.targetSprite.scale.set(scale, scale);
            this.targetSprite.visible = true;
        } else {
            this.targetSprite.visible = false;
        }

    }
    clearTarget() {
        if (!this.built) {
            return;
        }
        this.targetContainer.visible = false;
        this.noTargetContainer.visible = true;
        this.targetSprite.visible = false;
    }

    private lastNav?: string;
    drawNavigation(readout: NavReadout) {
        if (!this.built) {
            return;
        }
        // `dim` belongs in the memo key, not just the text: becoming
        // able to jump changes ONLY the colour of an unchanged
        // destination name, so a header+value key would memoize the
        // restyle away and the readout would never brighten.
        // (The separator was a stray NUL byte, which made this whole
        // source file read as binary to grep and friends.)
        const key = `${readout.header}|${readout.value}|${readout.dim}`;
        if (key === this.lastNav) {
            return;
        }
        this.lastNav = key;
        this.text.navHeader.text = readout.header;
        this.text.navValue.text = readout.value;
        this.text.navValue.style = readout.dim ? this.dimFont : this.brightFont;
    }

    private lastCargo?: string;
    /**
     * Draws the cargo/credits panel. Everything sits at a fixed spot (the
     * CARGO_* constants): the manifest fills the left column top-down, and
     * the right column always reads Free / [Special] / Credits at the same
     * rows whether or not the hold is empty and whether or not the player
     * carries mission cargo — which is what the original does (in_space.png's
     * empty hold puts "Free:390" and "Credits:" on exactly the rows
     * board_ship.png's loaded hold does).
     */
    drawCargo(free: number, credits: number, lines: CargoLine[],
        special: string | null) {
        if (!this.built) {
            return;
        }
        const creditsText = formatCredits(credits);
        const key = JSON.stringify([free, creditsText, lines, special]);
        if (key === this.lastCargo) {
            return;
        }
        this.lastCargo = key;

        // Regular cargo manifest, left column.
        const shown = Math.min(lines.length, StatusBar.MAX_CARGO_LINES);
        for (let i = 0; i < this.cargoNameTexts.length; i++) {
            const name = this.cargoNameTexts[i];
            const quantity = this.cargoQuantityTexts[i];
            if (i < shown) {
                name.text = `${lines[i].name}:`;
                quantity.text = String(lines[i].quantity);
            }
            name.visible = i < shown;
            quantity.visible = i < shown;
        }

        this.text.free.text = String(free);
        this.text.credits.text = creditsText;
        const hasSpecial = special !== null;
        this.text.specialLabel.visible = hasSpecial;
        this.text.special.visible = hasSpecial;
        if (hasSpecial) {
            this.text.special.text = special;
        }
    }

    /** Set while an interface swap is in flight (SelectStatusBarInterface). */
    reloading = false;

    /** The ïntf resource this bar is currently drawn from. */
    get statusBarId(): string {
        return this.statusBarData.id;
    }

    /**
     * Rebuilds the whole bar from a different ïntf resource — the background
     * PICT, the data-area rectangles, the colours and the fonts all come from
     * it, so switching status bars means re-running build(). Used when the
     * player changes ship class into one whose government names another
     * interface (SelectStatusBarInterface).
     */
    async reload(statusBarData: StatusBarData) {
        this.statusBarData = statusBarData;
        this.built = false;
        const outgoing = this.container.removeChildren();
        // The panes are class-owned containers that build() re-parents; their
        // children are per-build text objects, so they start empty again.
        this.targetContainer.removeChildren();
        this.noTargetContainer.removeChildren();
        // Each PIXI.Text owns a generated canvas texture, so the outgoing set
        // is destroyed rather than merely detached.
        for (const text of [...Object.values(this.text),
            ...this.cargoNameTexts, ...this.cargoQuantityTexts]) {
            text.destroy();
        }
        // Everything else build() made for the old ïntf goes too — the
        // background sprite, the radar's static TilingSprite, the readout
        // panes' containers — or every interface swap would orphan them
        // (review #40). Only what build() RE-ADDS is kept: the class-owned
        // graphics and panes and the debug buttons. Textures are not
        // destroyed here: the background's and the static's are shared with
        // the asset cache (Sprite.destroy leaves them alone by default).
        const kept = new Set<PIXI.DisplayObject>([
            this.radar, this.statsGraphics, this.targetContainer,
            this.noTargetContainer, this.addEnemyButton.container,
            this.giveCreditsButton.container, this.clearRecordButton.container,
        ]);
        for (const child of outgoing) {
            if (!kept.has(child) && !child.destroyed) {
                child.destroy({ children: true });
            }
        }
        this.staticSprite = undefined;
        this.text = {};
        this.cargoNameTexts = [];
        this.cargoQuantityTexts = [];
        this.lastNav = undefined;
        this.lastCargo = undefined;
        this.lastSecondary = undefined;
        this.buildPromise = this.build();
        await this.buildPromise;
    }

    /**
     * Releases everything the bar owns: the cached target RenderTexture
     * (and its base texture) and the whole display tree — some forty
     * PIXI.Text canvases, the graphics, the sprites. Shared textures (the
     * background PICT, the ppat statics) are left to the asset cache;
     * Text destroys its own canvas texture regardless (review #40).
     */
    destroy() {
        this.container.destroy({ children: true });
        // A Text the bar owns but never parented (targetImagePlaceholder)
        // is out of the container's reach and has to be destroyed by name.
        for (const text of [...Object.values(this.text),
            ...this.cargoNameTexts, ...this.cargoQuantityTexts]) {
            if (!text.destroyed) {
                text.destroy();
            }
        }
        this.text = {};
        this.cargoNameTexts = [];
        this.cargoQuantityTexts = [];
        this.targetRenderTexture?.destroy(true);
        this.targetRenderTexture = undefined;
    }
}

export const AddEnemyEvent = new EcsEvent<{ shipId: string }>('AddEnemyEvent');
/**
 * A debug-button cheat (status_bar.ts), forwarded by browser.ts to the
 * sim as a synthetic control-event input on the player's ship so it
 * rides input records and replays deterministically (DebugCheatSystem).
 */
export const DebugActionEvent =
    new EcsEvent<{ action: ControlAction }>('DebugActionEvent');

export const StatusBarPlugin: Plugin = {
    name: 'StatusBar',
    async build(world) {
        const simulationData = world.resources.get(SimulationGameDataResource);
        if (!simulationData) {
            throw new Error('Expected simulation game data resource to exist');
        }
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        if (!displayAssets) {
            throw new Error('Expected display asset data resource to exist');
        }

        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected Stage resource to exist');
        }

        const app = world.resources.get(PixiAppResource);
        if (!app) {
            throw new Error('Expected PIXI App resource to exist');
        }

        const statusBar = new StatusBar(
            await displayAssets.data.StatusBar.get(DEFAULT_STATUS_BAR_ID),
            displayAssets, app.renderer);

        // Seed the radar's sensor interference from the current system. This is
        // static per-system data (from the sÿst resource), read display-side so
        // it never affects the deterministic simulation. Outfits can later clear
        // it up via statusBar.interferenceReduction.
        const systemId = world.resources.get(SystemIdResource);
        if (systemId) {
            const systemData = await simulationData.data.System.get(systemId);
            statusBar.systemInterference = systemData.interference;
            if (systemData.interference > 0) {
                // The ppat pixel patterns the radar shows as sensor static.
                // Only needed in systems that actually have interference.
                const ppatIds = (await simulationData.ids).PpatImage;
                statusBar.staticTextures = await Promise.all(ppatIds.map(
                    id => displayAssets.textureFromPpat(id)));
            }
        }

        await statusBar.buildPromise;
        stage.addChild(statusBar.container);
        // Anchored to the UI-logical right edge (ScreenSize), not the
        // window's CSS width: with a global or UI scale in play those are
        // different numbers and the bar would hang off the screen.
        const screenSize = world.resources.get(ScreenSize);
        statusBar.container.position.x = (screenSize?.x ?? window.innerWidth)
            - statusBar.container.width;
        statusBar.container.position.y = 0;
        statusBar.addEnemy.subscribe(async () => {
            const randomIndex = Math.floor(Math.random() * (await simulationData.ids).Ship.length);
            const randomShipId = (await simulationData.ids).Ship[randomIndex];
            world.emit(AddEnemyEvent, { shipId: randomShipId });
        });
        // Debug cheats: each becomes a synthetic control edge that
        // browser.ts forwards into the sim (DebugCheatSystem), so the
        // effect rides input records like any other control input.
        statusBar.giveCredits.subscribe(() => {
            world.emit(DebugActionEvent, { action: 'debugGiveCredits' });
        });
        statusBar.clearRecord.subscribe(() => {
            world.emit(DebugActionEvent, { action: 'debugClearRecord' });
        });

        world.resources.set(StatusBarResource, statusBar);
        // The navigation readout's unexplored-destination gate, over the
        // same per-pilot record the star map and gate map read.
        world.resources.set(DiscoveryLevelResource, id => discoveryLevel(id));
        // The docked-ship holder is created here if the spaceport plugin
        // hasn't already; both plugins set-if-absent so build order is moot.
        if (!world.resources.get(DockedShipResource)) {
            world.resources.set(DockedShipResource, {});
        }

        // DrawRadar judges bribe expiries against the mirrored sim clock;
        // seed it so the radar can draw before the first frame arrives.
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.addSystem(DrawRadar);
        world.addSystem(SelectStatusBarInterface);
        world.addSystem(StatusBarResize);
        world.addSystem(DrawStatusBarStats);
        world.addSystem(DrawStatusBarSecondaryWeapon);
        world.addSystem(DrawStatusBarTarget);
        world.addSystem(DrawStatusBarInterference);
        world.addSystem(DrawStatusBarNavigation);
        world.addSystem(DrawStatusBarCargo);
        world.addSystem(DrawDockedStatus);
    },
    remove(world) {
        world.removeSystem(DrawRadar);
        world.removeSystem(SelectStatusBarInterface);
        world.removeSystem(StatusBarResize);
        world.removeSystem(DrawStatusBarStats);
        world.removeSystem(DrawStatusBarSecondaryWeapon);
        world.removeSystem(DrawStatusBarTarget);
        world.removeSystem(DrawStatusBarInterference);
        world.removeSystem(DrawStatusBarNavigation);
        world.removeSystem(DrawStatusBarCargo);
        world.removeSystem(DrawDockedStatus);

        const stage = world.resources.get(Stage);
        const statusBar = world.resources.get(StatusBarResource);
        if (statusBar) {
            if (stage) {
                stage.removeChild(statusBar.container);
            }
            statusBar.destroy();
        }
        world.resources.delete(StatusBarResource);
    }
}
