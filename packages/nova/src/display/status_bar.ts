import { StatusBarData } from "novadatainterface/status_bar_data";
import { EcsEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import * as PIXI from "pixi.js";
import { Subject } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { ControlAction } from "../nova_plugin/controls.js";
import { discoveryLevel } from "../nova_plugin/discovery_store.js";
import { DisplayAssetDataResource, SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { SystemIdResource } from "../nova_plugin/system_id_resource.js";
import { Button, ButtonClick } from "../spaceport/button.js";
import { DockedShipResource } from "./docked_ship.js";
import { PixiAppResource } from "./pixi_app_resource.js";
import { ScreenSize } from "./screen_size_plugin.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { Stage } from "./stage_resource.js";
import { CargoPane, DrawStatusBarCargo } from "./status_bar_cargo.js";
import { DrawDockedStatus } from "./status_bar_docked.js";
import { DrawStatusBarStats, GaugesPane } from "./status_bar_gauges.js";
import {
    DEFAULT_STATUS_BAR_ID, SelectStatusBarInterface, StatusBarResize,
} from "./status_bar_interface.js";
import { DEBUG_BUTTON_X, statusBarFonts } from "./status_bar_layout.js";
import {
    DiscoveryLevelResource, DrawStatusBarNavigation, NavigationPane,
} from "./status_bar_navigation.js";
import { DrawRadar, DrawStatusBarInterference, RadarPane } from "./status_bar_radar.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { DrawStatusBarTarget, TargetPane } from "./status_bar_target.js";
import { DrawStatusBarSecondaryWeapon, WeaponPane } from "./status_bar_weapon.js";

/**
 * The in-flight status bar: the ïntf's background PICT with one pane per
 * data area drawn over it. Each pane owns its own PIXI objects and draw
 * method (the DrawStatusBar* systems write straight to them); this class
 * owns the background, the fonts, the debug buttons, and the build /
 * reload / destroy lifecycle the panes share.
 */
export class StatusBar {
    readonly container = new PIXI.Container();
    /** Resolves when the current build (or reload) has finished. */
    buildPromise: Promise<void>;
    width = 0;

    readonly radar: RadarPane;
    readonly gauges: GaugesPane;
    readonly target: TargetPane;
    readonly navigation = new NavigationPane();
    readonly weapon = new WeaponPane();
    readonly cargo = new CargoPane();

    private addEnemyButton: Button;
    private giveCreditsButton: Button;
    private clearRecordButton: Button;
    readonly addEnemy: Subject<ButtonClick>;
    /** "Give 1M Credits" debug cheat. */
    readonly giveCredits: Subject<ButtonClick>;
    /** "Clear Legal Record" debug cheat. */
    readonly clearRecord: Subject<ButtonClick>;

    constructor(private statusBarData: StatusBarData, private displayAssets: DisplayAssetDataInterface,
                renderer: PIXI.Renderer | PIXI.IRenderer) {
        this.radar = new RadarPane(statusBarData);
        this.gauges = new GaugesPane(statusBarData);
        this.target = new TargetPane(renderer);
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

    /**
     * Builds the tree. The order the panes are added is the paint order,
     * and each pane's build adds its own children in the order the
     * original single-class bar did.
     */
    private async build() {
        const background = await this.displayAssets.spriteFromPictAsync(this.statusBarData.image);
        this.container.addChild(background);
        this.width = background.width;
        // Hit-testable so a click on the panel (radar, readouts) is seen
        // as a click on UI by tap_targeting's isBlocked hit test, not as a
        // click on the space drawn behind it.
        background.eventMode = 'static';
        this.radar.build(this.container);
        this.gauges.build(this.container);

        const fonts = statusBarFonts(this.statusBarData);
        this.navigation.build(this.container, this.statusBarData, fonts);
        this.weapon.build(this.container, this.statusBarData, fonts);
        this.target.build(this.container, this.statusBarData, fonts);
        this.cargo.build(this.container, this.statusBarData, fonts);

        this.container.addChild(this.addEnemyButton.container);
        this.container.addChild(this.giveCreditsButton.container);
        this.container.addChild(this.clearRecordButton.container);
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
        const outgoing = this.container.removeChildren();
        // Each PIXI.Text owns a generated canvas texture, so the outgoing set
        // is destroyed rather than merely detached: every text pane destroys
        // its own build's texts (and the target pane empties its class-owned
        // containers, which build() re-parents), and the draws bail until
        // the rebuild has run.
        this.target.reset();
        this.navigation.reset();
        this.weapon.reset();
        this.cargo.reset();
        // Everything else build() made for the old ïntf goes too — the
        // background sprite, the radar's static TilingSprite, the readout
        // panes' containers — or every interface swap would orphan them
        // (review #40). Only what build() RE-ADDS is kept: the class-owned
        // graphics and panes and the debug buttons. Textures are not
        // destroyed here: the background's and the static's are shared with
        // the asset cache (Sprite.destroy leaves them alone by default).
        const kept = new Set<PIXI.DisplayObject>([
            this.radar.graphics, this.gauges.graphics, this.target.container,
            this.target.noTargetContainer, this.addEnemyButton.container,
            this.giveCreditsButton.container, this.clearRecordButton.container,
        ]);
        for (const child of outgoing) {
            if (!kept.has(child) && !child.destroyed) {
                child.destroy({ children: true });
            }
        }
        this.radar.reset(statusBarData);
        this.gauges.reset(statusBarData);
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
        // A Text a pane owns but never parented (the target pane's image
        // placeholder) is out of the container's reach; each pane
        // destroys by name whatever the tree teardown did not.
        this.target.destroy();
        this.navigation.destroy();
        this.weapon.destroy();
        this.cargo.destroy();
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
        // it up via the radar's interferenceReduction.
        const systemId = world.resources.get(SystemIdResource);
        if (systemId) {
            const systemData = await simulationData.data.System.get(systemId);
            statusBar.radar.systemInterference = systemData.interference;
            if (systemData.interference > 0) {
                // The ppat pixel patterns the radar shows as sensor static.
                // Only needed in systems that actually have interference.
                const ppatIds = (await simulationData.ids).PpatImage;
                statusBar.radar.staticTextures = await Promise.all(ppatIds.map(
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
