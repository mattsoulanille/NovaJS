/**
 * The handles the client hangs on `window` for the browser console and
 * the headless/visual-comparison harnesses (puppeteer drives them by
 * name, so they are part of the test surface, not just conveniences).
 *
 * Typed here, once, so the code that installs them needs no cast. Every
 * one is optional: nothing sets them before the plug-in or session that
 * owns them has built, and none exists at all in workers, on the server,
 * or in the node specs (which is why each installer guards
 * `typeof window`).
 */
import type { Entity } from 'nova_ecs/entity';
import type { Serializer } from 'nova_ecs/plugins/serializer_plugin';
import type { World } from 'nova_ecs/world';
import type * as PIXI from 'pixi.js';
import type { Autopilot } from './autopilot.js';
import type { ClientState } from './client/client_state.js';
import type { FleetLedger } from './client/fleet_ledger.js';
import type { SimulationControl } from './client/frame_pump.js';
import type { DisplayAssetData } from './client/gamedata/display_asset_data.js';
import type { SimulationGameData } from './client/gamedata/simulation_game_data.js';
import type { CommunicatorClient } from './communication/communicator_client.js';
import type { MultiRoom } from './communication/multi_room_communicator.js';
import type { DEBUG_FLAGS } from './debug_flags.js';
import type { DebugSettings } from './debug_settings.js';
import type { ScaleLayout } from './display/display_scale.js';
import type { HailDialog } from './spaceport/hail_dialog.js';
import type { OfferPopup } from './spaceport/offer_popup.js';
import type { Starmap } from './spaceport/starmap.js';
import type { DiscoveryHooks } from './display/starmap_plugin.js';
import type { JumpVisual } from './display/jump_fade_plugin.js';
import type { GpuParticleSystem } from './display/gpu_particles.js';
import type { ControlEvent } from './nova_plugin/core/index.js';
import type { DisplaySettings } from './title/client_prefs.js';
import type { TitleMusic } from './title/title_music.js';
import type { TitleScreen } from './title/title_screen.js';

/**
 * The live display settings hung on `window.novaSettings`, e.g.
 * `novaSettings.jumpVisual = 'fade'`. The plug-in that owns a setting
 * defines its property (with a getter/setter) when it builds. A new live
 * setting is declared here and only here, so the console surface grows
 * in one place.
 */
export interface LiveSettings {
    /** How a hyperspace jump is drawn (jump_fade_plugin). */
    jumpVisual?: JumpVisual;
}

declare global {
    interface Window {
        // ── Page-lifetime services (browser.ts) ────────────────────────
        /** The PIXI application. */
        app?: PIXI.Application;
        /** The PIXI namespace, for console poking. */
        PIXI?: typeof PIXI;
        simulationGameData?: SimulationGameData;
        displayAssetData?: DisplayAssetData;
        communicator?: CommunicatorClient;
        multiRoom?: MultiRoom;
        /** The current display-scale layout (display/display_scale.ts). */
        novaScaleLayout?: () => ScaleLayout;
        /** The display-scale preferences, live. */
        novaDisplayScale?: {
            get(): DisplaySettings,
            set(next: Partial<DisplaySettings>): DisplaySettings,
        };
        /** Debug switches (debug_flags.ts): e.g. `debugFlags.tradeOverride`. */
        debugFlags?: typeof DEBUG_FLAGS;
        /** Debug control over simulation stepping (client/frame_pump.ts). */
        novaSim?: SimulationControl;
        /** Where the client is (client/client_state.ts), for the console
         * and the harnesses: `novaClientState().kind`. */
        novaClientState?: () => ClientState;

        // ── The title (title/title_flow.ts) ────────────────────────────
        novaTitle?: TitleScreen;
        novaTitleMusic?: TitleMusic;

        // ── A game session (client/game_session.ts) ────────────────────
        /** The outer NovaPlugin bookkeeping world. */
        world?: World;
        novaAutopilot?: Autopilot;
        /** Inject control events directly, bypassing the keyboard. */
        novaControls?: { send(events: ControlEvent[]): void };
        /** Hire escorts onto the player through the bar's spawn path. */
        novaSpawnEscorts?: (shipIds: string[]) => Promise<void>;
        novaEscortRosters?: () => ReturnType<FleetLedger['summary']>;
        novaEscortAudit?: (expected?: string[]) =>
            ReturnType<FleetLedger['audit']>;
        /** Console-callable save / reset (client/player_save.ts). */
        novaSaveNow?: () => void;
        novaResetSave?: () => void;

        // ── The live system (client/system_entry.ts) ───────────────────
        /** The current display world. */
        displayWorld?: World;
        /** The simulation worker. */
        simulationWorker?: Worker;
        /** The simulation serializer (the harness's handle on the synced
         * component singletons). */
        novaSimSerializer?: Serializer;
        /** Debug toggles, e.g. novaDebug.showCollisionShapes = true. */
        novaDebug?: DebugSettings;
        /** The player's ship entity (player_ship_plugin, shipyard, ...). */
        myShip?: Entity;

        // ── Display plug-ins ───────────────────────────────────────────
        /** Live display settings (see LiveSettings). */
        novaSettings?: LiveSettings;
        /** The comm dialog (hail_dialog_plugin). */
        novaHailDialog?: HailDialog;
        /** The galaxy map (starmap_plugin). */
        novaStarmap?: Starmap;
        /** The discovery record levers (starmap_plugin). */
        novaDiscovery?: DiscoveryHooks;
        /** The most recent mission offer popups (offer_popup). */
        novaOfferPopups?: OfferPopup[];
        /** Live particle budget counters (particles_plugin). */
        novaParticleStats?: () => ReturnType<GpuParticleSystem['stats']>;
    }
}
