/**
 * The browser entry point: WIRING ONLY.
 *
 * Constructs the page-lifetime services (the PIXI app, the game data,
 * the socket channel and its rooms, the display scale), builds the
 * client runtime (client/runtime.ts) around the client state machine
 * (client/client_state.ts), installs the console handles, and hands
 * off: to the title flow (title/title_flow.ts) on a bare load, or
 * straight into a game session (client/game_session.ts) on a deep link.
 *
 * Everything that used to be game logic here now lives under client/:
 *   client_state.ts   where the player is, as one value, and the named
 *                     transitions between the states
 *   system_entry.ts   entering a system (world + worker + room + fleet)
 *   transit.ts        jumps, gates, wormholes, and the recoveries
 *   docking.ts        spaceport / hypergate docks and lift-offs
 *   frame_pump.ts     the per-frame simulation round trip
 *   player_save.ts    saves and pilot-history checkpoints
 *   player_start.ts   the player ship at session start
 *   fleet_ledger.ts   the escort rosters and the fleet flushes
 *   game_session.ts   startGame / teardownGame and the input wiring
 */
import { sound as pixiSoundLibrary } from "@pixi/sound";
import { isLeft } from "fp-ts/lib/Either.js";
import { World } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import { Subject } from "rxjs";
import { ClientStateSlot } from "./client/client_state.js";
import { FleetLedger } from "./client/fleet_ledger.js";
import { simulationControl } from "./client/frame_pump.js";
import { startGame } from "./client/game_session.js";
import { DisplayAssetData } from "./client/gamedata/display_asset_data.js";
import { SimulationGameData } from "./client/gamedata/simulation_game_data.js";
import { isMuted } from "./client/mute.js";
import { PlayerPersistence } from "./client/player_save.js";
import { ClientRuntime } from "./client/runtime.js";
import { SessionTransitions } from "./client/session_transitions.js";
import { installVersionCheck } from "./client/version_reload.js";
import { CommunicatorClient } from "./communication/communicator_client.js";
import { MultiRoom } from "./communication/multi_room_communicator.js";
import { SocketChannelClient } from "./communication/socket_channel_client.js";
import { BUILD_VERSION } from "./common/generated_build_version.js";
import { DEBUG_FLAGS } from "./debug_flags.js";
import {
    applyRendererScale, clampScale, computeScaleLayout, describeDisplayScale,
    refreshTextResolution, ScalableView, ScaleInputs,
    setDefaultTextResolution, stepScale,
} from "./display/display_scale.js";
import {
    DisplayScaleResource, ResizeEvent,
} from "./display/screen_size_plugin.js";
import { Stage } from "./display/stage_resource.js";
import { showStatusMessage } from "./display/status_message_plugin.js";
import { ControlEvent } from "./nova_plugin/core/controls_plugin.js";
import { Controls, SavedControls } from "./nova_plugin/core/controls.js";
import { GateDestinationResolver } from "./nova_plugin/travel/gate_destination_resolver.js";
import {
    DisplaySettings, loadDisplaySettings, mergeControls, saveDisplaySettings,
} from "./title/client_prefs.js";
import { applyActivePilot, loadPilotControls } from "./title/pilot_registry.js";
import { runTitle } from "./title/title_flow.js";
import { liveSystem } from "./client/client_state.js";
import "./window_hooks.js";


const simulationGameData = new SimulationGameData();
const gateDestinationResolver = new GateDestinationResolver(simulationGameData);
const displayAssetData = new DisplayAssetData();
window.simulationGameData = simulationGameData;
window.displayAssetData = displayAssetData;
window.PIXI = PIXI;
// Debug switches (see debug_flags.ts): e.g. `debugFlags.tradeOverride`.
window.debugFlags = DEBUG_FLAGS;

