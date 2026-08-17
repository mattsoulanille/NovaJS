import { PlanetData } from "novadatainterface/planet_data";
import { StatusBarData, StatusBarDataArea } from "novadatainterface/status_bar_data";
import { GetEntity, RunQuery, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Position, wrapNearestDelta } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { EcsEvent } from "nova_ecs/events";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementState, MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { Subject } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { DisplayAssetDataResource, SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { CloakActiveComponent, CloakComponent, deriveCloakScanner } from "../nova_plugin/cloak_plugin.js";
import { GovtComponent } from "../nova_plugin/govt_component.js";
import { deriveIff, planetBlipColor, planetDisposition, PLANET_FLAT_COLOR, shipBlipColor, shipDisposition } from "../nova_plugin/iff_plugin.js";
import { LegalRecordsComponent } from "../nova_plugin/reputation_plugin.js";
import { ArmorComponent, FuelComponent, FUEL_PER_JUMP, ShieldComponent } from "../nova_plugin/health_plugin.js";
import { OutfitsStateComponent, sumOutfitField } from "../nova_plugin/outfit_plugin.js";
import { PersComponent } from "../nova_plugin/pers_plugin.js";
import { MissionShipComponent } from "../nova_plugin/mission_ship_plugin.js";
import { targetIdentity } from "./target_identity.js";
import { DisabledComponent } from "../nova_plugin/disabled_component.js";
import { ActiveRanksComponent } from "../nova_plugin/ncb_plugin.js";
import { PlanetComponent, PlanetDataComponent, PlanetTargetComponent, stellarClearanceFor, StellarBribesComponent } from "../nova_plugin/planet_plugin.js";
import { landable } from "../nova_plugin/landable.js";
import { JumpComponent, JumpRouteComponent, JUMP_DISTANCE } from "../nova_plugin/jump_plugin.js";
import { canJump, jumpRadiusFor } from "../nova_plugin/jump_readiness.js";
import { CargoComponent } from "../nova_plugin/cargo_plugin.js";
import { CreditsComponent, MissionsComponent } from "../nova_plugin/player_state_plugin.js";
import { OutfitsState } from "../nova_plugin/outfit_plugin.js";
import { DockedShipResource } from "./docked_ship.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { SingletonComponent } from "nova_ecs/world";
import { ControlAction } from "../nova_plugin/controls.js";
import { displayName, govtTargetName } from "../nova_plugin/display_name.js";
import { STANDARD_CARGO_NAMES } from "../nova_plugin/mission_logic.js";
import { ShipComponent, ShipPhysicsComponent } from "../nova_plugin/ship_plugin.js";
import {
    formatCredits, navReadout, NavReadout, CargoLine, abbreviateCargoName,
    specialCargoSummary, standardCargoIndex, targetGovtLabel,
} from "./status_bar_content.js";
import { PlayerEscortComponent } from "../nova_plugin/player_escort.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { ShipDataComponent } from "../nova_plugin/ship_plugin.js";
import { SystemIdResource } from "../nova_plugin/system_id_resource.js";
import { Stat } from "../nova_plugin/stat.js";
import { TargetComponent } from "../nova_plugin/target_component.js";
import { ActiveSecondaryWeapon, countAmmo } from "../nova_plugin/weapon_plugin.js";
import { Button, ButtonClick } from "../spaceport/button.js";
import { AnimationGraphic } from "./animation_graphic.js";
import { targetReadout } from "./target_readout.js";
import { AnimationGraphicComponent } from "./animation_graphic_plugin.js";
import { PixiAppResource } from "./pixi_app_resource.js";
import { ResizeEvent, ScreenSize } from "./screen_size_plugin.js";
import { Stage } from "./stage_resource.js";


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
 * Left edge (StatusBar-container x) of the debug-button stack (Add Enemy /
 * Give 1M Credits / Clear Legal Record). Pulled left of its old x=65 by about
 * half an Add Enemy button width so the widest button (Clear Legal Record)
 * stays inside the 194px status-bar background: at x=65 it overflowed the
 * right edge, inflating the container's bounds so StatusBarResize shoved the
 * whole bar left of its intended x=1726 at 1920x1080.
 */
const DEBUG_BUTTON_X = 35;

// ---------------------------------------------------------------------------
// PANEL TEXT GEOMETRY, measured off the original-hardware captures.
//
// Every constant below is an OFFSET INSIDE the ïntf data area it belongs to
// (the areas themselves come from the resource), read off
// ui_screenshots/original_macos_screenshots/space/*.png at 1920x1080 with
// visual_compare/output/probe_band.mjs. The reference status bar occupies
// x 1726..1919, so a status-bar-local x is (image x - 1726); the y values are
// image rows, which the bar shares because it is pinned to the top.
//
// Ink vs. box: a probe reports where the GLYPHS start, while PIXI positions a
// text BOX whose top sits ~2px above the cap line at 12px Geneva and whose
// left edge sits ~1px left of the first glyph. The constants are therefore
// (measured ink) - (that bearing), and the harness re-measures our render to
// confirm.
// ---------------------------------------------------------------------------

/** Ink starts ~2px below a PIXI text box's top at the status bar's 12px. */
const TEXT_INK_TOP = 2;
/** ...and ~1px right of its left edge. */
const TEXT_INK_LEFT = 1;

/**
 * Navigation pane: "Stellar Navigation" ink at y=257, its value at y=274.
 * Both centred lines render a pixel lower than the left-aligned panels at the
 * same nominal offset, so they carry one extra pixel of bearing.
 */
const NAV_HEADER_Y = 257 - 254 - TEXT_INK_TOP - 1;
const NAV_VALUE_Y = 274 - 254 - TEXT_INK_TOP - 1;

/**
 * Target pane, no target: "No Target" ink centred on y=373.5 (in_space_3),
 * i.e. 13px below the pane's own centre rather than the 30px above it the
 * panel used to use.
 */
const NO_TARGET_CENTER_BELOW_MIDDLE = 14;
/** Target pane: the name's ink at y=337 and the class subtitle's at y=351. */
const TARGET_NAME_Y = 337 - 330 - TEXT_INK_TOP;
const TARGET_SUBTITLE_Y = 351 - 330 - TEXT_INK_TOP;

/**
 * The target display draws the locked ship's sprite in RED ONLY: every pixel
 * in the reference target pane is #RR0000 (probe_colors on in_space.png,
 * board_ship.png and capture_assignment.png finds no green or blue at all),
 * which a PIXI tint of 0xFF0000 reproduces exactly — it multiplies the
 * sprite's channels by (1, 0, 0), keeping the red channel and zeroing the
 * other two.
 */
const TARGET_SPRITE_TINT = 0xFF0000;

// Cargo pane. The original's layout is FIXED, not centred-when-empty: the
// right column sits at the same x whether or not the hold has anything in it
// (compare in_space.png's empty hold with board_ship.png's five lines), and
// each readout is a DIM label plus a BRIGHT value, with no space after the
// label's colon ("Free:390").
/** Manifest lines (left column): name ink x=12, quantity ink x=50. */
const CARGO_NAME_X = 12 - 8 - TEXT_INK_LEFT;
const CARGO_QUANTITY_X = 50 - 8 - TEXT_INK_LEFT;
/** ...stacked from ink y=461 at a 14px pitch (board_ship.png). */
const CARGO_LINE_Y = 461 - 458 - TEXT_INK_TOP;
const CARGO_LINE_PITCH = 14;
/** Right column: labels' ink at x=86, the Special/Credits values' at x=96. */
const CARGO_LABEL_X = 86 - 8 - TEXT_INK_LEFT;
const CARGO_VALUE_X = 96 - 8 - TEXT_INK_LEFT;
/** The free-space count follows its label on the same line, ink at x=119. */
const CARGO_FREE_VALUE_X = 119 - 8 - TEXT_INK_LEFT;
/**
 * The right column's five slots are fixed too: whether or not a "Special:"
 * mission-cargo line is present, "Credits:" stays put (in_space.png and
 * in_space_3.png put it on the same rows).
 */
const CARGO_FREE_Y = 461 - 458 - TEXT_INK_TOP;
const CARGO_SPECIAL_LABEL_Y = 479 - 458 - TEXT_INK_TOP;
const CARGO_SPECIAL_VALUE_Y = 495 - 458 - TEXT_INK_TOP;
const CARGO_CREDITS_LABEL_Y = 515 - 458 - TEXT_INK_TOP;
const CARGO_CREDITS_VALUE_Y = 531 - 458 - TEXT_INK_TOP;

class StatusBar {
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

        const shieldFullness = Math.max(0, shield.current / shield.max);
        this.drawLine(this.statusBarData.dataAreas.shield,
            this.statusBarData.colors.shield, shieldFullness);

        const armorFullness = Math.max(0, armor.current / armor.max);
        this.drawLine(this.statusBarData.dataAreas.armor,
            this.statusBarData.colors.armor, armorFullness);

        if (fuel && fuel.max > 0) {
            // Partial-jump fuel in the dim color, with the whole jumps'
            // worth (100 units each) drawn over it in the full color.
            const fuelFullness = Math.max(0, fuel.current / fuel.max);
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
        this.container.removeChildren();
        // The panes are class-owned containers that build() re-parents; their
        // children are per-build text objects, so they start empty again.
        this.targetContainer.removeChildren();
        this.noTargetContainer.removeChildren();
        // Each PIXI.Text owns a generated canvas texture, so the outgoing set
        // is destroyed rather than merely detached. Only the texts are
        // destroyed: the background sprite shares its texture with the asset
        // cache, and the debug buttons are re-added by build().
        for (const text of [...Object.values(this.text),
            ...this.cargoNameTexts, ...this.cargoQuantityTexts]) {
            text.destroy();
        }
        this.text = {};
        this.cargoNameTexts = [];
        this.cargoQuantityTexts = [];
        this.lastNav = undefined;
        this.lastCargo = undefined;
        this.lastSecondary = undefined;
        this.buildPromise = this.build();
        await this.buildPromise;
    }

    /** Releases the cached target RenderTexture (and its base texture). */
    destroy() {
        this.targetRenderTexture?.destroy(true);
        this.targetRenderTexture = undefined;
    }
}

export const StatusBarResource = new Resource<StatusBar>('StatusBar');
export const AddEnemyEvent = new EcsEvent<{ shipId: string }>('AddEnemyEvent');
/**
 * A debug-button cheat (status_bar.ts), forwarded by browser.ts to the
 * sim as a synthetic control-event input on the player's ship so it
 * rides input records and replays deterministically (DebugCheatSystem).
 */
export const DebugActionEvent =
    new EcsEvent<{ action: ControlAction }>('DebugActionEvent');

const StatusBarResize = new System({
    name: 'StatusBarResize',
    events: [ResizeEvent],
    args: [StatusBarResource, ResizeEvent] as const,
    step({ container }, { x }) {
        // Flush with the right edge. The old `+ 1` pushed the whole bar one
        // pixel right of the original's (which occupies x 1726..1919 at
        // 1920x1080) and cropped its rightmost column off the screen.
        container.position.x = x - container.width;
        container.position.y = 0;
    }
});

const RadarTime = new Component<{ lastTime: number }>('RadarTime');

const DrawRadar = new System({
    name: 'DrawRadar',
    args: [Optional(RadarTime), TimeResource, SimulationTimeResource,
        StatusBarResource, MovementStateComponent,
    new Query([UUID, MovementStateComponent, ShipDataComponent,
        Optional(CloakActiveComponent), Optional(CloakComponent),
        Optional(GovtComponent), Optional(DisabledComponent)] as const),
    new Query([UUID, MovementStateComponent, PlanetDataComponent,
        PlanetComponent] as const),
        SimulationGameDataResource, GetEntity, PlayerShipSelector] as const,
    step(radarTime, { time }, simTime, statusBar, { position }, ships, planets,
        gameData, entity) {
        if (!radarTime) {
            radarTime = { lastTime: 0 };
            entity.components.set(RadarTime, radarTime);
        }
        if (time - radarTime.lastTime > statusBar.radarPeriod) {
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
                    !(cloakActive?.active && (cloak?.hidesFromRadar ?? true)));

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
            for (const [uuid, , , , , shipGovt, disabled] of visibleShips) {
                const govt = (hasIff && shipGovt)
                    ? gameData.data.Govt.getCached(shipGovt.id) : undefined;
                const color = shipBlipColor(
                    hasIff
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
            const range = statusBar.radarRange;
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
            statusBar.drawRadar(position, visibleShips, planets, shipColors,
                centerArrow,
                targetUuid && targetFlashOn(time) ? targetUuid : null,
                planetColors);
            radarTime.lastTime = time;
        }
    }
});

const DrawStatusBarStats = new System({
    name: 'DrawStatusBarStats',
    args: [StatusBarResource, ShieldComponent, ArmorComponent,
        Optional(FuelComponent), PlayerShipSelector] as const,
    step(statusBar, shield, armor, fuel) {
        statusBar.drawStats(shield, armor, fuel);
    }
})

// Runs every step (not just on ChangeSecondaryEvent) so the ammo count
// updates as the weapon fires. drawSecondary ignores unchanged text.
const DrawStatusBarSecondaryWeapon = new System({
    name: 'DrawStatusBarSecondaryWeapon',
    args: [StatusBarResource, ActiveSecondaryWeapon,
        Optional(OutfitsStateComponent), SimulationGameDataResource,
        PlayerShipSelector] as const,
    step(statusBar, activeSecondary, outfits, gameData) {
        if (!activeSecondary.secondary) {
            statusBar.drawSecondary(null);
            return;
        }
        const weapon = gameData.data.Weapon.getCached(activeSecondary.secondary);
        if (!weapon) {
            // Not cached yet; getCached kicked off the load.
            return;
        }
        const { ammoType } = weapon;
        // Strip the "; note" author suffix ("Wraith Cannon;fire whilst
        // cloaked" -> "Wraith Cannon") the original never shows.
        const weaponName = displayName(weapon.name);
        if (outfits && ammoType instanceof Array && ammoType[0] === 'weapon') {
            // "Weapon Name - 37"; weapons without ammo show the bare name.
            statusBar.drawSecondary(
                `${weaponName} - ${countAmmo(ammoType[1], outfits, gameData)}`);
        } else {
            statusBar.drawSecondary(weaponName);
        }
    }
});

const TargetQuery = new Query([ShipDataComponent, Optional(ShieldComponent),
    Optional(ArmorComponent), Optional(AnimationGraphicComponent),
    Optional(PersComponent), Optional(DisabledComponent),
    Optional(GovtComponent), Optional(PlayerEscortComponent),
    Optional(MissionShipComponent)] as const);
const DrawStatusBarTarget = new System({
    name: 'DrawStatusBarTarget',
    args: [StatusBarResource, TargetComponent, RunQuery,
        SimulationGameDataResource, UUID, PlayerShipSelector] as const,
    step(statusBar, { target }, runQuery, gameData, playerUuid) {
        if (!target) {
            statusBar.clearTarget();
            return;
        }
        const result = runQuery(TargetQuery, target)[0];
        if (result) {
            const [shipData, shield, armor, shipGraphic, pers, disabled, govt,
                playerEscort, missionShip] = result;
            // The government shown lower-right of the target pane. The original
            // shows the gövt's short Target Code (gövt TMPL offset 68) — "Pyro"
            // for "Pyrogenesis Skymining", " Fed." for "Federation" — rather
            // than the overflow-prone full name. displayName trims the code's
            // leading padding and strips any "; note" author suffix; a govt
            // with no target code falls back to its (also cleaned) full name.
            // Cached lookup: undefined until the govt data loads, then appears.
            const govtData = govt
                ? gameData.data.Govt.getCached(govt.id) : undefined;
            // ...except for the local player's OWN escorts, which read
            // "Escort" instead of their government. Per-player and
            // display-only: `playerUuid` is this client's ship, so a peer
            // targeting the same ship still sees its real government
            // (targetGovtLabel).
            const government = targetGovtLabel(
                govtData ? govtTargetName(govtData) : "",
                playerEscort?.player, playerUuid);
            // Përs name/subtitle, then a mission special ship's, then the
            // ship class's own — see target_identity.ts for the Bible
            // citations behind that order.
            const identity = targetIdentity({
                persName: pers?.name,
                persSubtitle: pers?.subtitle,
                missionName: missionShip?.name,
                missionSubtitle: missionShip?.subtitle,
                shipClass: shipData.name,
                shipSubtitle: shipData.subtitle,
            });
            // Hide the "; developer note" suffix authors append to ship
            // (and përs) names — the original never shows it in the target box.
            statusBar.drawTarget(displayName(identity.name),
                shield?.percent, armor?.percent, shipGraphic,
                disabled !== undefined, identity.subtitle, government);
        } else {
            // The target exists but the query missed — e.g. a just-replicated
            // ship whose ShipDataComponent isn't in the display world yet. Clear
            // the panel so it doesn't keep showing the previous target's data.
            statusBar.clearTarget();
        }
    }
})

/**
 * Feeds the interference-mod outfits (oütf ModType 24) into the radar: sums
 * the player ship's owned outfits' interferenceReduction and writes it to the
 * status bar. The Bible: "Subtracts the value in ModVal from the current star
 * system's Interference value when calculating how fuzzy to make the radar."
 * Display-only (interference never affects the simulation), so this reads the
 * player's outfits directly. A stock Sensor Boost (nova:203) clears 20
 * interference; several stack. Runs every step so buying/selling updates it.
 */
const DrawStatusBarInterference = new System({
    name: 'DrawStatusBarInterference',
    args: [StatusBarResource, OutfitsStateComponent,
        SimulationGameDataResource, PlayerShipSelector] as const,
    step(statusBar, outfits, gameData) {
        const reduction = sumOutfitField(
            outfits, gameData, o => o.interferenceReduction);
        if (reduction !== undefined) {
            statusBar.interferenceReduction = reduction;
        }
    },
});

const PlanetNavQuery = new Query([PlanetDataComponent] as const);
/** Exported for status_bar_navigation_test (the dim / in-flight rules). */
export const DrawStatusBarNavigation = new System({
    name: 'DrawStatusBarNavigation',
    args: [StatusBarResource, Optional(JumpRouteComponent),
        Optional(PlanetTargetComponent), Optional(JumpComponent),
        Optional(MovementStateComponent), Optional(ShipPhysicsComponent),
        Optional(FuelComponent), Optional(DisabledComponent), RunQuery,
        SimulationGameDataResource, PlayerShipSelector] as const,
    step(statusBar, jumpRoute, planetTarget, jump, movement, shipPhysics,
        fuel, disabled, runQuery, gameData) {
        // WHERE THE SHIP IS ACTUALLY HEADED. A jump in progress shows ITS
        // destination, not the route's new head: beginJump (jump_plugin)
        // shifts the hop off the route the instant the sequence starts, so
        // reading route[0] mid-jump names the hop AFTER this one and the
        // readout jumps ahead of the ship. The simulation's ordering is
        // deliberate (multi-jump and rollback depend on it), so this is
        // fixed where it is a display question: prefer the in-flight jump's
        // own `to` and fall back to the route head.
        //
        // A vanishing jump's `to` is the empty-string sentinel
        // (VANISH_DESTINATION) and is falsy, so `??`-style truthiness keeps
        // the fallback correct — though a player ship never vanishes.
        const nextSystem = (jump?.to || undefined) ?? jumpRoute?.route[0];
        // getCached is undefined until the system data loads, then the name
        // appears.
        let destinationName: string | null = null;
        if (nextSystem) {
            destinationName =
                gameData.data.System.getCached(nextSystem)?.name ?? null;
        }

        // Otherwise the selected stellar's name, read off the planet entity.
        let stellarName: string | null = null;
        if (planetTarget?.target) {
            const planet = runQuery(PlanetNavQuery, planetTarget.target)[0];
            stellarName = planet ? planet[0].name : null;
        }

        // DIM UNTIL JUMP-READY, off the shared readiness predicate
        // (nova_plugin/jump_readiness.ts) that PlayerJumpControl gates on
        // and the nova:154 cue fires from — the destination brightens
        // exactly when pressing the jump key would work.
        //
        // A jump ALREADY UNDERWAY reads bright: `canJump` says no (the
        // 'jumping' blocker), but the ship is on its way to that very
        // destination, and dimming it for the length of the sequence would
        // be a lie in the other direction.
        //
        // Missing inputs (the components are Optional so this system keeps
        // drawing the panel in every state) fall back to `true`, i.e. the
        // pre-existing always-bright behavior.
        const jumpReady = jump !== undefined
            || (movement !== undefined && shipPhysics !== undefined
                && fuel !== undefined
                ? canJump({
                    hasRoute: nextSystem !== undefined,
                    distance: movement.position.length,
                    jumpRadius: jumpRadiusFor(JUMP_DISTANCE,
                        shipPhysics.jumpDistanceMod),
                    fuel: fuel.current,
                    fuelPerJump: FUEL_PER_JUMP,
                    disabled: disabled !== undefined,
                })
                : true);

        statusBar.drawNavigation(
            navReadout(destinationName, stellarName, jumpReady));
    }
});

/**
 * Total cargo capacity in tons for a ship + its owned outfits, or undefined
 * if the ship or an outfit's data hasn't cached yet (getCached kicks off the
 * load). Shared by the in-flight and docked cargo readouts.
 */
export function cargoCapacityOf(shipId: string, outfits: OutfitsState | undefined,
    gameData: SimulationGameDataInterface): number | undefined {
    const shipData = gameData.data.Ship.getCached(shipId);
    if (!shipData) {
        return undefined;
    }
    let capacity = shipData.physics.freeCargo;
    if (outfits) {
        const outfitCargo = sumOutfitField(
            outfits, gameData, o => o.physics.freeCargo ?? 0);
        if (outfitCargo === undefined) {
            return undefined; // An outfit's data isn't cached yet.
        }
        capacity += outfitCargo;
    }
    return capacity;
}

/**
 * The cargo panel's readout values (free space, manifest lines, and the
 * mission-cargo "Special:" summary) for a cargo hold and capacity. Undefined
 * if a jünk name isn't cached yet. Shared by the in-flight and docked paths.
 */
export function cargoDisplayOf(cargo: ReadonlyMap<string, number> | undefined,
    capacity: number, gameData: SimulationGameDataInterface):
    { free: number, lines: CargoLine[], special: string | null } {
    const lines: CargoLine[] = [];
    const specialNames: string[] = [];
    if (cargo) {
        for (const [key, quantity] of cargo) {
            if (quantity <= 0) {
                continue;
            }
            const stdIndex = standardCargoIndex(key);
            if (stdIndex !== null) {
                lines.push({
                    name: abbreviateCargoName(
                        STANDARD_CARGO_NAMES[stdIndex] ?? `Cargo ${stdIndex}`),
                    quantity,
                });
            } else if (key.startsWith('junk:')) {
                const junk = gameData.data.Junk.getCached(key.slice(5));
                lines.push({
                    name: abbreviateCargoName(junk?.abbrev || 'Cargo'),
                    quantity,
                });
            } else if (key.startsWith('mission:')) {
                specialNames.push('Cargo');
            }
        }
    }
    let used = 0;
    if (cargo) {
        for (const quantity of cargo.values()) {
            used += quantity;
        }
    }
    const free = Math.max(0, capacity - used);
    return { free, lines, special: specialCargoSummary(specialNames) };
}

const DrawStatusBarCargo = new System({
    name: 'DrawStatusBarCargo',
    args: [StatusBarResource, Optional(CargoComponent), Optional(CreditsComponent),
        ShipComponent, Optional(OutfitsStateComponent),
        SimulationGameDataResource, PlayerShipSelector] as const,
    step(statusBar, cargo, credits, ship, outfits, gameData) {
        const capacity = cargoCapacityOf(ship.id, outfits, gameData);
        if (capacity === undefined) {
            return; // Ship/outfit data not cached yet.
        }
        const { free, lines, special } = cargoDisplayOf(cargo, capacity, gameData);
        statusBar.drawCargo(free, credits?.credits ?? 0, lines, special);
    }
});

/**
 * The docked counterpart of the stats + cargo + credits readouts. While the
 * player is docked the ship is out of the display world (held by the spaceport
 * menu), so PlayerShipSelector matches nothing and the per-entity draw systems
 * above go quiet. This runs once per step from the DockedShipResource instead,
 * reading the held entity's components — or, while a venue is open, that
 * venue's live working state (credits/cargo/fuel before it commits) — so the
 * bar keeps tracking trades, outfit buys, refuels, and bar gambling live.
 */
const DrawDockedStatus = new System({
    name: 'DrawDockedStatus',
    args: [StatusBarResource, DockedShipResource, SimulationGameDataResource,
        SingletonComponent] as const,
    step(statusBar, dockedHolder, gameData) {
        const docked = dockedHolder.current;
        if (!docked) {
            return;
        }
        const entity = docked.entity;
        const live = docked.liveStatus?.() ?? {};

        // Shield/armor/fuel bars off the held entity; a venue may override fuel.
        const shield = entity.components.get(ShieldComponent);
        const armor = entity.components.get(ArmorComponent);
        if (shield && armor) {
            const fuel = live.fuel ?? entity.components.get(FuelComponent);
            statusBar.drawStats(shield, armor, fuel ?? undefined);
        }

        // Credits + cargo: the open venue's working values win over the
        // (not-yet-committed) entity components.
        const credits = live.credits
            ?? entity.components.get(CreditsComponent)?.credits ?? 0;
        const ship = entity.components.get(ShipComponent);
        if (!ship) {
            return;
        }
        const cargo = live.cargo ?? entity.components.get(CargoComponent);
        const capacity = live.cargoCapacity ?? cargoCapacityOf(
            ship.id, entity.components.get(OutfitsStateComponent), gameData);
        if (capacity === undefined) {
            return; // Ship/outfit data not cached yet.
        }
        const { free, lines, special } = cargoDisplayOf(cargo, capacity, gameData);
        statusBar.drawCargo(free, credits, lines, special);
    }
});

/** The civilian status bar (ïntf 128 / PICT 700), used when nothing else picks. */
export const DEFAULT_STATUS_BAR_ID = 'nova:128';

/**
 * Which ïntf resource the status bar should be drawn from while the player
 * flies `shipId`.
 *
 * EVN Bible, gövt section: the Interface field is "ID of an ïntf resource to
 * use when the player is flying a ship whose inherent attributes govt or
 * inherent combat govt is equal to this govt type", and the shïp section gives
 * InherentGovt the three ranges `interfaceGovt` already folds together
 * (novaparse ship_parse). In stock data this is what puts the Federation bar
 * (ïntf 130 / PICT 702) under a Fed Viper and the Polaris one (129 / 701)
 * under a Raven, while the ~93 classes with no inherent government and the
 * governments whose Interface is below 128 keep the default civilian bar.
 *
 * Returns undefined while the ship's or government's data is still loading
 * (getCached kicks the load off), so the caller can simply try again next
 * step rather than flashing the default bar in between.
 */
export function statusBarIdForShip(shipId: string,
    gameData: SimulationGameDataInterface): string | undefined {
    const shipData = gameData.data.Ship.getCached(shipId);
    if (!shipData) {
        return undefined;
    }
    if (!shipData.interfaceGovt) {
        return DEFAULT_STATUS_BAR_ID;
    }
    const govt = gameData.data.Govt.getCached(shipData.interfaceGovt);
    if (!govt) {
        return undefined;
    }
    return govt.statusBar ?? DEFAULT_STATUS_BAR_ID;
}

/**
 * Keeps the bar's ïntf resource in step with the ship the player flies. It
 * runs every step (rather than only at build) because the player's ship class
 * changes at the shipyard, and because the ship/govt data it needs streams in
 * asynchronously — the bar builds from the default interface and swaps to the
 * ship's own as soon as both resources are cached.
 */
const SelectStatusBarInterface = new System({
    name: 'SelectStatusBarInterface',
    args: [StatusBarResource, ShipComponent, SimulationGameDataResource,
        DisplayAssetDataResource, ScreenSize, PlayerShipSelector] as const,
    step(statusBar, ship, gameData, displayAssets, screen) {
        const wanted = statusBarIdForShip(ship.id, gameData);
        if (wanted === undefined || wanted === statusBar.statusBarId
            || statusBar.reloading) {
            return;
        }
        statusBar.reloading = true;
        void (async () => {
            try {
                await statusBar.reload(
                    await displayAssets.data.StatusBar.get(wanted));
                // A different interface may use a differently sized backdrop.
                statusBar.container.position.x =
                    screen.x - statusBar.container.width;
                statusBar.container.position.y = 0;
            } finally {
                statusBar.reloading = false;
            }
        })();
    },
});

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
        statusBar.container.position.x = window.innerWidth - statusBar.container.width;
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