// ── Display scaling ────────────────────────────────────────────────────
// The whole story is in display/display_scale.ts. In short: the GLOBAL
// scale rides on the renderer's RESOLUTION (a crisp zoom rather than an
// upsampled one), the UI scale is a transform on the UI layers only, and
// text is rasterized at devicePixelRatio x global x ui so glyphs land one
// texel per physical pixel at any combination. Both scales default to 1,
// which reproduces the pre-setting rendering exactly.
let displaySettings = loadDisplaySettings();

function currentScaleInputs(): ScaleInputs {
    return {
        devicePixelRatio: window.devicePixelRatio || 1,
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
        globalScale: displaySettings.globalScale,
        uiScale: displaySettings.uiScale,
    };
}

let scaleLayout = computeScaleLayout(currentScaleInputs());
window.novaScaleLayout = () => scaleLayout;

PIXI.settings.RESOLUTION = scaleLayout.resolution;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;
setDefaultTextResolution(scaleLayout.textResolution);

// TODO: Using WebGL 1 (instead of 2) seems to make the game smoother, but
// this will likely change in the future.
//PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL2;
const app = new PIXI.Application({
    width: scaleLayout.worldWidth,
    height: scaleLayout.worldHeight,
    autoDensity: true
});

window.app = app;
document.body.appendChild(app.view as any);

/**
 * The title screen's own UI layer: the title art, the About popup and the
 * rollback panel. The display world's UI lives in its `Stage` container
 * (see stage_resource.ts); the title has no display world, so it gets a
 * container of its own to carry the same UI scale.
 *
 * Added to `app.stage` first, so a game world's `DisplayRoot` draws over
 * it. It is empty whenever the game is running.
 */
const titleUiLayer = new PIXI.Container();
titleUiLayer.name = 'TitleUiLayer';
app.stage.addChild(titleUiLayer);

/**
 * Things that have to re-lay-out when the window resizes or a scale
 * changes: the title's letterboxing, the About box's centring. The game's
 * own layers are driven by ResizeEvent instead.
 */
const displayScaleListeners = new Set<() => void>();

// ── The client state machine and its runtime ───────────────────────────
const state = new ClientStateSlot();
window.novaClientState = () => state.state;
const fleet = new FleetLedger();
const saves = new PlayerPersistence(state, fleet, simulationGameData);

/**
 * Recomputes the layout from the window + the current preferences and
 * pushes it everywhere: the renderer, the UI layers' transforms, every
 * live `PIXI.Text`, and the display world's size resources.
 *
 * Called on window resize, on a page-zoom-driven devicePixelRatio change,
 * and whenever the player moves either scale.
 */
function applyDisplayScale(target?: World): void {
    // `target` is for the one caller that runs BEFORE the state machine
    // has been moved to the world it just built (the system entry):
    // everyone else means the live display world.
    const scaled = target ?? liveSystem(state.state)?.world;
    scaleLayout = computeScaleLayout(currentScaleInputs());
    applyRendererScale(
        app.renderer as unknown as ScalableView, scaleLayout);
    setDefaultTextResolution(scaleLayout.textResolution);
    refreshTextResolution(app.stage, scaleLayout.textResolution);
    titleUiLayer.scale.set(scaleLayout.uiScale);
    scaled?.resources.get(Stage)?.scale.set(scaleLayout.uiScale);
    const scaleResource = scaled?.resources.get(DisplayScaleResource);
    if (scaleResource) {
        scaleResource.ui = scaleLayout.uiScale;
        scaleResource.global = displaySettings.globalScale;
    }
    scaled?.emit(ResizeEvent, {
        x: scaleLayout.uiWidth, y: scaleLayout.uiHeight,
        worldX: scaleLayout.worldWidth, worldY: scaleLayout.worldHeight,
    });
    for (const listener of displayScaleListeners) {
        try {
            listener();
        } catch (e) {
            console.warn('Display scale listener failed:', e);
        }
    }
}

/** The live display-scale preferences (read by the preferences UI). */
function getDisplaySettings(): DisplaySettings {
    return { ...displaySettings };
}

/**
 * Sets and persists the display scales, applying them immediately. The
 * settings are machine-local (localStorage, never the pilot save), so
 * nothing here touches the simulation or the netcode.
 */
function setDisplaySettings(next: Partial<DisplaySettings>): DisplaySettings {
    displaySettings = {
        uiScale: clampScale(next.uiScale ?? displaySettings.uiScale),
        globalScale: clampScale(next.globalScale ?? displaySettings.globalScale),
    };
    saveDisplaySettings(displaySettings);
    applyDisplayScale();
    return { ...displaySettings };
}
window.novaDisplayScale = { get: getDisplaySettings, set: setDisplaySettings };

/**
 * The in-flight scale hotkeys ('[' / ']' for the UI, '-' / '=' for
 * everything, '\' to reset), so the scale can be tuned while looking at
 * the thing being scaled instead of from the title screen.
 *
 * Client-local like `fullscreen`: the actions exist in controls.ts only
 * so they can be bound and rebound, and the simulation has no handler for
 * them. Returns true when the event was a scale action.
 */
function applyScaleControl(event: ControlEvent): boolean {
    if (event.state !== 'start') {
        return false;
    }
    let next: Partial<DisplaySettings>;
    switch (event.action) {
        case 'uiScaleUp':
            next = { uiScale: stepScale(displaySettings.uiScale, 1) };
            break;
        case 'uiScaleDown':
            next = { uiScale: stepScale(displaySettings.uiScale, -1) };
            break;
        case 'globalScaleUp':
            next = { globalScale: stepScale(displaySettings.globalScale, 1) };
            break;
        case 'globalScaleDown':
            next = { globalScale: stepScale(displaySettings.globalScale, -1) };
            break;
        case 'resetScale':
            next = { uiScale: 1, globalScale: 1 };
            break;
        default:
            return false;
    }
    const applied = setDisplaySettings(next);
    const world = liveSystem(state.state)?.world;
    if (world) {
        showStatusMessage(world, describeDisplayScale(applied));
    }
    return true;
}

// Page zoom does not fire `resize` reliably on its own, but it always
// moves devicePixelRatio -- a media query pinned to the CURRENT ratio
// stops matching the moment it changes. One-shot listeners, re-armed each
// time, since the query itself has to be rebuilt around the new ratio.
function watchDevicePixelRatio(): void {
    const query = window.matchMedia?.(
        `(resolution: ${window.devicePixelRatio}dppx)`);
    if (!query) {
        return;
    }
    const onChange = () => {
        query.removeEventListener('change', onChange);
        applyDisplayScale();
        watchDevicePixelRatio();
    };
    query.addEventListener('change', onChange);
}

// The canvas is created before any display world exists (applyDisplayScale
// reads the state), so the first layout pass and the resize/zoom watchers
// are armed here.
applyDisplayScale();
watchDevicePixelRatio();
window.addEventListener('resize', () => applyDisplayScale());

// ── The socket, the rooms, the version handshake ───────────────────────
// Every peer in a room must be running the same build of NovaJS --
// nothing in the netcode reconciles two builds, so a stale bundle
// desyncs on contact. `installVersionCheck` runs the `/version` preflight
// (non-blocking; see its doc), and the callback it returns reacts to the
// server refusing this socket outright, which is the actual enforcement.
// Both routes end in at most ONE automatic reload.
const { onVersionMismatch, onAdmitted } = installVersionCheck(BUILD_VERSION);
const channel = new SocketChannelClient({
    buildVersion: BUILD_VERSION,
    onVersionMismatch,
});
// `connected` flips true on the first message the server sends, which it
// only sends to a client it has ADMITTED -- and it only admits matching
// builds. So this is positive proof the versions agree, and it resets the
// one-automatic-reload guard without depending on the `/version` route.
channel.connected.subscribe(connected => {
    if (connected) {
        onAdmitted();
    }
});
const communicator = new CommunicatorClient(channel);
window.communicator = communicator;
const multiRoom = new MultiRoom(communicator);
window.multiRoom = multiRoom;

const runtime: ClientRuntime = {
    app, gameData: simulationGameData, displayAssetData, communicator,
    multiRoom, gateDestinations: gateDestinationResolver,
    controlsSubject: new Subject<ControlEvent>(),
    transitions: new SessionTransitions(),
    state, fleet, saves,
    applyDisplayScale,
    autopilot: undefined,
};
window.novaSim = simulationControl;

// The touch controls hide under the spaceport UI: the `nova-docked` body
// class follows the state machine — on while docked at a spaceport, off
// the moment the player hits Depart (the launch is one frame away), off
// through every transit and at the title.
state.subscribe(next => {
    document.body.classList.toggle('nova-docked',
        next.kind === 'landed' && next.launching === undefined);
});

// ── Controls ───────────────────────────────────────────────────────────
let controls: Controls | undefined;

/**
 * Decodes the served controls.json with the active pilot's rebindings
 * layered over it. Throws if the result is not a valid control map.
 */
function buildControls(baseControlsJson: Record<string, unknown>): Controls {
    const merged = mergeControls(baseControlsJson, loadPilotControls());
    const decoded = SavedControls.pipe(Controls).decode(merged);
    if (isLeft(decoded)) {
        console.error(decoded.left);
        throw new Error("Failed to parse controls");
    }
    return decoded.right;
}

/**
 * Re-reads the active pilot's bindings into the live `controls` map.
 *
 * The key handler reads this map on every event, so a rebinding applies
 * immediately — no reload, and no need to leave and re-enter the game.
 * Called at game entry, after the Preferences dialog commits, and
 * whenever the active pilot changes.
 */
async function applyControls(): Promise<void> {
    try {
        const controlsJson =
            await simulationGameData.getSettings?.('controls.json');
        if (controlsJson) {
            controls = buildControls(controlsJson as Record<string, unknown>);
        }
    } catch (e) {
        console.warn('Failed to apply control bindings:', e);
    }
}

/** Enters the game with the active pilot's bindings loaded. */
async function enterGame(): Promise<() => Promise<void>> {
    const controlsJson = await simulationGameData.getSettings?.('controls.json');
    if (!controlsJson) {
        throw new Error("Expected controls settings to exist");
    }
    // Layer the ACTIVE PILOT's "Set Prefs" rebindings (stored in the pilot
    // registry; the served controls.json is read-only) over the defaults
    // before decoding.
    controls = buildControls(controlsJson as Record<string, unknown>);
    return startGame(runtime, {
        controls: () => controls,
        applyScaleControl,
        globalScale: () => displaySettings.globalScale,
    });
}

// `?mute` silences everything played through the pixi sound layer
// (UI beeps, weapons, ambient) in addition to the title music gated
// in the title flow — one switch for preview panels and automated loads.
if (isMuted()) {
    pixiSoundLibrary.volumeAll = 0;
}

// A bare load shows the title screen first. A deep-link that names a
// ship / system / chär (used by tests, the visual-compare harness, and
// shareable URLs), or an explicit ?enter, skips straight into the game.
const entryQuery = new URLSearchParams(window.location.search);
const autoEnter = ['enter', 'ship', 'system', 'char']
    .some(param => entryQuery.has(param));

// Point the save layer at the active pilot BEFORE anything reads a save.
// On first run this migrates the legacy single slot into the registry as
// the first pilot, keeping its save exactly where it already is.
applyActivePilot();

if (autoEnter) {
    enterGame().catch((e) => {
        console.error('Failed to start game:', e);
    });
} else {
    runTitle(runtime, {
        titleUiLayer,
        uiSize: () => ({ width: scaleLayout.uiWidth, height: scaleLayout.uiHeight }),
        onDisplayScale: listener => {
            displayScaleListeners.add(listener);
            return () => { displayScaleListeners.delete(listener); };
        },
        startGame: enterGame,
        applyControls,
        displayScale: { get: getDisplaySettings, set: setDisplaySettings },
    }).catch((e) => {
        console.error('Title screen failed; entering game directly.', e);
        void enterGame();
    });
}
