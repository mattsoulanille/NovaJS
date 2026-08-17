import * as Comlink from "comlink";
import { sound as pixiSoundLibrary } from "@pixi/sound";
import { isMuted } from "./client/mute.js";
import { isLeft } from "fp-ts/lib/Either.js";
import { UnknownComponent } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { multiplayer } from "nova_ecs/plugins/multiplayer_plugin";
import { CommunicatorResource } from "nova_ecs/plugins/multiplayer_plugin";
import { MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { Serializer, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { TimePlugin, TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import { firstValueFrom, filter, Subject, Subscription } from "rxjs";
import Stats from 'stats.js';
import { v4 } from "uuid";
import { DisplayAssetData } from "./client/gamedata/display_asset_data.js";
import { SimulationGameData } from "./client/gamedata/simulation_game_data.js";
import { CommunicatorClient } from "./communication/communicator_client.js";
import { MultiRoom } from "./communication/multi_room_communicator.js";
import { makeBrowserSimulationBridgeClient } from "./communication/simulation_bridge_browser_worker.js";
import { emitSimulationBridgeEvent } from "./communication/simulation_bridge_events.js";
import {
    AsyncSimulationBridgeClient,
    EntityDelta,
    SimulationBridgeClosedError,
    SimulationFrame,
    SimulationPacing,
} from "./communication/simulation_bridge.js";
import { SocketChannelClient } from "./communication/socket_channel_client.js";
import { DebugSettings } from "./debug_settings.js";
import { Display } from "./display/display_plugin.js";
import { SimulationTimeResource } from "./display/simulation_time.js";
import { PixiAppResource } from "./display/pixi_app_resource.js";
import { ResizeEvent } from "./display/screen_size_plugin.js";
import { SetJumpRouteEvent } from "./display/starmap_plugin.js";
import { HailRequestEvent } from "./display/hail_dialog_plugin.js";
import { LeaveSpaceportEvent, OpenSpaceportEvent } from "./display/spaceport_plugin.js";
import { Stage } from "./display/stage_resource.js";
import { AddEnemyEvent, DebugActionEvent } from "./display/status_bar.js";
import { PlunderActionEvent } from "./display/boarding_plugin.js";
import { AcceptShipMissionEvent } from "./display/ship_mission_offer_plugin.js";
import { AcceptedMission } from "./nova_plugin/mission_accept.js";
import { daysPerJump } from "./nova_plugin/calendar.js";
import { ControlEvent, ControlsSubject, EcsControlEvent } from "./nova_plugin/controls_plugin.js";
import { ControlAction, Controls, getActions, SavedControls } from "./nova_plugin/controls.js";
import { DisplayAssetDataResource, SimulationGameDataResource } from "./nova_plugin/game_data_resource.js";
import { FinishJumpEvent, JumpComponent, JumpRouteComponent, reconcileRouteOnArrival } from "./nova_plugin/jump_plugin.js";
import { GateArrivalComponent, GateTransitEvent } from "./nova_plugin/gate_transit_plugin.js";
import { GateDestinationResolver } from "./nova_plugin/gate_destination_resolver.js";
import { LeaveGateMapEvent, OpenGateMapEvent } from "./display/gate_map_plugin.js";
import { GateArrivalAnticipationEvent } from "./display/gate_animation_plugin.js";
import { makeShip } from "./nova_plugin/make_ship.js";
import { makeSystem, SIMULATION_STEP_MS } from "./nova_plugin/make_system.js";
import { makeControlBitHooks, NCBParseError, runNCBSet } from "./nova_plugin/ncb.js";
import {
    ActiveRanksComponent, ControlBitsComponent,
} from "./nova_plugin/ncb_plugin.js";
import { MultiRoomResource, NovaPlugin } from "./nova_plugin/nova_plugin.js";
import { OutfitsStateComponent } from "./nova_plugin/outfit_plugin.js";
import { LandEvent, PlanetTargetComponent } from "./nova_plugin/planet_plugin.js";
import { TargetComponent } from "./nova_plugin/target_component.js";
import { PlayerShipSelector } from "./nova_plugin/player_ship_plugin.js";
import { CreditsComponent, GameDateComponent } from "./nova_plugin/player_state_plugin.js";
import { initialRecordsFromGovtStatuses } from "./nova_plugin/reputation.js";
import { CombatRatingComponent, LegalRecordsComponent } from "./nova_plugin/reputation_plugin.js";
import { resetExplored } from "./nova_plugin/explored_store.js";
import {
    ControlBitPair, ControlBitResolver,
} from './nova_plugin/control_bit_namespaces.js';
import {
    EscortToSave, SavedEscort, collectEscortsToSave, decodeSave, encodeSave,
    extractSaveData, extractSavedEscorts, getActiveSaveKey, loadSave,
    resetSave, restorePlayerState, restoreSavedEscorts, SaveData, writeSave,
} from "./nova_plugin/save_game.js";
import { ControlledByComponent } from "./nova_plugin/ship_control.js";
import { ShipComponent, ShipPhysicsComponent } from "./nova_plugin/ship_plugin.js";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Vector } from "nova_ecs/datatypes/vector";
import { EscortCommandComponent } from "./nova_plugin/escort_command.js";
import { FiringGroupComponent } from "./nova_plugin/firing_group.js";
import { FormationComponent, formationSlotPosition } from "./nova_plugin/npc_ai_plugin.js";
import { makeNpcShip } from "./nova_plugin/npc_spawn_plugin.js";
import { buildMissionShipSpawns } from "./nova_plugin/mission_ship_spawn.js";
import { advanceEntityDate, ensurePlayerStateComponents } from "./spaceport/mission_session.js";
import { PendingEscortsComponent } from "./spaceport/pending_escorts.js";
import {
    carriedBatchMustHold, carriedBatchSettled, CarriedEscort,
    escortsAccountedFor, prepareCarriedEscorts, restoreFailedTransitionBatch,
    takeCarriedEscorts, takeEscortsForTransition,
} from "./spaceport/landed_escorts.js";
import { restockCarriedEscorts } from "./spaceport/escort_restock.js";
import {
    EscortJumpEvent, EscortLandedEvent,
} from "./nova_plugin/player_escort_plugin.js";
import { PlayerEscortComponent } from "./nova_plugin/player_escort.js";
import { MissionUniverse } from "./spaceport/mission_universe.js";
import { SystemIdResource } from "./nova_plugin/system_id_resource.js";
import { AnalogControlState } from "./nova_plugin/ship_control.js";
import { Autopilot, ControlSinks } from "./autopilot.js";
import { installTapTargeting } from "./tap_targeting.js";
import { installTouchControls, wantsTouchControls } from "./touch_controls.js";
import { TitleScreen, TitleStatus } from "./title/title_screen.js";
import { TitleMusic } from "./title/title_music.js";
import {
    ABOUT_TEXT, fillAboutPlaceholders, showNewPilotDialog,
    showOpenPilotDialog, showPreferencesDialog, PilotDialogActions,
    PilotEntry,
} from "./title/title_dialogs.js";
import { OfferPopup } from "./spaceport/offer_popup.js";
import {
    clearPilotProfile, loadPilotProfile, mergeControls, savePilotProfile,
} from "./title/client_prefs.js";
// clearPilotProfile is wired into the ?reset path below.
import {
    applyActivePilot, createPilot, deletePilot, exportCheckpointFile,
    exportFileName, exportPilot, getActivePilot, importOriginalPilot,
    importPilot, ImportResult, listPilots, loadPilotControls, selectPilot,
} from "./title/pilot_registry.js";
import {
    looksLikeOriginalPilot, OriginalPilotContext,
} from "./title/original_pilot_import.js";
import {
    checkpointCount, latestState, loadHistory, recordCheckpoint,
    rewindPilotSave,
} from "./title/pilot_history.js";
import { RollbackScreen, ROLLBACK_PANEL } from "./title/rollback_screen.js";
import { JsonValue } from "./title/json_patch.js";
import {
    CheckpointRequest, checkpointRequests, describeFlightChanges,
} from "./spaceport/checkpoint_requests.js";
import { combatRatingName } from "./nova_plugin/reputation.js";
import { displayName } from "./nova_plugin/display_name.js";
import { formatDate } from "./nova_plugin/calendar.js";
import { isTextEntryActive } from "./input_focus.js";
import { MenuControls } from "./spaceport/menu_controls.js";
import { DEBUG_FLAGS } from "./debug_flags.js";
import { BUILD_VERSION } from "./common/generated_build_version.js";
import { installVersionCheck } from "./client/version_reload.js";


const simulationGameData = new SimulationGameData();
const gateDestinationResolver = new GateDestinationResolver(simulationGameData);
const displayAssetData = new DisplayAssetData();
(window as any).simulationGameData = simulationGameData;
(window as any).displayAssetData = displayAssetData;
(window as any).PIXI = PIXI;

const pixelRatio = window.devicePixelRatio || 1;
PIXI.settings.RESOLUTION = pixelRatio;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

// TODO: Using WebGL 1 (instead of 2) seems to make the game smoother, but
// this will likely change in the future.
//PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL2;
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    autoDensity: true
});

(window as any).app = app;
document.body.appendChild(app.view as any);

// The build-version handshake. Every peer in a room must be running the
// same build of NovaJS -- nothing in the netcode reconciles two builds, so
// a stale bundle desyncs on contact. `installVersionCheck` runs the
// `/version` preflight (non-blocking; see its doc), and the callback it
// returns reacts to the server refusing this socket outright, which is the
// actual enforcement. Both routes end in at most ONE automatic reload.
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
(window as any).communicator = communicator;
const multiRoom = new MultiRoom(communicator);
(window as any).multiRoom = multiRoom;

let world: World;
let displayWorld: World | undefined;
let simulationBridge: AsyncSimulationBridgeClient | undefined;
let simulationWorker: Worker | undefined;
let simulationSerializer: Serializer | undefined;
let activeSystemId: string | undefined;
let roomSubscriptions: Subscription[] = [];
let pendingDockedShip: { uuid: string, entity: Entity, planetId: string } | undefined;
let dockedShip: { uuid: string, entity: Entity, planetId: string } | undefined;
let pendingLaunchedShip: Entity | undefined;
// Hypergate docking, mirroring the spaceport dock: the ship is removed from
// the sim while the hypergate map is open, then either transits (jumpTo) or
// relaunches at the gate.
let pendingGateShip: { uuid: string, entity: Entity, planetId: string } | undefined;
let gateDockedShip: { uuid: string, entity: Entity, planetId: string } | undefined;
let pendingGateLaunch: Entity | undefined;
// The gate the player is about to arrive through. Set just before the
// transit's jumpTo; the destination display world is told the moment it is
// created (GateArrivalAnticipationEvent) so the gate's opening animation
// gets a head start of the room join + insertion latency.
let pendingGateArrivalSpob: string | undefined;
/**
 * Escorts the simulation handed over because their player is jumping
 * (EscortJumpEvent). Filled synchronously while the frame's events are
 * dispatched and consumed by the jumpTo they belong to — which always runs
 * later, because the FinishJumpEvent handler awaits the date advance before
 * calling it. That is the ordering guarantee that keeps the carry ahead of
 * teardownActiveSystem's entity purge.
 *
 * Also where a batch WAITS OUT a multi-jump chain. jumpTo hands the batch
 * back to this array instead of inserting it whenever the arriving player
 * is going to auto-continue (multiJumpChainContinues), so each further hop
 * simply picks it up again; flushCarriedJumpEscorts puts it down once the
 * chain settles. That is what stops the chain out-running the insertion
 * records and stranding escorts in an intermediate system.
 */
let carriedJumpEscorts: CarriedEscort[] = [];
/**
 * Landing drops your target. In the original you have no reticle while
 * landed and none when you lift off again — targeting simply does not
 * survive a landing — so both the ship target and the stellar selection go
 * as the ship is docked.
 *
 * Done HERE, on the entity the browser is holding out of the world, which
 * is the same commit pattern the spaceport uses for everything else it
 * changes while docked (fuel, outfits, cargo): the cleared components ride
 * back into the simulation with the launch's addEntity input record, so
 * every peer sees the same thing at the same tick and nothing is written
 * behind the sim's back. The display's own reticles are taken down by the
 * corner sweep systems (target_corners_plugin), which is what handles the
 * separate half of this: the drawing systems run on the player's entity,
 * and a docked player has no entity in the display world at all.
 */
function clearTargetsOnLanding(ship: Entity) {
    if (ship.components.has(TargetComponent)) {
        ship.components.set(TargetComponent, { target: undefined });
    }
    if (ship.components.has(PlanetTargetComponent)) {
        ship.components.set(PlanetTargetComponent, { target: undefined });
    }
}

/**
 * Escorts that landed with the player (EscortLandedEvent), held while the
 * player is docked and respawned on departure. The client-side half of the
 * landing split, exactly like dockedShip.
 */
let landedEscorts: CarriedEscort[] = [];
/**
 * The escorts a loaded save is still holding, as ENCODED blobs.
 *
 * They cannot be decoded when the save is read: startGame reads it before
 * any system world exists, and the entity serializer comes out of that
 * world. So the blobs wait here and are drained by the first enterSystem —
 * which, for a session that loaded a save, is the startup jumpTo. Draining
 * makes it one-shot, and the escorts join that transition's ordinary
 * carried batch, so they re-enter through the same prepareCarriedEscorts /
 * addEntity path a liftoff or a jump uses rather than a second pipeline.
 */
let restoredSaveEscorts: SavedEscort[] | undefined;
/**
 * The player ship uuid the loaded save was written under, paired with
 * `restoredSaveEscorts` and drained with it.
 *
 * The restored player is a NEW entity under a NEW uuid, so every reference
 * the saved escorts hold to their player is stale. Carried onto each
 * restored entry as CarriedEscort.priorPlayer, which is what lets
 * prepareCarriedEscorts rewrite a player-launched fighter's
 * OwnerComponent/SourceComponent onto the live player.
 */
let restoredSavePlayerUuid: string | undefined;
/**
 * The control-bit namespace resolver for the plug-in set the SERVER
 * loaded, and the saved bits it could not represent (their plug-in is not
 * loaded here). Set once per game session by startGame from the save it
 * restored; saveNow writes bits as (namespace, bit) pairs through the
 * resolver and carries the parked pairs along unchanged, so a pilot's
 * progress in a plug-in survives a stint on a server without it (see
 * nova_plugin/control_bit_namespaces.ts).
 */
let controlBitResolver: ControlBitResolver | undefined;
let parkedControlBits: ControlBitPair[] = [];
/**
 * The end of the formation-slot run the client has already handed out for a
 * player, so a later insertion in the same session cannot reuse those slots.
 * The display world is not a safe floor on its own: it does not see a
 * launch's own batches until a later frame, and an insertion record can land
 * beyond the ticks a frame stepped (see SimulationBridgeClient.schedule), so
 * a late flush could otherwise duplicate the launch's slots and stack two
 * escorts on one station.
 */
let clientSlotFloor: { player: string, next: number } | undefined;
let controls: Controls | undefined;
const controlsSubject = new Subject<ControlEvent>();

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
 * The key handler reads this module-level map on every event, so a
 * rebinding applies immediately — no reload, and no need to leave and
 * re-enter the game. Called after the Preferences dialog commits and
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
let autopilot: Autopilot | undefined;
let simulationTickInFlight = false;
let lastPumpDone: number | undefined;
let syncedPlayerJumpRoute: string[] | undefined;
// Cleanups for everything a single game session (startGame) registers on
// shared, session-independent surfaces — document/window listeners, the
// PIXI ticker, the frame-pump worker, the stats overlay. Run (and cleared)
// when the player leaves the game back to the title, so re-entering doesn't
// stack duplicate listeners/tickers/workers.
let sessionDisposers: Array<() => void> = [];
// Tap/click targeting lives on the persistent canvas and reads live module
// state, so it is installed exactly once (not per session).
let tapTargetingInstalled = false;
let touchControlsInstalled = false;

// Fixed-timestep bookkeeping: real elapsed ms not yet simulated.
const MAX_CATCHUP_STEPS = 6;
let simulationTimeDebt = 0;
let lastPumpTime: number | undefined;
/**
 * Tick pacing against the room's clock (from the last frame). Small
 * drift is corrected by the rate factor — time runs imperceptibly
 * fast or slow. Only drift beyond SNAP_BEHIND_TICKS (a hidden tab, a
 * long stall) is snapped, bounded per frame by HARD_CATCHUP_STEPS.
 */
let simulationPacing: SimulationPacing | undefined;
const SNAP_BEHIND_TICKS = 30;
const HARD_CATCHUP_STEPS = 60;
/** Debug control over simulation stepping: `window.novaSim`. */
const simulationControl = {
    paused: false,
    pendingSteps: 0,
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    /** While paused, runs `count` simulation steps on the next frame. */
    step(count = 1) { this.pendingSteps += count; },
    /** Rolls the simulation back `ticks` (~60/s) and resimulates. */
    async rewind(ticks = 60) {
        return await simulationBridge?.rewind(ticks) ?? false;
    },
    /** Desync recovery: rebuild from genesis plus the room's input log. */
    async resync() {
        return await simulationBridge?.resync() ?? false;
    },
    /** The current clock slew against the room's tick, if any. */
    get pacing() { return simulationPacing; },
    /** Worker diagnostics: tick, desyncs, join result, recent logs. */
    async status() {
        return await simulationBridge?.status() ?? null;
    },
    /** Per-entity world hashes, for diffing against another client's
     * (or the server's archive dump on desync). */
    async hashes() {
        return await simulationBridge?.entityHashes() ?? null;
    },
    /** Debug: is the frame pump wedged on an await? */
    get inFlight() { return simulationTickInFlight; },
    /** Debug: wall-clock ms since the pump last completed a frame. */
    get sinceLastPump() {
        return lastPumpDone === undefined
            ? null : performance.now() - lastPumpDone;
    },
};
(window as any).novaSim = simulationControl;
const syncedComponents = new Map<string, Set<UnknownComponent>>();
const warnedUnsyncableEntities = new Set<string>();

function syncEntityToDisplay(uuid: string, encodedEntity: unknown, serializer: Serializer, displayWorld: World) {
    const decoded = serializer.decode(encodedEntity);
    if (isLeft(decoded)) {
        if (!warnedUnsyncableEntities.has(uuid)) {
            warnedUnsyncableEntities.add(uuid);
            console.warn(
                `Skipping entity ${uuid} because serializer decode failed: `
                + serializer.describeDecodeFailure(encodedEntity, decoded.left)
            );
        }
        return;
    }
    const syncedEntity = decoded.right;

    let displayEntity = displayWorld.entities.get(uuid);
    if (!displayEntity) {
        displayEntity = new Entity(syncedEntity.name);
        displayWorld.entities.set(uuid, displayEntity);
    } else if (displayEntity.name !== syncedEntity.name) {
        displayEntity.name = syncedEntity.name;
    }

    const previousComponents = syncedComponents.get(uuid) ?? new Set<UnknownComponent>();
    const nextComponents = new Set<UnknownComponent>(syncedEntity.components.keys());

    for (const [component, data] of syncedEntity.components) {
        displayEntity.components.set(component, data);
    }

    for (const component of previousComponents) {
        if (!nextComponents.has(component)) {
            displayEntity.components.delete(component);
        }
    }

    syncedComponents.set(uuid, nextComponents);
}

function applyEntityDelta(uuid: string, delta: EntityDelta, serializer: Serializer, displayWorld: World) {
    const displayEntity = displayWorld.entities.get(uuid);
    if (!displayEntity) {
        if (!warnedUnsyncableEntities.has(uuid)) {
            warnedUnsyncableEntities.add(uuid);
            console.warn(`Received a delta for entity ${uuid}, which is not in the display world`);
        }
        return;
    }

    if (delta.name !== undefined) {
        displayEntity.name = delta.name;
    }

    const synced = syncedComponents.get(uuid) ?? new Set<UnknownComponent>();
    syncedComponents.set(uuid, synced);
    for (const [componentName, encoded] of delta.changed) {
        const decoded = serializer.decodeComponent(componentName, encoded);
        if (!decoded) {
            continue;
        }
        if (isLeft(decoded)) {
            const warnKey = `${uuid} ${componentName}`;
            if (!warnedUnsyncableEntities.has(warnKey)) {
                warnedUnsyncableEntities.add(warnKey);
                console.warn(`Skipping component ${componentName} of entity ${uuid} because decode failed`);
            }
            continue;
        }
        const [component, data] = decoded.right;
        displayEntity.components.set(component, data);
        synced.add(component);
    }
    for (const componentName of delta.removed) {
        const component = serializer.componentsByName.get(componentName);
        if (!component) {
            continue;
        }
        displayEntity.components.delete(component);
        synced.delete(component);
    }
}

function applySimulationFrame(frame: SimulationFrame, serializer: Serializer, displayWorld: World) {
    for (const [uuid, entity] of frame.added) {
        syncEntityToDisplay(uuid, entity, serializer, displayWorld);
    }
    for (const [uuid, delta] of frame.changed) {
        applyEntityDelta(uuid, delta, serializer, displayWorld);
    }
    for (const uuid of frame.removed) {
        syncedComponents.delete(uuid);
        displayWorld.entities.delete(uuid);
    }

    // The simulation's time (frame.time) is NOT copied into the display
    // world's TimeResource: the simulation runs on fixed, 0-based
    // logical time, while the display world keeps wall-clock time for
    // smooth rendering. It is mirrored under a separate resource for
    // display systems that compare against sim-clock timestamps on
    // components (e.g. debris expiry).
    if (frame.time) {
        displayWorld.resources.set(SimulationTimeResource, frame.time);
    }
}

function getDisplayPlayerJumpRoute(displayWorld: World) {
    for (const entity of displayWorld.entities.values()) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        const jumpRoute = entity.components.get(JumpRouteComponent);
        return jumpRoute?.route;
    }
    return undefined;
}

let prefetchedSystemId: string | undefined;
/**
 * Starts loading the destination system's data and sprite assets while
 * the jump sequence plays. Display-side only: the simulation never
 * waits on these loads. Arrival is inherently load-gated regardless —
 * jumpTo() builds the destination world (makeSystem loads its planets
 * and linked-system metadata) and completes the room join before the
 * player's ship is inserted, and that insertion is an input record, so
 * a slow load only delays the arrival tick without desyncing anyone.
 * Prefetching just shortens the time spent on the white screen.
 */
function prefetchJumpDestination(displayWorld: World) {
    for (const entity of displayWorld.entities.values()) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        const jump = entity.components.get(JumpComponent);
        // A VANISHING jump is a ship leaving the world, not travelling
        // (see JumpStateType): its `to` is the VANISH_DESTINATION sentinel
        // and names no system to load. The player never has one, but there
        // would be nothing to prefetch either way. The `!destination` half
        // also catches the sentinel on its own, which is why it is falsy —
        // it stays as the belt-and-braces guard against ever asking the
        // game data for the empty system id.
        const destination = jump?.to;
        if (!jump || jump.vanish || !destination || jump.stage === 'arriving'
            || prefetchedSystemId === destination) {
            return;
        }
        prefetchedSystemId = destination;
        void (async () => {
            try {
                const system = await simulationGameData.data.System.get(destination);
                await Promise.all([
                    ...system.links.map(link =>
                        simulationGameData.data.System.get(link)),
                    ...system.planets.map(async planetId => {
                        const planet =
                            await simulationGameData.data.Planet.get(planetId);
                        await Promise.all(
                            Object.values(planet.animation.images).flatMap(
                                image => image ? [
                                    displayAssetData.data.SpriteSheetFrames
                                        .get(image.id),
                                    displayAssetData.data.SpriteSheetImage
                                        .get(image.id),
                                ] : []));
                    }),
                ]);
            } catch (e) {
                console.warn(`Failed to prefetch system ${jump.to}`, e);
            }
        })();
        return;
    }
}

function routesEqual(a?: string[], b?: string[]) {
    if (a === b) {
        return true;
    }
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    return a.every((entry, index) => entry === b[index]);
}

/** Finds the local player's ship entity in the given display world. */
/**
 * Spawns the escorts hired in the bar (see pending_escorts.ts) as NPC
 * sim entities in formation on the relaunched player ship, through
 * the same input-record addEntity path the player entity itself uses
 * — deterministic across peers because the fully-built entity is
 * baked into the record. Slots continue after any followers the
 * player already has. In-system only: hired escorts do not follow
 * through hyperspace (documented gap; tied to future persistence
 * work).
 */
/** The first free formation slot on `leaderUuid` in the display
 * world (used to continue slot numbering across spawn batches). */
function nextFormationSlot(displayWorld: World, leaderUuid: string): number {
    let slot = 0;
    for (const entity of displayWorld.entities.values()) {
        const formation = entity.components.get(FormationComponent);
        if (formation?.leader === leaderUuid) {
            slot = Math.max(slot, formation.slot + 1);
        }
    }
    return slot;
}

async function spawnHiredEscorts(
    bridge: AsyncSimulationBridgeClient, displayWorld: World,
    leaderUuid: string, leader: Entity, shipIds: string[],
    ownerUuid?: string, firstSlot?: number): Promise<void> {
    const movement = leader.components.get(MovementStateComponent);
    if (!movement) {
        console.warn('Hired escorts skipped: leader has no movement state');
        return;
    }
    // Continue slot numbering after existing followers (e.g. escorts
    // hired on an earlier landing this session). `firstSlot` lets a
    // caller that inserts several batches in one launch (returning
    // escorts, then new hires) keep their slots distinct — the display
    // world does not see the earlier batch until a later frame.
    let slot = firstSlot ?? nextClientSlot(displayWorld, leaderUuid);
    noteSlotsUsed(leaderUuid, slot + shipIds.length);
    for (const shipId of shipIds) {
        try {
            const shipData = await simulationGameData.data.Ship.get(shipId);
            const position = formationSlotPosition(
                movement.position, movement.rotation, slot);
            const escort = makeNpcShip(shipData, 0, null, position,
                movement.rotation, new Vector(0, 0));
            escort.components.set(FormationComponent,
                { leader: leaderUuid, slot });
            // Fresh escorts start under the default escort command;
            // spawning here (on liftoff / system entry) IS the
            // "commands reset to formation" rule.
            escort.components.set(EscortCommandComponent,
                { command: 'formation' });
            // Hired escorts share the player's firing group so their shots
            // pass through the player (and vice versa via the owner-root
            // fallback) — same friendly-fire immunity as NPC fleets.
            escort.components.set(FiringGroupComponent,
                { group: leaderUuid });
            // Durable ownership from the first tick (the simulation's
            // MarkPlayerEscortsSystem would stamp this anyway, one tick
            // later, from the formation link).
            escort.components.set(PlayerEscortComponent,
                { player: leaderUuid, parent: leaderUuid });
            if (ownerUuid) {
                escort.components.set(MultiplayerData, { owner: ownerUuid });
            }
            await bridge.addEntity(v4(), escort);
            slot++;
        } catch (e) {
            console.warn(`Failed to spawn hired escort ${shipId}:`, e);
        }
    }
}

/**
 * Re-inserts escorts the simulation handed over (landed with the player, or
 * departed with them into hyperspace) at formation stations on their leader.
 *
 * Fresh uuids: a batch can be re-inserted into a brand new system world whose
 * id factory has restarted, so reusing the old bay-launch ids could collide
 * with a later launch. Intra-batch references (a fighter naming its carrier)
 * are remapped to the new uuids by prepareCarriedEscorts, and a fighter's own
 * identity is component-borne rather than uuid-borne, so re-minting is safe.
 */
async function insertCarriedEscorts(
    bridge: AsyncSimulationBridgeClient, displayWorld: World,
    leaderUuid: string, leader: Entity, escorts: CarriedEscort[],
    ownerUuid?: string, firstSlot?: number): Promise<void> {
    const base = firstSlot ?? nextClientSlot(displayWorld, leaderUuid);
    const prepared = prepareCarriedEscorts(escorts, leaderUuid, leader, base,
        v4, ownerUuid);
    noteSlotsUsed(leaderUuid, base + escorts.length);
    for (const { uuid, entity } of prepared) {
        try {
            await bridge.addEntity(uuid, entity);
        } catch (e) {
            console.warn(`Failed to re-insert carried escort ${uuid}:`, e);
        }
    }
}

/**
 * Takes the landed roster for `player`, dropping other peers' entries
 * (this client would never respawn them). No restock: the callers that
 * are a lift-off use `takeLandedEscortsRestocked`.
 */
function takeLandedEscorts(player: string): CarriedEscort[] {
    const taken = takeCarriedEscorts(landedEscorts, player);
    landedEscorts.length = 0;
    return taken;
}

/**
 * Takes the landed roster for `player` and hands it back refuelled and
 * rearmed: an escort that put down with its player leaves the pad with
 * full fuel and full magazines, free of charge (escort_restock.ts explains
 * why that differs from the player's own PAID refuel).
 *
 * ONLY THE LIFT-OFF PATHS USE THIS. The service is for escorts that
 * actually spent time at a port: the spaceport launch, the gate lift-off
 * that puts the player back in the system it docked from, and the late
 * flush that catches an escort which landed just after one of those. The
 * jump roster (carriedJumpEscorts) never gets it, and neither does
 * jumpTo's drain of the landed roster — a hypergate or wormhole transit
 * taken while docked AT the gate carries the landed escorts through to
 * another system, and passing through a gate is not a port visit. That
 * drain uses `takeLandedEscorts`.
 */
async function takeLandedEscortsRestocked(player: string):
    Promise<CarriedEscort[]> {
    const taken = takeLandedEscorts(player);
    await restockCarriedEscorts(taken, {
        getOutfit: id => simulationGameData.data.Outfit.get(id),
        getWeapon: id => simulationGameData.data.Weapon.get(id),
    });
    return taken;
}

/** The local player's ship uuid in a display world, if it is in flight. */
function localPlayerShipUuid(displayWorld: World): string | undefined {
    for (const [uuid, entity] of displayWorld.entities) {
        if (entity.components.has(PlayerShipSelector)) {
            return uuid;
        }
    }
    return undefined;
}

/**
 * Records that this client has handed out formation slots up to (but not
 * including) `next` for `player`. See clientSlotFloor.
 */
function noteSlotsUsed(player: string, next: number) {
    clientSlotFloor = clientSlotFloor?.player === player
        ? { player, next: Math.max(clientSlotFloor.next, next) }
        : { player, next };
}

/** The first slot a fresh insertion for `player` may use. */
function nextClientSlot(displayWorld: World, player: string): number {
    const floor = clientSlotFloor?.player === player
        ? clientSlotFloor.next : 0;
    return Math.max(nextFormationSlot(displayWorld, player), floor);
}

/**
 * Whether a carry event belongs to the LOCAL player, so other peers'
 * escorts are never added to this client's rosters (it would never respawn
 * them, and in a busy room the arrays would grow all session). While the
 * local player is out of the world — landed or mid-jump, which is exactly
 * when its own escorts are handed over — there is no local ship to compare
 * against, so an unattributable event is accepted and pruned at consume
 * time.
 */
function isLocalCarriedEscort(displayWorld: World, player: string): boolean {
    if (dockedShip?.uuid === player || pendingDockedShip?.uuid === player
        || gateDockedShip?.uuid === player || pendingGateShip?.uuid === player) {
        return true;
    }
    const local = localPlayerShipUuid(displayWorld);
    return local === undefined || local === player;
}

/**
 * Re-inserts any landed escorts that arrived AFTER the launch already
 * consumed the roster. An escort can slip into the landing window in the
 * very simulation step that applies the player's relaunch record, and it
 * must not be stranded out of the world (ownership is never lost by
 * landing and departing). Also drops other peers' entries, which this
 * client never respawns.
 */
async function flushLandedEscorts(bridge: AsyncSimulationBridgeClient,
    displayWorld: World): Promise<void> {
    const playerUuid = localPlayerShipUuid(displayWorld);
    if (!playerUuid) {
        return; // Not in flight yet; keep holding the roster.
    }
    const leader = displayWorld.entities.get(playerUuid);
    if (!leader) {
        return; // Keep the roster rather than dropping it on the floor.
    }
    const mine = await takeLandedEscortsRestocked(playerUuid);
    if (mine.length === 0) {
        return;
    }
    await insertCarriedEscorts(bridge, displayWorld, playerUuid, leader, mine,
        communicator.uuid ?? undefined);
}

/**
 * Puts down a batch that has been riding along with a multi-jump chain,
 * once the chain has settled (the player is in flight with no jump in
 * progress and no auto-continue pending — multiJumpChainSettled).
 *
 * Runs every frame the player is in flight and not docked, so it is also
 * the recovery path for a chain that ended early (route exhausted, fuel
 * out) and for the ordinary case of a batch that somehow outlived its
 * jumpTo. While the player is between simulations there is no display
 * entity to ask, so the batch is simply kept: dropping it is the one thing
 * that must never happen.
 */
async function flushCarriedJumpEscorts(bridge: AsyncSimulationBridgeClient,
    displayWorld: World): Promise<void> {
    const playerUuid = localPlayerShipUuid(displayWorld);
    if (!playerUuid) {
        return; // Mid-transition; keep holding the batch.
    }
    const leader = displayWorld.entities.get(playerUuid);
    if (!leader || !carriedBatchSettled(leader)) {
        // Still chaining, still being placed at the arrival gate, or
        // nothing to read: hold.
        return;
    }
    const mine = takeCarriedEscorts(carriedJumpEscorts, playerUuid);
    carriedJumpEscorts.length = 0;
    if (mine.length === 0) {
        return;
    }
    await insertCarriedEscorts(bridge, displayWorld, playerUuid, leader, mine,
        communicator.uuid ?? undefined);
}

/**
 * Mission special/aux ships entering with the player — the owning
 * client's half of the multiplayer design in mission_ship_plugin.ts.
 * `prepareMissionShips` must run BEFORE the player entity is encoded
 * into its own insertion record: it clears the stale mission-ship
 * rosters on the entity (so the cleared state rides that record) and
 * builds the ships whose spawn system matches. `insertMissionShips`
 * then pushes them through the same input-record addEntity path as
 * hired escorts, after the owner is in (the goal systems track ships
 * against their owner's mission state).
 */
async function prepareMissionShips(playerEntity: Entity, playerUuid: string,
    systemId: string, firstSlot: number): Promise<Entity[]> {
    try {
        const universe = MissionUniverse.shared(simulationGameData);
        await universe.load();
        return await buildMissionShipSpawns(playerEntity, playerUuid,
            systemId, simulationGameData, universe, firstSlot);
    } catch (e) {
        console.warn('Failed to prepare mission ships:', e);
        return [];
    }
}

async function insertMissionShips(bridge: AsyncSimulationBridgeClient,
    ships: Entity[], ownerUuid?: string): Promise<void> {
    for (const ship of ships) {
        try {
            if (ownerUuid) {
                // Like hired escorts: peer-owned so removePeer cleans
                // them up if this client vanishes.
                ship.components.set(MultiplayerData, { owner: ownerUuid });
            }
            await bridge.addEntity(v4(), ship);
        } catch (e) {
            console.warn('Failed to spawn mission ship:', e);
        }
    }
}

function getPlayerShipEntity(displayWorld: World): Entity | undefined {
    for (const entity of displayWorld.entities.values()) {
        if (entity.components.has(PlayerShipSelector)) {
            return entity;
        }
    }
    return undefined;
}

/**
 * The uuid the local player's escorts are filed under, wherever the player
 * currently is. It is the same uuid across a landing (dockedShip keeps the
 * ship's in-world uuid), which is exactly why the rosters can be keyed by
 * it while the player is out of the world.
 *
 * Undefined only in the narrow windows between states (mid-relaunch,
 * mid-jump). Callers must treat that as "don't know", never as "no
 * escorts": in multiplayer the rosters can hold other peers' entries, and
 * saving those would hand this pilot someone else's ships.
 */
function localPlayerUuid(): string | undefined {
    return dockedShip?.uuid ?? pendingDockedShip?.uuid
        ?? gateDockedShip?.uuid ?? pendingGateShip?.uuid
        ?? (displayWorld ? localPlayerShipUuid(displayWorld) : undefined);
}

/**
 * Every escort belonging to `player` that this client can still account
 * for, as the save wants them: the ones live in the system (in flight),
 * the landed roster held while docked, and any batch riding a jump. The
 * three are disjoint in practice but unioned by uuid anyway, because the
 * landing window overlaps them — an escort still flying to the planet is
 * in the world while its already-landed wingmates are on the roster.
 *
 * Sorted by uuid so a save's escort order does not depend on entity-map
 * iteration or on which roster an escort happened to be in.
 *
 * ESCORTS IN OTHER SYSTEMS ARE NOT HERE, by construction: this reads the
 * active system and the client's own rosters, and a ship left behind by
 * the zero-energy jump exclusion is in neither. See save_game.ts.
 */
function escortsToSave(player: string): EscortToSave[] {
    return collectEscortsToSave(player, displayWorld?.entities ?? [],
        [landedEscorts, carriedJumpEscorts]);
}

/**
 * The save payload for the local player right now: `entity` when given
 * (a venue's just-committed docked ship, see checkpoint_requests.ts),
 * else the player entity this client currently holds. A pure read of the
 * display world's player entity (which mirrors the simulation), so it's a
 * safe observer that never mutates sim state. Undefined if there's no
 * player ship yet (e.g. mid-jump) or nothing meaningful to persist.
 */
function buildSaveData(entity?: Entity): SaveData | undefined {
    if (!displayWorld || !activeSystemId) {
        return undefined;
    }
    // While docked the player entity is out of the display world; the
    // docked/relaunching entity carries the freshest state (mission
    // acceptances, payments, the advanced date).
    const playerShip = entity
        ?? pendingLaunchedShip
        ?? dockedShip?.entity
        ?? pendingDockedShip?.entity
        ?? getPlayerShipEntity(displayWorld);
    if (!playerShip) {
        return undefined;
    }
    const data = extractSaveData(playerShip, activeSystemId,
        controlBitResolver
            ? { resolver: controlBitResolver, parked: parkedControlBits }
            : undefined);
    if (!data) {
        return undefined;
    }
    // Escorts, as whole serialized entities. Needs the simulation's
    // serializer, which exists for as long as there is a system; if it
    // somehow doesn't, the rest of the save is still worth writing.
    // Likewise a player uuid: without one we cannot tell this pilot's
    // escorts from a peer's, and writing none beats writing someone
    // else's (the next save, ~10s later, has one).
    const player = localPlayerUuid();
    if (simulationSerializer && player) {
        const escorts = extractSavedEscorts(escortsToSave(player),
            simulationSerializer);
        // Left absent rather than written as `[]`, so an escortless
        // pilot's save stays exactly the payload a v1 build wrote.
        if (escorts.length > 0) {
            data.escorts = escorts;
            // The player's own uuid goes with them. Restoring re-mints
            // the player, and a fighter launched from the player's OWN
            // bays names it in OwnerComponent/SourceComponent; without
            // this the restored fighter chases a dead uuid and can never
            // dock (see SaveData.playerUuid).
            data.playerUuid = player;
        }
    }
    return data;
}

/**
 * Serializes the local player's current state to localStorage (see
 * buildSaveData). No-op with nothing to persist. In flight, also notices
 * state changes the SIMULATION made since the last checkpoint — a capture,
 * a mission accepted from a ship — and records a checkpoint for them.
 */
function saveNow() {
    const data = buildSaveData();
    if (!data) {
        return;
    }
    writeSave(data);
    noticeFlightChanges(data);
}

// ---------------------------------------------------------------------------
// Pilot-history checkpoints (title/pilot_history.ts).
// ---------------------------------------------------------------------------

/**
 * The save at the ACTIVE pilot's newest checkpoint, as this session last
 * saw it: the baseline the in-flight change detector compares against.
 * Loaded from the stored history on game entry, then tracked in memory
 * as checkpoints are recorded (so no history fold per periodic save).
 */
let lastCheckpointData: SaveData | undefined;

/** Seeds the in-flight change baseline from the stored history. */
function loadCheckpointBaseline() {
    const newest = latestState(loadHistory(getActiveSaveKey()));
    lastCheckpointData = newest === undefined
        ? undefined : decodeSave(JSON.stringify(newest));
}

/**
 * Records a checkpoint of the player's state for the active pilot: writes
 * the save from the requested entity (so save and checkpoint agree) and
 * appends the checkpoint to the pilot's history. Skipped when there is
 * nothing to snapshot (mid-jump, no player yet). Client-local; the sim is
 * never involved.
 */
function recordCheckpointNow(request: CheckpointRequest) {
    // Mid-jump the player is in no world and its escorts are on the jump
    // roster under no known player uuid; a snapshot then would silently
    // drop them, so wait for the next depart / periodic detection instead.
    if (!localPlayerUuid()) {
        return;
    }
    const data = buildSaveData(request.entity);
    if (!data) {
        return;
    }
    writeSave(data);
    let envelope: JsonValue;
    try {
        envelope = JSON.parse(encodeSave(data)) as JsonValue;
    } catch (e) {
        console.warn('Failed to encode the save for a checkpoint:', e);
        return;
    }
    const stellar = request.stellar
        ?? dockedShip?.planetId ?? pendingDockedShip?.planetId;
    try {
        recordCheckpoint(getActiveSaveKey(), envelope, {
            label: request.label,
            kind: request.kind,
            ...(data.date ? { date: { ...data.date } } : {}),
            ...(activeSystemId ? { system: activeSystemId } : {}),
            ...(stellar ? { stellar } : {}),
            at: Date.now(),
        });
        lastCheckpointData = data;
    } catch (e) {
        console.warn('Failed to record a checkpoint:', e);
    }
}

/**
 * The in-flight half of checkpoint recording: nothing landed announces a
 * boarding capture or a mission accepted from a ship in flight, so the
 * periodic save compares the ship type and mission set against the last
 * checkpoint and records one for whatever changed. Only IN FLIGHT: while
 * docked, the venues announce their own changes (and a just-bought ship
 * lives on a new entity the docked handle does not yet point at).
 */
function noticeFlightChanges(data: SaveData) {
    if (dockedShip || pendingDockedShip || pendingLaunchedShip
        || gateDockedShip || pendingGateShip || !lastCheckpointData) {
        return;
    }
    const universe = MissionUniverse.shared(simulationGameData);
    const changes = describeFlightChanges(lastCheckpointData, data, {
        shipName: id => simulationGameData.data.Ship.getCached(id)?.name
            ?.split(';')[0].trim(),
        missionName: id => {
            const name = universe.getMission(id)?.name;
            return name === undefined ? undefined : displayName(name);
        },
    });
    if (changes.length === 0) {
        return;
    }
    // One checkpoint for the batch; the first change names its kind.
    recordCheckpointNow({
        label: changes.map(c => c.label).join('; '),
        kind: changes[0].kind,
    });
}

let checkpointRecorderInstalled = false;

/** Subscribes the recorder to the landed UI's checkpoint requests. */
function installCheckpointRecorder() {
    if (checkpointRecorderInstalled) {
        return;
    }
    checkpointRecorderInstalled = true;
    checkpointRequests.subscribe(request => {
        try {
            recordCheckpointNow(request);
        } catch (e) {
            console.warn('Checkpoint request failed:', e);
        }
    });
}

let saveTriggersInstalled = false;
const SAVE_INTERVAL_MS = 10_000;

/**
 * Wires up when the game persists the player's state:
 * - periodically (every ~10s),
 * - when the page is being hidden or unloaded (pagehide / the tab going
 *   to the background), which are more reliable than beforeunload.
 * Landing at a spaceport also saves; that hook lives on each display
 * world's LeaveSpaceportEvent in jumpTo.
 */
function installSaveTriggers() {
    if (saveTriggersInstalled) {
        return;
    }
    saveTriggersInstalled = true;

    setInterval(saveNow, SAVE_INTERVAL_MS);

    // pagehide fires on navigation away / tab close and is far more
    // reliable than beforeunload (which browsers may skip).
    window.addEventListener('pagehide', saveNow);
    // Save whenever the tab is backgrounded: on mobile this is often the
    // last event before the page is discarded.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveNow();
        }
    });

    // Console-callable escape hatches.
    (window as any).novaSaveNow = saveNow;
    (window as any).novaResetSave = () => {
        resetSave();
        console.info('Cleared the saved game. Reload to start fresh.');
    };
}

async function makeDisplayWorld(systemId: string) {
    const displayWorld = new World(`${systemId} display`);
    displayWorld.resources.set(SimulationGameDataResource, simulationGameData);
    displayWorld.resources.set(DisplayAssetDataResource, displayAssetData);
    displayWorld.resources.set(PixiAppResource, app);
    displayWorld.resources.set(SystemIdResource, systemId);
    displayWorld.resources.set(ControlsSubject, controlsSubject);
    displayWorld.resources.set(CommunicatorResource, communicator);
    // The display world keeps its own wall-clock time for smooth
    // rendering. (The simulation runs on fixed, 0-based logical time,
    // which is no longer copied into the display world.)
    await displayWorld.addPlugin(TimePlugin);
    await displayWorld.addPlugin(Display);
    return displayWorld;
}

/**
 * Tears down the currently active system: detaches and closes the
 * simulation bridge (optionally removing an entity first so peers see it
 * vanish), unsubscribes the room forwarders, removes the display stage,
 * leaves the system room, drops the Display plugin, and clears the synced
 * entities. Shared by a system transition (jumpTo, which then joins the
 * next system) and by leaving the game entirely (exit-to-title).
 */
async function teardownActiveSystem(removeUuid?: string) {
    if (simulationBridge) {
        // Detach the bridge from the pump BEFORE tearing it down, so
        // no new pump frame starts a call against the dying worker. A
        // frame already awaiting one is unwedged by close(), which
        // settles every in-flight call with SimulationBridgeClosedError
        // (the pump treats that as "a transition took my bridge").
        const oldBridge = simulationBridge;
        simulationBridge = undefined;
        simulationPacing = undefined;
        if (removeUuid) {
            await oldBridge.removeEntity(removeUuid);
        }
        await oldBridge.close();
    }
    simulationWorker = undefined;
    for (const subscription of roomSubscriptions) {
        subscription.unsubscribe();
    }
    roomSubscriptions = [];
    if (activeSystemId) {
        const stage = displayWorld?.resources.get(Stage);
        if (stage) {
            app.stage.removeChild(stage);
        }
        multiRoom.leave(activeSystemId);
        if (displayWorld) {
            await displayWorld.removePlugin(Display);
        }
        for (const uuid of syncedComponents.keys()) {
            displayWorld?.entities.delete(uuid);
        }
        syncedComponents.clear();
    }
}

/**
 * Moves the player to another system: a hyperspace jump, a wormhole, or a
 * hypergate pick. Takes the escorts riding along out of the client's
 * rosters first, and — whatever happens — never drops them on the floor.
 *
 * The batch has to be taken BEFORE the teardown inside, but everything
 * after that point awaits a world build, a worker, and a room join, any of
 * which can reject. A local variable would take the batch with it, so a
 * failed transition hands it back to the carried roster instead, where the
 * standing flush picks it up as soon as there is a player ship to put it
 * beside. (The ship itself is the caller's problem: gate transits recover
 * through abortGateTransit.)
 */
async function jumpTo(args: { entity: Entity, to: string, uuid: string }) {
    // Take the escorts that left this system with the player BEFORE the
    // teardown drops the old system's state. Anything left over belongs to
    // another peer's player, whose own client carries it.
    //
    // A landed roster is taken along too rather than discarded: this path
    // also serves a hypergate/wormhole transit, where the player can dock
    // at the gate holding escorts that already left the simulation. They
    // ride to the destination instead of being lost.
    //
    // A gate transit's escorts arrive on the LANDED roster too (they are
    // swept at the gate, where no destination system exists to name yet —
    // see EscortFollowGateSystem), so this one take covers hyperspace
    // jumps, hypergates and wormholes alike.
    // NEITHER HALF IS RESTOCKED HERE. The service belongs to escorts that
    // visited a port, and a transit taken while docked AT a gate is not a
    // visit — the player never lifts off into the origin system. The
    // restock lives on the lift-off drains
    // (takeLandedEscortsRestocked). See takeEscortsForTransition.
    const { batch: jumpEscorts, fromLanded } = takeEscortsForTransition(
        carriedJumpEscorts, landedEscorts, args.uuid);
    try {
        await enterSystem(args, jumpEscorts);
    } catch (e) {
        // Never drop a single escort — but put each one back on the roster
        // it came from, so a landed escort keeps its landed bookkeeping
        // instead of being quietly reclassified as mid-jump.
        const back = restoreFailedTransitionBatch(jumpEscorts, fromLanded);
        landedEscorts.push(...back.landed);
        carriedJumpEscorts.push(...back.jumping);
        throw e;
    }
}

async function enterSystem({ entity, to, uuid }:
    { entity: Entity, to: string, uuid: string },
    jumpEscorts: CarriedEscort[]) {
    autopilot?.cancel();
    // A multi-jump chain (ModType 32) is about to auto-continue out of the
    // system we are arriving in. Hold the batch rather than inserting it
    // there: an insertion record that lands after the chain has moved on
    // would strand its escort. Read off the player's own entity, before it
    // is re-inserted and the destination world turns the budget into its
    // continue marker (see multiJumpChainContinues).
    // A GATE arrival is positioned by GateArrivalSystem on the first tick in
    // the destination world, so the entity still holds its ORIGIN station
    // here. Hold the batch exactly as a chained one is and let
    // flushCarriedJumpEscorts put it down once the marker clears — otherwise
    // the escorts take formation around where the player used to be instead
    // of around the gate they emerge from (see gateArrivalPending).
    const holdBatch = carriedBatchMustHold(entity);
    clientSlotFloor = undefined; // Fresh world, fresh slot run.
    document.body.classList.remove('nova-docked');
    pendingDockedShip = undefined;
    dockedShip = undefined;
    pendingLaunchedShip = undefined;
    pendingGateShip = undefined;
    gateDockedShip = undefined;
    pendingGateLaunch = undefined;
    syncedPlayerJumpRoute = undefined;
    await teardownActiveSystem(uuid);
    activeSystemId = to;

    const room = multiRoom.join(to);
    const serializerWorld = await makeSystem(to, simulationGameData, 'worker');
    const serializer = serializerWorld.resources.get(SerializerResource);
    if (!serializer) {
        throw new Error('Expected simulation serializer resource to exist');
    }
    simulationSerializer = serializer;
    // Test/driving lever (see visual_compare/driver.mjs, and the
    // window.nova* levers below): the simulation serializer's
    // componentsByName registry is the only in-page handle on the
    // synced-component singletons (e.g. the Boarding component), which the
    // headless harness needs to inject dialog state the way novaHailDialog
    // drives the comm dialog. Not used by gameplay.
    (window as any).novaSimSerializer = serializer;

    // A loaded save's escorts decode HERE, at the first moment in a
    // session that a serializer exists. They are pushed into this
    // transition's carried batch, which the insertion below already
    // handles — fresh uuids, intra-batch carrier remapping, formation
    // stations, commands reset to 'formation'. Pushing (rather than
    // reassigning) also means jumpTo's failure path hands them back to
    // carriedJumpEscorts with the rest, so a failed startup transition
    // cannot drop them.
    if (restoredSaveEscorts) {
        const blobs = restoredSaveEscorts;
        const priorPlayer = restoredSavePlayerUuid;
        restoredSaveEscorts = undefined; // One-shot: the startup jump.
        restoredSavePlayerUuid = undefined;
        const restored = restoreSavedEscorts(blobs, serializer);
        // `priorPlayer` rides each entry so a fighter the player had
        // launched from its own bays comes back pointing at the LIVE
        // player rather than the pre-save uuid. Absent in a save written
        // before the field existed, in which case nothing is remapped and
        // the behaviour is exactly what it was.
        jumpEscorts.push(...restored.map(escort => ({
            ...escort, player: uuid, priorPlayer,
        })));
        if (restored.length > 0) {
            console.info(`Restored ${restored.length} escort(s) from the `
                + `saved game.`);
        }
    }

    const worker = new Worker("/simulation_bridge_browser_worker_bundle.js", {
        type: "module",
    });
    const { host, client: newSimulationBridge } = makeBrowserSimulationBridgeClient(
        worker,
        serializer,
    );
    simulationWorker = worker;

    // Forward room traffic to the worker BEFORE init: init awaits
    // joinRoom, whose catch-up reply arrives on this channel. With the
    // subscription after init, every join's reply was dropped and the
    // world silently started at tick 0 in a room with real history
    // (the first desync's resync then papered over it). The worker
    // buffers anything that arrives before its communicator exists.
    roomSubscriptions = [
        room.messages.subscribe(({ source, message }) => {
            void host.receiveRoomMessage(source, message);
        }),
        room.peers.current.subscribe(peers => {
            void host.updateRoomState({ peers });
        }),
        room.connected.subscribe(connected => {
            void host.updateRoomState({ connected });
        }),
    ];

    await host.init(
        {
            systemId: to,
            roomState: {
                uuid: room.uuid,
                peers: room.peers.current.value,
                connected: room.connected.value,
                servers: room.servers.value,
            },
        },
        Comlink.proxy(async (message, destination) => {
            room.sendMessage(message, destination);
        }),
    );

    const initialFrame = await newSimulationBridge.snapshot();
    const newDisplayWorld = await makeDisplayWorld(to);
    if (pendingGateArrivalSpob) {
        // Announce the incoming gate arrival before the room join completes:
        // the event is queued and processed once this world starts stepping
        // (its planets are inserted by then), opening the destination gate
        // ahead of the ship's appearance.
        newDisplayWorld.emit(GateArrivalAnticipationEvent,
            { spob: pendingGateArrivalSpob });
        pendingGateArrivalSpob = undefined;
    }
    (window as any).simulationWorker = worker;
    (window as any).displayWorld = newDisplayWorld;
    // Debug switches (see debug_flags.ts): e.g. `debugFlags.tradeOverride`.
    (window as any).debugFlags = DEBUG_FLAGS;

    const newStage = newDisplayWorld.resources.get(Stage);
    if (!newStage) {
        throw new Error('World did not have Pixi Stage');
    }
    app.stage.addChild(newStage);
    newStage.visible = true;

    newDisplayWorld.events.get(LeaveSpaceportEvent).subscribe(({ data }) => {
        pendingLaunchedShip = data;
        document.body.classList.remove('nova-docked');
        // Departure is THE checkpoint (the original saved the pilot file
        // on every depart). The relaunching entity carries everything the
        // venues committed, including a ship bought at the shipyard.
        const planetId = dockedShip?.planetId;
        const planetName = planetId
            ? simulationGameData.data.Planet.getCached(planetId)?.name
            : undefined;
        recordCheckpointNow({
            label: `Departed ${planetName ?? 'the spaceport'}`,
            kind: 'depart',
            entity: data,
            ...(planetId ? { stellar: planetId } : {}),
        });
    });
    newDisplayWorld.events.get(AddEnemyEvent).subscribe(async ({ data }) => {
        const { shipId } = data;
        await simulationGameData.data.Ship.get(shipId);
        await newSimulationBridge.spawnNpc(shipId);
    });
    // Plunder/capture dialog buttons drive the sim through the control
    // input path: a single 'start' edge fires the edge-triggered boarding
    // action system (BoardingActionSystem) once, replayed on every peer.
    // Idempotency lives in the sim (per-action flags / capture state).
    newDisplayWorld.events.get(PlunderActionEvent).subscribe(({ data }) => {
        void newSimulationBridge.controlEvents([
            { action: data.action, state: 'start' }]);
    });
    // Debug-button cheats (status_bar.ts): forwarded on the same
    // control-event input path as the plunder actions, so the +credits /
    // clear-record edge fires DebugCheatSystem once, replayed on every
    // peer.
    newDisplayWorld.events.get(DebugActionEvent).subscribe(({ data }) => {
        void newSimulationBridge.controlEvents([
            { action: data.action, state: 'start' }]);
    });
    newDisplayWorld.events.get(SetJumpRouteEvent).subscribe(({ data }) => {
        syncedPlayerJumpRoute = data.route.slice();
        void newSimulationBridge.setPlayerJumpRoute(data.route);
    });
    // Hail dialog actions become deterministic input records: assist/bribe go
    // through bridge.hail. (The escort comm dialog is management-only and
    // issues no simulation effect — commanding escorts is the keyboard
    // escort-controls' job.)
    newDisplayWorld.events.get(HailRequestEvent).subscribe(({ data }) => {
        void newSimulationBridge.hail(data.action);
    });
    // A mission accepted from a përs ship in flight (mïsn AvailLoc 2).
    // The display resolved the whole acceptance against a detached copy
    // of the player and handed over the resulting record plus the raw
    // mission ships; the ships are ENCODED here, where the bridge's
    // serializer lives, and the pair goes out as ONE input record so the
    // mission and its ambush land on the same tick on every peer.
    newDisplayWorld.events.get(AcceptShipMissionEvent)
        .subscribe(({ data }) => {
            const serializer = newSimulationBridge.getSerializer();
            const record: AcceptedMission = data.ships.length > 0
                ? {
                    ...data.record,
                    ships: data.ships.map(ship => ({
                        uuid: v4(),
                        entity: serializer.encode(ship) as never,
                    })),
                }
                : data.record;
            void newSimulationBridge.acceptMission(record).catch(e => {
                console.warn('Failed to accept a ship-offered mission:', e);
            });
        });
    newDisplayWorld.events.get(LandEvent).subscribe(({ data, entities }) => {
        if (pendingDockedShip || dockedShip || pendingGateShip || gateDockedShip) {
            return;
        }
        // The planet's data is warm here (makeSystem loaded every planet in
        // this system before the world stepped).
        const landedPlanet = simulationGameData.data.Planet.getCached(data.id);
        // Landing on a WORMHOLE transits immediately: the sim handles the
        // whole transfer (GateDepartureSystem -> GateTransitEvent) and
        // nothing docks or opens here.
        if (landedPlanet?.gate?.kind === 'wormhole') {
            return;
        }
        const playerShipRef = entities?.[0];
        const playerShipUuid = typeof playerShipRef === "string" ? playerShipRef : playerShipRef?.uuid;
        const playerShip = playerShipUuid ? newDisplayWorld.entities.get(playerShipUuid) : undefined;
        if (!playerShipUuid || !playerShip || !playerShip.components.has(PlayerShipSelector)) {
            return;
        }
        // Landing on a HYPERGATE docks the ship (removed from the system like
        // a spaceport landing) and opens the hypergate map, where the player
        // picks one of the gate's linked neighbors (or lifts back off).
        if (landedPlanet?.gate?.kind === 'hypergate') {
            pendingGateShip = {
                uuid: playerShipUuid,
                entity: playerShip,
                planetId: data.id,
            };
            return;
        }
        pendingDockedShip = {
            uuid: playerShipUuid,
            entity: playerShip,
            planetId: data.id,
        };
        // Landing is a natural save point.
        saveNow();
    });
    // The player's escorts, handed over by the simulation as it deletes
    // them from this system. Collected synchronously here; the jumpTo /
    // launch that consumes them runs later (see carriedJumpEscorts and
    // flushLandedEscorts). Entries for other peers' players are dropped
    // when a batch is consumed — only the owning client respawns them.
    newDisplayWorld.events.get(EscortJumpEvent).subscribe(({ data }) => {
        if (!isLocalCarriedEscort(newDisplayWorld, data.player)) {
            return;
        }
        carriedJumpEscorts.push({
            player: data.player, uuid: data.uuid, entity: data.entity,
        });
    });
    newDisplayWorld.events.get(EscortLandedEvent).subscribe(({ data }) => {
        if (!isLocalCarriedEscort(newDisplayWorld, data.player)) {
            return;
        }
        landedEscorts.push({
            player: data.player, uuid: data.uuid, entity: data.entity,
        });
    });
    newDisplayWorld.events.get(FinishJumpEvent).subscribe(({ data }) => {
        // Every peer simulates every ship's jump; only follow it to
        // the new system if the jumping ship is the local player's.
        // (The event carries the ship, which the sim already removed
        // this frame, so the display entity cannot be consulted.)
        // Remote jumpers' departures need nothing from the display.
        if (!data.entity.components.has(PlayerShipSelector)) {
            return;
        }
        void (async () => {
            // A jump takes days (by ship mass, adjusted by any
            // "hyperspace speed mod" outfits); advance the player's
            // calendar while the entity is between simulations. The
            // date rides to peers with the re-added entity. The derived
            // ShipPhysicsComponent already sums the outfit mods; fall
            // back to the raw ship data if it isn't populated yet.
            try {
                const derived = data.entity.components
                    .get(ShipPhysicsComponent);
                let mass = derived?.mass;
                let speedMod = derived?.hyperspaceSpeedMod ?? 0;
                if (mass === undefined) {
                    const shipId = data.entity.components
                        .get(ShipComponent)?.id;
                    const physics = shipId
                        ? (await simulationGameData.data.Ship.get(shipId))
                            .physics
                        : undefined;
                    mass = physics?.mass ?? 100;
                    speedMod = physics?.hyperspaceSpeedMod ?? 0;
                }
                await advanceEntityDate(data.entity,
                    daysPerJump(mass, speedMod),
                    MissionUniverse.shared(simulationGameData),
                    simulationGameData);
            } catch (e) {
                console.warn('Failed to advance the date on jump:', e);
            }
            await jumpTo(data);
        })();
    });
    newDisplayWorld.events.get(GateTransitEvent).subscribe(({ data }) => {
        // Wormhole transit reuses the jump room-switch. Only the local
        // player follows it to the destination system (like a jump); the
        // sim already removed the carried ship this frame.
        if (!data.entity.components.has(PlayerShipSelector)) {
            return;
        }
        // A rejection here would leave the ship and its flock deleted with
        // nothing to put them back (the sim removed them as the transit
        // began), so failures land on the same return-to-the-gate recovery
        // as an unresolvable destination.
        void gateTransit(data).catch(e => {
            console.warn('Gate transit failed:', e);
            abortGateTransit(data, 'Gate transit failed.');
        });
    });
    newDisplayWorld.events.get(LeaveGateMapEvent).subscribe(({ data }) => {
        // The hypergate map closed. With a destination picked, ride the jump
        // room switch to it; otherwise lift back off from the origin gate.
        if (!gateDockedShip) {
            return;
        }
        const { ship, destinationSpob } = data;
        if (!destinationSpob) {
            pendingGateLaunch = ship;
            return;
        }
        const docked = gateDockedShip;
        void (async () => {
            const to = await gateDestinationResolver.systemOf(destinationSpob);
            if (!to) {
                console.warn(`Hypergate destination ${destinationSpob} is not `
                    + `in any system; lifting off instead.`);
                pendingGateLaunch = ship;
                return;
            }
            // The arrival marker rides the re-insertion input record to every
            // peer; GateArrivalSystem in the destination world positions the
            // ship flying out of the arrival gate. The emergence angle is
            // null so the DESTINATION gate's own CustSndID (read there)
            // decides the fly-out direction; randomDraw backs it up when
            // that angle says "random".
            ship.components.set(GateArrivalComponent, {
                destinationSpob,
                emergenceAngle: null,
                randomDraw: Math.random(),
            });
            pendingGateArrivalSpob = destinationSpob;
            await jumpTo({ entity: ship, to, uuid: docked.uuid });
        })();
    });

    // Wait until the current peer set includes the server, without racing
    // between an immediate state check and a later join event subscription.
    await firstValueFrom(room.peers.current.pipe(filter(peers => peers.has('server'))));
    // Mission ships whose spawn system this is (or that follow the
    // player) jump in with the player. Prepared before the player
    // entity is encoded into its insertion record.
    const missionShips = entity.components.has(PlayerShipSelector)
        ? await prepareMissionShips(entity, uuid, to,
            holdBatch ? 0 : jumpEscorts.length) : [];
    // A gate/wormhole arrival reconciles the pinned route with where the
    // player actually is (a hyperspace arrival's route is already right —
    // beginJump shifted it at jump start; see reconcileRouteOnArrival).
    // The entity carries a GateArrivalComponent exactly when it came by
    // gate. Mutating the held entity BEFORE it is encoded into its
    // insertion record keeps this on the owner-driven input path.
    reconcileRouteOnArrival(entity, to,
        entity.components.has(GateArrivalComponent) ? 'gate' : 'jump');
    await newSimulationBridge.addEntity(uuid, entity);
    if (entity.components.has(PlayerShipSelector)) {
        (window as any).myShip = entity;
    }
    // Escorts that followed the player through hyperspace, inserted at
    // formation stations around the arrival point and coasting in at the
    // player's arrival velocity. Instant carry with no warp-in animation of
    // their own (documented v1 seam): the escorts simply appear with the
    // player. Their commands are reset to formation by
    // prepareCarriedEscorts, which also keeps any carrier-and-wing
    // relationships inside the batch intact.
    if (jumpEscorts.length > 0) {
        if (holdBatch) {
            // Another hop is coming, or the player has not been placed at
            // its arrival gate yet: the batch waits rather than being put
            // down here. The next jumpTo takes it straight back out of
            // this array (same player uuid), and flushCarriedJumpEscorts
            // puts it down once the chain ends / the gate exit is known.
            carriedJumpEscorts.push(...jumpEscorts);
        } else {
            await insertCarriedEscorts(newSimulationBridge, newDisplayWorld,
                uuid, entity, jumpEscorts, communicator.uuid ?? undefined);
        }
    }
    await insertMissionShips(newSimulationBridge, missionShips,
        communicator.uuid ?? undefined);
    // The new bridge starts from a fresh delta stream, so drop any
    // bookkeeping from the previous system's sync.
    syncedComponents.clear();
    warnedUnsyncableEntities.clear();
    applySimulationFrame(initialFrame, serializer, newDisplayWorld);
    syncedPlayerJumpRoute = getDisplayPlayerJumpRoute(newDisplayWorld)?.slice();
    simulationBridge = newSimulationBridge;
    displayWorld = newDisplayWorld;
    // Debug toggles, e.g. novaDebug.showCollisionShapes = true. Settings
    // carry over when jumping rebuilds the display world.
    (window as any).novaDebug =
        new DebugSettings(newDisplayWorld, (window as any).novaDebug);
}

/**
 * Puts a ship back into the system it just tried to leave through a gate,
 * after the transit turned out to have nowhere to go.
 *
 * By the time we get here the SIM HAS ALREADY REMOVED the ship
 * (GateDepartureSystem deletes it and hands it over on the GateTransitEvent),
 * and EscortFollowGateSystem has already handed over the flock with it, so
 * simply returning would delete the player's ship and every escort from the
 * game — the "staying put" this used to claim was never true.
 *
 * Recovery reuses the hypergate lift-off machinery rather than re-adding the
 * ship by hand: setting the docked/launch pair makes the pump's
 * `pendingGateLaunch && gateDockedShip` block re-add the ship at the gate,
 * re-insert the landed roster (which is where the swept flock is waiting),
 * and respawn mission ships, with the slot bookkeeping already right. That
 * is exactly the path a player takes when they open a hypergate map and
 * close it without picking anything.
 */
function abortGateTransit(
    data: { entity: Entity, uuid: string, fromSpob: string }, reason: string) {
    console.warn(`${reason} Returning the ship to the origin gate.`);
    data.entity.components.delete(GateArrivalComponent);
    gateDockedShip = {
        uuid: data.uuid, entity: data.entity, planetId: data.fromSpob,
    };
    pendingGateLaunch = data.entity;
}

/**
 * Follows a hypergate/wormhole transit to its destination system. The sim
 * already chose the exit spöb (or a random draw for a link-less wormhole) and
 * tagged the ship with a GateArrivalComponent; here we resolve that spöb to its
 * containing system, patch a random wormhole's exit onto the arrival marker,
 * and reuse the jump room-switch to move the player there. GateArrivalSystem in
 * the destination world then teleports the ship to the arrival gate.
 */
async function gateTransit(data: {
    entity: Entity, uuid: string, fromSpob: string, destinationSpob: string | null,
}) {
    const arrival = data.entity.components.get(GateArrivalComponent);
    let destinationSpob = data.destinationSpob;
    if (!destinationSpob) {
        // Random wormhole: resolve the exit from the full link-less-wormhole
        // list using the sim's replicated random draw.
        destinationSpob = (await gateDestinationResolver.randomWormholeExit(
            data.fromSpob, arrival?.randomDraw ?? 0)) ?? null;
        if (arrival && destinationSpob) {
            // Record the resolved exit so GateArrivalSystem can position the
            // ship at it in the destination world.
            data.entity.components.set(GateArrivalComponent, {
                ...arrival,
                destinationSpob,
            });
        }
    }
    if (!destinationSpob) {
        abortGateTransit(data, `Gate transit from ${data.fromSpob} had no `
            + `resolvable destination.`);
        return;
    }
    const to = await gateDestinationResolver.systemOf(destinationSpob);
    if (!to) {
        abortGateTransit(data, `Gate destination spöb ${destinationSpob} is `
            + `not in any system.`);
        return;
    }
    pendingGateArrivalSpob = destinationSpob;
    await jumpTo({ entity: data.entity, to, uuid: data.uuid });
}

async function startGame() {
    world = new World();
    world.resources.set(SimulationGameDataResource, simulationGameData);
    await world.addPlugin(multiplayer(multiRoom.join('main room')));
    world.resources.set(MultiRoomResource, multiRoom);
    await world.addPlugin(NovaPlugin);
    const controlsJson = await simulationGameData.getSettings?.('controls.json');
    if (!controlsJson) {
        throw new Error("Expected controls settings to exist");
    }
    // Layer the ACTIVE PILOT's "Set Prefs" rebindings (stored in the pilot
    // registry; the served controls.json is read-only) over the defaults
    // before decoding.
    controls = buildControls(controlsJson as Record<string, unknown>);

    // Make the player's ship
    while (!communicator.uuid) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    const ids = await simulationGameData.ids;
    const query = new URLSearchParams(window.location.search);
    // How this server namespaced the plug-ins' control bits: needed to
    // read a save's (namespace, bit) pairs and to write them.
    controlBitResolver = new ControlBitResolver(
        await simulationGameData.controlBitNamespaces);
    parkedControlBits = [];

    // ?reset wipes the save before we read it, so a bad session can be
    // recovered by adding &reset to the URL.
    if (query.has('reset')) {
        resetSave();
        clearPilotProfile();
        console.info('Cleared the saved game (?reset).');
    }

    // The saved game (if any) provides defaults; explicit URL params
    // override it. A corrupt or old-version save is quarantined by
    // loadSave and we fall back to defaults.
    const save = loadSave();
    // The pilot's checkpoint history: baseline for the in-flight change
    // detector, and the recorder for the landed venues' requests.
    loadCheckpointBaseline();
    installCheckpointRecorder();
    // Hand the saved escorts to the first system entry, which is the only
    // place with a serializer to decode them (see restoredSaveEscorts).
    // Deliberately NOT gated on `usingSavedShip`: escorts are ships of
    // their own and belong to the pilot, not to the hull they were flying
    // beside, so a ?ship= override keeps them.
    restoredSaveEscorts = save?.escorts;
    restoredSavePlayerUuid = save?.playerUuid;

    // A fresh pilot starts from a chär "player start": ship, credits,
    // date, systems, and its OnStart control bits. ?char=nova:129
    // picks one; otherwise the scenario's default.
    let playerStart;
    try {
        const requestedChar = query.get('char');
        if (ids.PlayerStart.length > 0) {
            const starts = await Promise.all(ids.PlayerStart.map(
                id => simulationGameData.data.PlayerStart.get(id)));
            playerStart = (requestedChar
                && starts.find(s => s.id === requestedChar))
                || starts.find(s => s.isDefault)
                || starts[0];
        }
    } catch (e) {
        console.warn('Failed to load player starts:', e);
    }

    // ?ship=nova:164 picks the player's ship; otherwise the saved ship,
    // otherwise the chär's starting ship, otherwise a random one.
    const requestedShip = query.get('ship');
    const savedShipValid = save && ids.Ship.includes(save.ship);
    const startShipValid =
        playerStart && ids.Ship.includes(playerStart.ship);
    let shipId = savedShipValid
        ? save!.ship
        : startShipValid
            ? playerStart!.ship
            : ids.Ship[Math.floor(Math.random() * ids.Ship.length)];
    // Only restore outfits when we actually use the saved ship: outfits
    // belong to a specific ship type.
    let usingSavedShip = savedShipValid;
    if (requestedShip) {
        if (ids.Ship.includes(requestedShip)) {
            shipId = requestedShip;
            usingSavedShip = save?.ship === requestedShip;
        } else {
            console.warn(`Unknown ship id '${requestedShip}'. Using ${shipId}.`);
        }
    }
    const shipData = await simulationGameData.data.Ship.get(shipId);
    const shipEntity = makeShip(shipData);
    // Restore owned outfits onto the ship. The staging derivers skip a
    // component that is already present, so setting OutfitsStateComponent
    // here preserves the saved loadout instead of the ship's stock one.
    if (usingSavedShip && save && save.outfits.length > 0) {
        shipEntity.components.set(OutfitsStateComponent,
            new Map(save.outfits.map(([id, count]) => [id, { count }])));
    }
    shipEntity.components.set(MultiplayerData, {
        owner: communicator.uuid
    });
    shipEntity.components.set(PlayerShipSelector, undefined);
    shipEntity.components.set(ControlledByComponent, { peerId: communicator.uuid });

    // Player state: restore it from the save, or start a fresh pilot
    // from the chär (credits, date, OnStart control bits, starting
    // legal statuses and combat rating).
    if (save) {
        parkedControlBits = restorePlayerState(shipEntity, save,
            controlBitResolver).parkedControlBits;
    } else if (playerStart) {
        // chär Govt1-4/Status1-4: the status applies to the govt and
        // its allies, negated for its enemies (reputation.ts). The
        // pilot-file importer extracts the same shape, so a future
        // pilot import lands here too.
        try {
            const govtIds = [...ids.Govt].sort();
            const allGovts = await Promise.all(govtIds.map(async id =>
                [id, await simulationGameData.data.Govt.get(id)] as const));
            shipEntity.components.set(LegalRecordsComponent,
                initialRecordsFromGovtStatuses(
                    playerStart.govtStatuses, allGovts));
        } catch (e) {
            console.warn('Failed to set starting legal records:', e);
        }
        shipEntity.components.set(CombatRatingComponent,
            { kills: Math.max(0, playerStart.combatRating) });
        shipEntity.components.set(GameDateComponent,
            { ...playerStart.date });
        shipEntity.components.set(CreditsComponent,
            { credits: playerStart.credits });
        const bits = new Set<number>();
        const startRanks = new Set<string>();
        try {
            // New-pilot setup is player-local; plain randomness is
            // fine for R(a b) here (see the outfitter's runSetString).
            // A chär OnStart may grant a rank (Kxxx); the cascades need
            // rank data, which is fetched on demand from the cache.
            runNCBSet(playerStart.onStart,
                makeControlBitHooks(bits, undefined, {
                    active: startRanks,
                    resolveId: id => `${playerStart.prefix}:${id}`,
                    getRank: id => simulationGameData.data.Rank.getCached(id),
                }), Math.random);
        } catch (e) {
            if (e instanceof NCBParseError) {
                console.warn('Bad chär OnStart string:', e);
            } else {
                throw e;
            }
        }
        shipEntity.components.set(ControlBitsComponent, bits);
        shipEntity.components.set(ActiveRanksComponent, startRanks);
    }
    ensurePlayerStateComponents(shipEntity);
    (window as any).myShip = shipEntity;

    // ?system=nova:131 picks the starting system; otherwise the saved
    // system, otherwise the chär's start system, otherwise the default.
    const requestedSystem = query.get('system');
    const startSystems = playerStart?.systems.filter(
        id => ids.System.includes(id)) ?? [];
    let systemId = (save && ids.System.includes(save.system))
        ? save.system
        : startSystems.length > 0
            ? startSystems[Math.floor(Math.random() * startSystems.length)]
            : 'nova:130';
    if (requestedSystem) {
        if (ids.System.includes(requestedSystem)) {
            systemId = requestedSystem;
        } else {
            console.warn(`Unknown system id '${requestedSystem}'. Using ${systemId}.`);
        }
    }

    await jumpTo({
        entity: shipEntity,
        to: systemId,
        uuid: v4(),
    });

    // Warm the mission/cron/planet caches in the background so the
    // first landing or jump doesn't stall on them. Deliberately after
    // the initial join: these ~2000 fetches share Chrome's per-host
    // connection pool with the world-load fetches above.
    void MissionUniverse.shared(simulationGameData).load().catch(e => {
        console.warn('Failed to preload mission data:', e);
    });

    installSaveTriggers();

    // if (activeSystem) {
    //     await activeSystem.addPlugin(Display);

    //     const systemStage = activeSystem.resources.get(Stage);
    //     if (!systemStage) {
    //         throw new Error('World did not have Pixi Container');
    //     }
    //     app.stage.addChild(systemStage);
    //     systemStage.visible = true;
    // }

    // system.events.get(FinishJumpEvent).subscribe(
    // ({ entity, to, uuid }) => {

    //     const destination = systems.get(to) ?? system;
    //     destination.entities.set(uuid, entity);
    // });



    // Set active system when the player ship is added    
    // for (const [systemId, system] of systems) {
    //     system.events.get(AddEvent).subscribe(([, entity]) => {
    //         //console.log('hi');
    //         if (entity.components.has(PlayerShipSelector) &&
    //             system !== activeSystem) {
    //             console.log(`Player ship is in ${systemId}`);
    //             const systemStage = activeSystem?.resources.get(Stage);
    //             if (systemStage) {
    //                 app.stage.removeChild(systemStage);
    //             }

    //             activeSystem?.removePlugin(Display);
    //             activeSystem = system;
    //             activeSystem.addPlugin(Display);

    //             const newSystemStage = activeSystem?.resources.get(Stage);

    //             if (!newSystemStage) {
    //                 throw new Error('World did not have Pixi Container');
    //             }
    //             app.stage.addChild(newSystemStage);
    //         }
    //     });
    // }
    // console.log('Got past for loop');

    (window as any).world = world;

    function resize() {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        displayWorld?.emit(ResizeEvent, { x: window.innerWidth, y: window.innerHeight });
    }
    window.onresize = resize;

    const stats = new Stats();
    document.body.appendChild(stats.dom);
    sessionDisposers.push(() => stats.dom.remove());

    //(window as any).novaDebug = new DebugSettings(activeSystem);

    function emitControlEvents(controlEvents: ControlEvent[]) {
        if (controlEvents.length === 0) {
            return;
        }
        displayWorld?.emit(EcsControlEvent, controlEvents);
        for (const controlEvent of controlEvents) {
            controlsSubject.next(controlEvent);
        }
        void simulationBridge?.controlEvents(controlEvents);
    }

    const controlSinks: ControlSinks = {
        controlEvents: emitControlEvents,
        analogControl(control: AnalogControlState) {
            void simulationBridge?.analogControl(control);
        },
    };
    autopilot = new Autopilot(controlSinks);
    const localAutopilot = autopilot;
    // Console lever for tests/debugging (novaAutopilot.destination etc.).
    (window as any).novaAutopilot = autopilot;
    // Console lever for tests/debugging: inject control events directly
    // (bypassing the keyboard), e.g.
    //   novaControls.send([{action: 'nearestTarget', state: 'start'}])
    // followed by the matching {state: false} release.
    (window as any).novaControls = { send: emitControlEvents };
    // Console lever for tests/debugging: hire escorts onto the player
    // through the SAME spawn path the bar's hire flow uses (formation
    // slots, firing group, default escort command), without the
    // landing UI — e.g. novaSpawnEscorts(['nova:133', 'nova:133']).
    (window as any).novaSpawnEscorts = async (shipIds: string[]) => {
        if (!simulationBridge || !displayWorld) {
            throw new Error('No live system');
        }
        let playerUuid: string | undefined;
        let player: Entity | undefined;
        for (const [uuid, entity] of displayWorld.entities) {
            if (entity.components.has(PlayerShipSelector)) {
                playerUuid = uuid;
                player = entity;
            }
        }
        if (!playerUuid || !player) {
            throw new Error('No player ship');
        }
        await spawnHiredEscorts(simulationBridge, displayWorld, playerUuid,
            player, shipIds, communicator.uuid ?? undefined);
    };
    // Console lever for tests/debugging: what the client is currently
    // holding for its escorts (see spaceport/landed_escorts.ts). `landed`
    // is the roster held while docked or swept at a gate; `jumping` is the
    // batch waiting for the destination system's world to be built — or
    // riding out a multi-jump chain.
    (window as any).novaEscortRosters = () => ({
        landed: landedEscorts.map(({ player, uuid }) => ({ player, uuid })),
        jumping: carriedJumpEscorts.map(({ player, uuid }) => ({
            player, uuid,
        })),
    });
    /**
     * Console lever: the same-system convergence invariant, live.
     *
     * Called with no argument it is a REPORT — where the local player's
     * escorts are right now, split into the ones in the system with them
     * and the ones the client is holding for them. Called with a list of
     * uuids it is a CHECK: those are the escorts the caller knows the
     * player owns, and `stranded` is the ones that are in neither place,
     * which must be empty. A headless harness that knows what it spawned
     * (see visual_compare/driver.mjs) is the caller that can supply real
     * ground truth; the client itself cannot, because an escort it has
     * lost track of is exactly the thing it cannot enumerate.
     */
    (window as any).novaEscortAudit = (expected?: string[]) => {
        const current = displayWorld;
        if (!current) {
            return null;
        }
        const playerUuid = localPlayerShipUuid(current);
        if (!playerUuid) {
            return null;
        }
        const inWorld: string[] = [];
        for (const [entityUuid, entity] of current.entities) {
            if (entity.components.get(PlayerEscortComponent)?.player
                === playerUuid) {
                inWorld.push(entityUuid);
            }
        }
        const rosters = [landedEscorts, carriedJumpEscorts];
        const known = expected ?? [...inWorld, ...rosters.flatMap(roster =>
            roster.filter(({ player }) => player === playerUuid)
                .map(({ uuid }) => uuid))];
        return escortsAccountedFor(playerUuid, known, inWorld, rosters);
    };

    // User movement input cancels the autopilot (the autopilot's own
    // inputs go through controlSinks directly and don't loop back
    // here). Firing and targeting deliberately don't cancel, so the
    // player can defend themselves on the way to a planet.
    const movementActions = new Set<string>(['accelerate', 'turnLeft',
        'turnRight', 'reverse', 'pointTo', 'land', 'hyperjump',
        'afterburner', 'board']);

    function handleControlEvent(event: KeyboardEvent) {
        if (!controls) {
            return;
        }
        // A focused text-entry surface (the starmap Find dialog, the
        // quantity dialog, an HTML input overlay, ...) owns the keyboard:
        // generate no game control PRESSES at all, so typing can't fire
        // hotkeys (digits selecting stellar bodies, 'd' departing, 'm'
        // opening the map). Releases still flow (like the overlay case
        // below) so a control held when the field opened can't stay stuck
        // on. Determinism-safe: dropped presses are never recorded as
        // inputs, so no peer is affected.
        if (isTextEntryActive() && event.type !== 'keyup') {
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
        }
        const actions = getActions(controls, event);
        const controlEvents: ControlEvent[] = actions.map(action => ({
            action,
            state: event.type === 'keyup' ? false : event.repeat ? 'repeat' : 'start',
        }));
        // A modal overlay (starmap, gate map, player info, spaceport menus)
        // owns the keyboard while it holds focus: its own control bindings
        // still fire (via controlsSubject), but the same keys must NOT also
        // drive the ship in the sim underneath — otherwise Tab cycles the
        // ship target while it cycles the map's jump route, Space fires the
        // primary weapon, and the arrows turn the ship. Route presses to the
        // menu layer (and display-only handlers) only.
        //
        // Key RELEASES are the exception: they still reach the sim, so a
        // control held down when the overlay opened (e.g. accelerate) doesn't
        // stay stuck on after the overlay closes.
        if (MenuControls.focused && event.type !== 'keyup') {
            if (controlEvents.length === 0) {
                return;
            }
            displayWorld?.emit(EcsControlEvent, controlEvents);
            for (const controlEvent of controlEvents) {
                controlsSubject.next(controlEvent);
            }
            return;
        }
        if (actions.some(action => movementActions.has(action))) {
            localAutopilot.cancel();
        }
        emitControlEvents(controlEvents);
    }
    document.addEventListener('keydown', handleControlEvent);
    document.addEventListener('keyup', handleControlEvent);
    sessionDisposers.push(() => {
        document.removeEventListener('keydown', handleControlEvent);
        document.removeEventListener('keyup', handleControlEvent);
    });

    // Like tap targeting: the on-screen touch controls live on the
    // persistent body and drive live module state, so install them once.
    if (wantsTouchControls() && !touchControlsInstalled) {
        touchControlsInstalled = true;
        installTouchControls({
            sinks: controlSinks,
            onMovementInput: () => autopilot?.cancel(),
        });
    }

    // Tap or click on a ship to target it; on a planet to autopilot
    // there and land. Installed once on the persistent canvas (never torn
    // down): it reads the live world / bridge / autopilot through module
    // state, so it keeps working across re-entries without stacking
    // duplicate listeners.
    if (!tapTargetingInstalled) {
        tapTargetingInstalled = true;
        installTapTargeting(app.view as unknown as HTMLElement, {
            getWorld: () => displayWorld,
            getMyPeerId: () => communicator.uuid ?? undefined,
            targetShip: uuid => void simulationBridge?.setTarget(uuid),
            navigateToPlanet: uuid => {
                // Select the stellar (so the land handshake acts on THIS
                // planet even if another was already picked, and the nav
                // readout lights up immediately), then autopilot to it.
                void simulationBridge?.setPlanetTarget(uuid);
                autopilot?.navigateTo(uuid);
            },
            // A click on the map, a dialog, a button or the status bar is
            // NOT a click on space: while a modal menu owns the keyboard,
            // or when PIXI's hit test finds an interactive UI object under
            // the pointer (only UI is interactive; ships/planets are
            // picked by distance above), the tap stops here instead of
            // targeting/landing on whatever is drawn underneath.
            isBlocked: (x, y) => MenuControls.focused !== undefined
                || app.renderer.events.rootBoundary.hitTest(x, y) !== null,
        });
    }

    async function pumpSimulationFrame() {
        if (simulationTickInFlight) {
            return;
        }
        if (!simulationBridge || !displayWorld || !simulationSerializer) {
            return;
        }
        simulationTickInFlight = true;
        stats.begin();
        const currentBridge = simulationBridge;
        const currentDisplayWorld = displayWorld;
        const currentSerializer = simulationSerializer;
        try {
            world.step();
            localAutopilot.step(displayWorld, communicator.uuid ?? undefined);
            if (pendingDockedShip && !dockedShip) {
                await currentBridge.removeEntity(pendingDockedShip.uuid);
                clearTargetsOnLanding(pendingDockedShip.entity);
                currentDisplayWorld.emit(OpenSpaceportEvent, {
                    planetId: pendingDockedShip.planetId,
                    ship: pendingDockedShip.entity,
                    // The ship has just been pulled out of the world,
                    // but things it launched (bay fighters) still point
                    // at this uuid, so the outfitter can find them.
                    uuid: pendingDockedShip.uuid,
                    // Live getter, not a snapshot: fighters keep landing
                    // into the roster while the player shops, and each
                    // one still counts against the outfitter's buy caps.
                    landedEscorts: () => landedEscorts,
                });
                // Hide the touch controls under the spaceport UI.
                document.body.classList.add('nova-docked');
                dockedShip = pendingDockedShip;
                pendingDockedShip = undefined;
            }
            if (pendingLaunchedShip && dockedShip) {
                // A ship bought at the shipyard is a fresh entity: it
                // must carry the multiplayer identity or no peer's
                // inputs steer it (and removePeer never cleans it up).
                if (communicator.uuid) {
                    pendingLaunchedShip.components.set(ControlledByComponent,
                        { peerId: communicator.uuid });
                    pendingLaunchedShip.components.set(MultiplayerData,
                        { owner: communicator.uuid });
                }
                // Escorts hired in the bar spawn alongside the
                // relaunched player ship. The pending list is
                // display-side bookkeeping; pop it before the entity
                // is encoded into the addEntity input record.
                const pendingEscorts =
                    pendingLaunchedShip.components.get(PendingEscortsComponent);
                pendingLaunchedShip.components.delete(PendingEscortsComponent);
                // Escorts that landed with the player take off with them,
                // still carrying their damage, outfits, and (for deployed
                // bay fighters) their bay identity. Escorts that never made
                // it down are re-attached in the simulation instead
                // (EscortReattachSystem).
                const returningEscorts =
                    await takeLandedEscortsRestocked(dockedShip.uuid);
                // One slot run across all three batches inserted by this
                // launch: the display world does not see any of them until a
                // later frame, so each batch must be told where to start.
                const launchBaseSlot =
                    nextClientSlot(currentDisplayWorld, dockedShip.uuid);
                const hireBaseSlot = launchBaseSlot + returningEscorts.length;
                // Mission ships spawn alongside the relaunch; prepared
                // before the player entity is encoded (see
                // prepareMissionShips), inserted after it.
                const missionShips = await prepareMissionShips(
                    pendingLaunchedShip, dockedShip.uuid,
                    activeSystemId ?? '',
                    hireBaseSlot + (pendingEscorts?.length ?? 0));
                await currentBridge.addEntity(dockedShip.uuid, pendingLaunchedShip);
                if (returningEscorts.length > 0) {
                    await insertCarriedEscorts(currentBridge,
                        currentDisplayWorld, dockedShip.uuid,
                        pendingLaunchedShip, returningEscorts,
                        communicator.uuid ?? undefined, launchBaseSlot);
                }
                if (pendingEscorts && pendingEscorts.length > 0) {
                    await spawnHiredEscorts(currentBridge,
                        currentDisplayWorld, dockedShip.uuid,
                        pendingLaunchedShip, pendingEscorts,
                        communicator.uuid ?? undefined, hireBaseSlot);
                }
                await insertMissionShips(currentBridge, missionShips,
                    communicator.uuid ?? undefined);
                if (pendingLaunchedShip.components.has(PlayerShipSelector)) {
                    (window as any).myShip = pendingLaunchedShip;
                }
                dockedShip = undefined;
                pendingLaunchedShip = undefined;
            }
            // Hypergate docking, mirroring the spaceport dock above: remove
            // the landed ship from the sim and open the hypergate map.
            if (pendingGateShip && !gateDockedShip) {
                await currentBridge.removeEntity(pendingGateShip.uuid);
                // Docking at a gate drops the target too — same rule, and
                // the ship either transits (new world) or lifts back off.
                clearTargetsOnLanding(pendingGateShip.entity);
                currentDisplayWorld.emit(OpenGateMapEvent, {
                    gateSpob: pendingGateShip.planetId,
                    systemId: activeSystemId ?? '',
                    ship: pendingGateShip.entity,
                });
                gateDockedShip = pendingGateShip;
                pendingGateShip = undefined;
            }
            // The map closed without a destination: lift back off from the
            // gate into the origin system (nothing strands the ship).
            if (pendingGateLaunch && gateDockedShip) {
                // Any escorts that had already landed also lift off here,
                // exactly as at a spaceport — otherwise a roster captured
                // before the gate dock would be stranded out of the world.
                const gateEscorts =
                    await takeLandedEscortsRestocked(gateDockedShip.uuid);
                const gateBaseSlot = nextClientSlot(
                    currentDisplayWorld, gateDockedShip.uuid);
                // Mission ships despawned while gate-docked; respawn
                // them with the lift-off (same shape as the spaceport
                // launch above).
                const gateMissionShips = await prepareMissionShips(
                    pendingGateLaunch, gateDockedShip.uuid,
                    activeSystemId ?? '',
                    gateBaseSlot + gateEscorts.length);
                await currentBridge.addEntity(
                    gateDockedShip.uuid, pendingGateLaunch);
                if (gateEscorts.length > 0) {
                    await insertCarriedEscorts(currentBridge,
                        currentDisplayWorld, gateDockedShip.uuid,
                        pendingGateLaunch, gateEscorts,
                        communicator.uuid ?? undefined, gateBaseSlot);
                }
                await insertMissionShips(currentBridge, gateMissionShips,
                    communicator.uuid ?? undefined);
                if (pendingGateLaunch.components.has(PlayerShipSelector)) {
                    (window as any).myShip = pendingGateLaunch;
                }
                gateDockedShip = undefined;
                pendingGateLaunch = undefined;
            }
            // A landed escort whose capture arrived after the launch
            // already consumed the roster (it slipped into the landing
            // window in the very step that relaunched the player) still
            // gets put back beside its player. Only runs in flight.
            if (landedEscorts.length > 0 && !pendingDockedShip && !dockedShip
                && !pendingGateShip && !gateDockedShip) {
                await flushLandedEscorts(currentBridge, currentDisplayWorld);
            }
            // A batch riding out a multi-jump chain is put back down once
            // the chain settles. Same in-flight, not-docked guard: the
            // dock/launch blocks above have already run this frame, so a
            // player who is on their way into a spaceport or a gate map
            // keeps holding until they are back in space.
            if (carriedJumpEscorts.length > 0 && !pendingDockedShip
                && !dockedShip && !pendingGateShip && !gateDockedShip) {
                await flushCarriedJumpEscorts(currentBridge,
                    currentDisplayWorld);
            }
            // The simulation runs on a fixed timestep, so convert real
            // elapsed time into a whole number of simulation steps and
            // carry the remainder. Render rate and simulation rate are
            // independent.
            const now = performance.now();
            if (lastPumpTime !== undefined && !simulationControl.paused) {
                // Slew toward the room's clock: elapsed time counts
                // slightly fast or slow rather than ticks being
                // skipped or doubled.
                simulationTimeDebt +=
                    (now - lastPumpTime) * (simulationPacing?.rate ?? 1);
            }
            lastPumpTime = now;
            // If we fall behind (heavy load, background tab), run at most
            // a few catch-up steps rather than spiraling.
            simulationTimeDebt = Math.min(
                simulationTimeDebt, SIMULATION_STEP_MS * MAX_CATCHUP_STEPS);
            let steps = Math.floor(simulationTimeDebt / SIMULATION_STEP_MS);
            simulationTimeDebt -= steps * SIMULATION_STEP_MS;
            if (simulationControl.paused) {
                steps = simulationControl.pendingSteps;
                simulationControl.pendingSteps = 0;
                simulationTimeDebt = 0;
            } else if (simulationPacing
                && simulationPacing.behindTicks > SNAP_BEHIND_TICKS) {
                // Too far behind the room to slew: snap by stepping
                // the backlog, bounded per frame.
                steps += Math.min(Math.floor(simulationPacing.behindTicks),
                    HARD_CATCHUP_STEPS);
            }

            if (steps > 0) {
                await currentBridge.step(steps);
                const frame = await currentBridge.snapshot();
                if (currentBridge !== simulationBridge || currentDisplayWorld !== displayWorld) {
                    return;
                }
                applySimulationFrame(frame, currentSerializer, currentDisplayWorld);
                simulationPacing = frame.pacing;
                syncedPlayerJumpRoute = getDisplayPlayerJumpRoute(currentDisplayWorld)?.slice();
                prefetchJumpDestination(currentDisplayWorld);
                for (const event of frame.events) {
                    emitSimulationBridgeEvent(event, currentSerializer, currentDisplayWorld);
                }
            }
            currentDisplayWorld.step();
            const displayedJumpRoute = getDisplayPlayerJumpRoute(currentDisplayWorld);
            if (!routesEqual(displayedJumpRoute, syncedPlayerJumpRoute)) {
                await currentBridge.setPlayerJumpRoute(displayedJumpRoute ?? []);
                syncedPlayerJumpRoute = displayedJumpRoute?.slice() ?? [];
            }
        } catch (e) {
            // A system transition (jumpTo) closes the bridge this frame
            // captured; its in-flight calls settle with
            // SimulationBridgeClosedError. That is expected — bail out
            // and let the next frame pick up the new bridge. Anything
            // else is a real error, but the pump must never die (a
            // frame pump that stops ends the game), so log and go on.
            if (!(e instanceof SimulationBridgeClosedError
                || currentBridge !== simulationBridge)) {
                console.error('Simulation frame pump error:', e);
            }
        } finally {
            simulationTickInFlight = false;
            lastPumpDone = performance.now();
            stats.end();
        }
    }

    const pumpTick = () => {
        void pumpSimulationFrame();
    };
    app.ticker.add(pumpTick);
    sessionDisposers.push(() => app.ticker.remove(pumpTick));

    // A fully backgrounded (or occluded) window gets zero rAF, so the
    // ticker — and with it the frame pump — freezes: the peer stays in
    // the room but stops stepping, publishing inputs, and reporting
    // hashes, a zombie that only revives on refocus. Worker timers are
    // exempt from background throttling, so a tiny worker heartbeat
    // drives the ticker whenever real rAF stalls. The staleness check
    // covers occluded-but-not-hidden windows, and keeps the heartbeat
    // from stacking on healthy rAF (which would run the sim fast).
    let lastAnimationFrame = performance.now();
    let heartbeatAlive = true;
    const animationFrameAlive = () => {
        if (!heartbeatAlive) {
            return;
        }
        lastAnimationFrame = performance.now();
        requestAnimationFrame(animationFrameAlive);
    };
    requestAnimationFrame(animationFrameAlive);
    const pumpWorker = new Worker(URL.createObjectURL(new Blob(
        ['setInterval(() => postMessage(0), 16)'],
        { type: 'text/javascript' })));
    pumpWorker.onmessage = () => {
        if (!heartbeatAlive) {
            return;
        }
        if (document.hidden
            || performance.now() - lastAnimationFrame > 100) {
            app.ticker.update(performance.now());
        }
    };
    sessionDisposers.push(() => {
        heartbeatAlive = false;
        pumpWorker.terminate();
    });

    // The teardown returned to the title orchestrator: reverse everything
    // this session set up, so the player can be dropped back on the title
    // screen and re-enter cleanly (enter -> esc -> enter -> esc ...).
    return async function teardownGame() {
        // Persist first: a pure read of the display world, still intact.
        try {
            saveNow();
        } catch (e) {
            console.warn('Failed to save on exit to title:', e);
        }
        // Stop the pump, heartbeat and input listeners BEFORE closing the
        // bridge, so no frame pumps against a dying worker and no stray
        // keypress reaches a torn-down world.
        for (const dispose of sessionDisposers) {
            try {
                dispose();
            } catch (e) {
                console.warn('Session teardown step failed:', e);
            }
        }
        sessionDisposers = [];
        // Remove the local player's ship from the sim so every other peer
        // sees it disappear (the same removeEntity broadcast a jump uses),
        // then tear down the system room + bridge + display world.
        let playerUuid: string | undefined;
        if (displayWorld) {
            for (const [uuid, entity] of displayWorld.entities) {
                if (entity.components.has(PlayerShipSelector)) {
                    playerUuid = uuid;
                    break;
                }
            }
        }
        await teardownActiveSystem(playerUuid);
        // Leave the top-level lobby room too and drop the sim world.
        multiRoom.leave('main room');

        // Reset the session state so the next entry starts clean.
        displayWorld = undefined;
        simulationWorker = undefined;
        simulationSerializer = undefined;
        activeSystemId = undefined;
        syncedPlayerJumpRoute = undefined;
        pendingDockedShip = undefined;
        dockedShip = undefined;
        pendingLaunchedShip = undefined;
        pendingGateShip = undefined;
        gateDockedShip = undefined;
        pendingGateLaunch = undefined;
        pendingGateArrivalSpob = undefined;
        carriedJumpEscorts = [];
        landedEscorts = [];
        // Any stash the last session never got to spend. Leaving it would
        // deal a dead save's escorts into the NEXT pilot's first system.
        restoredSaveEscorts = undefined;
        restoredSavePlayerUuid = undefined;
        clientSlotFloor = undefined;
        simulationTickInFlight = false;
        lastPumpTime = undefined;
        lastPumpDone = undefined;
        simulationTimeDebt = 0;
        simulationPacing = undefined;
        warnedUnsyncableEntities.clear();
        autopilot?.cancel();
        autopilot = undefined;
        document.body.classList.remove('nova-docked');
        window.onresize = null;
    };
}

/**
 * The dësc resources holding the original's About box text: 32767 is the
 * credits proper, 32766 the "special thanks" continuation the original
 * reaches through the box's scroll arrows. The About text is NOT in a
 * STR# table -- it lives in these two dëscs.
 */
const ABOUT_DESC_IDS = ['nova:32767', 'nova:32766'];

/**
 * Reads the About credits out of the game data. Returns undefined when
 * the data has no About dësc, so the dialog falls back to its built-in
 * text rather than showing an empty box.
 */
async function loadAboutText():
    Promise<{ text: string, pict: string | null } | undefined> {
    const parts: string[] = [];
    // The About box is the game's own desc+pict frame (PICT 8527), so it
    // also carries the dësc's Graphic in the pane on the right — dësc
    // 32767 names PICT 5005, the ship shown in title_screen/about.png.
    let pict: string | null = null;
    for (const id of ABOUT_DESC_IDS) {
        try {
            const desc = await displayAssetData.data.Description.get(id);
            if (desc.text.trim()) {
                parts.push(desc.text.trim());
            }
            if (pict === null && desc.graphic >= 0) {
                pict = `nova:${desc.graphic}`;
            }
        } catch {
            // A data set without this dësc: skip it.
        }
    }
    return parts.length ? { text: parts.join('\n\n'), pict } : undefined;
}

/** Saves `text` to the player's downloads as `filename`. */
function downloadText(text: string, filename: string): void {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Give the click a turn to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The game-data lookups an ORIGINAL EV Nova pilot import needs
 * (title/original_pilot_import.ts): resource existence by global id, the
 * planet -> system and system -> gövt maps, and the default start system.
 */
async function originalPilotContext(): Promise<OriginalPilotContext> {
    const ids = await simulationGameData.ids;
    const universe = MissionUniverse.shared(simulationGameData);
    await universe.load();
    let fallbackSystem = ids.System[0] ?? 'nova:128';
    try {
        const starts = await Promise.all(ids.PlayerStart.map(
            id => simulationGameData.data.PlayerStart.get(id)));
        const start = starts.find(s => s.isDefault) ?? starts[0];
        if (start && start.systems.length > 0) {
            fallbackSystem = start.systems[0];
        }
    } catch {
        // Keep the first system.
    }
    const ships = new Set(ids.Ship);
    const outfits = new Set(ids.Outfit);
    const missions = new Set(ids.Mission);
    const ranks = new Set(ids.Rank);
    const junk = new Set(ids.Junk);
    return {
        knownShip: id => ships.has(id),
        knownOutfit: id => outfits.has(id),
        knownMission: id => missions.has(id),
        knownRank: id => ranks.has(id),
        knownJunk: id => junk.has(id),
        systemOfPlanet: id => universe.systemIdOfPlanet(id),
        govtOfSystem: id => universe.getSystemInfo(id)?.govt,
        fallbackSystem,
    };
}

/**
 * Builds the bottom status readout for the title screen from the
 * current save + pilot profile. A pure read; never mutates state.
 */
async function computeTitleStatus(): Promise<TitleStatus> {
    const profile = getActivePilot()?.profile ?? loadPilotProfile();
    const save = loadSave();
    const empty: TitleStatus = {
        pilotName: profile?.name ?? '—',
        shipName: '—', shipClass: '—', shipSubtitle: '',
        legalStatus: 'Citizen', combatRating: combatRatingName(0),
        date: '—',
    };
    if (!save) {
        return empty;
    }
    let shipClass = '—';
    let shipSubtitle = '';
    try {
        const shipData = await simulationGameData.data.Ship.get(save.ship);
        // The ship's name can carry a "; variant" suffix that the
        // subtitle already spells out; show just the class on the first
        // line and the subtitle beneath (as the original does).
        shipClass = (shipData.name || save.ship).split(';')[0].trim();
        shipSubtitle = shipData.subtitle || '';
        if (shipSubtitle && shipSubtitle === shipClass) {
            shipSubtitle = '';
        }
    } catch {
        // Fall back to the raw id.
        shipClass = save.ship;
    }
    const shipNumber = profile?.shipNumber ?? 1;
    const kills = save.combatRatings
        ?.find(([category]) => category === 'kills')?.[1] ?? 0;
    return {
        pilotName: profile?.name ?? 'Captain',
        shipName: `${shipClass} ${shipNumber}`,
        shipClass,
        shipSubtitle,
        legalStatus: 'Citizen',
        combatRating: combatRatingName(kills),
        date: save.date ? formatDate(save.date) : '—',
    };
}

/**
 * Shows the title screen (the game's entry experience) and runs the
 * flow the player picks. Everything here is client-only — the sim/room
 * is only joined once the player enters the game via startGame().
 */
async function runTitle() {
    const title = new TitleScreen(displayAssetData);
    (window as any).novaTitle = title;
    // The original's looping title theme. A single streaming element reused
    // across the whole title lifetime (shown, entered, Esc'd back to). It
    // attempts autoplay now and, when the browser blocks that (no gesture
    // yet), starts on the player's first pointerdown / keydown.
    const music = new TitleMusic();
    (window as any).novaTitleMusic = music;
    await title.buildPromise;

    // While the title (not a game world) is on screen, IT owns renderer
    // sizing: without resizing the renderer here, a window widened after
    // load keeps its construction-time canvas size, leaving a black bar
    // on the wide side and shoving the re-centred art off-canvas. Resize
    // the renderer first, then re-centre the 1024x768 art within it, so
    // letterboxing stays symmetric at any aspect ratio.
    const onResize = () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        title.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    // Drive the title's flame animation while the title is visible.
    let lastTitleTick = performance.now();
    const titleTicker = () => {
        const now = performance.now();
        title.tick(now - lastTitleTick);
        lastTitleTick = now;
    };

    const refreshStatus = async () => {
        try {
            title.setStatus(await computeTitleStatus());
        } catch (e) {
            console.warn('Failed to compute title status:', e);
        }
    };

    // ── About ──────────────────────────────────────────────────────────
    // The About box is NOT native chrome in the original: title_screen/
    // about.png shows the game's own desc+pict frame (PICT 8527, at screen
    // 635,419 — plainly centred) with the credits scrolling in its text well,
    // the dësc's Graphic in the pane on the right, a red Okay and the two
    // round scroll arrows. That is exactly what OfferPopup renders, so About
    // reuses it instead of the HTML modal it used to open. (The pilot and
    // Preferences dialogs ARE native windows in the original, and keep their
    // HTML stand-ins by the project's standing ruling.)
    const aboutPopup = new OfferPopup(displayAssetData);
    aboutPopup.container.name = 'AboutPopup';
    // Centre in CSS pixels (app.screen), not renderer.width/height: with
    // autoDensity on a 2x display those are DEVICE pixels, and halving them
    // put the About box in the bottom-right corner (Matthew's playtest).
    const centreAbout = () => aboutPopup.container.position.set(
        app.screen.width / 2, app.screen.height / 2);
    window.addEventListener('resize', centreAbout);
    const showAbout = async () => {
        const about = await loadAboutText();
        // Keep the popup above the title art, and only while it is up.
        app.stage.addChild(aboutPopup.container);
        centreAbout();
        try {
            await aboutPopup.show(
                fillAboutPlaceholders(about?.text ?? ABOUT_TEXT.join('\n')),
                { accept: 'Okay' }, { pict: about?.pict ?? null });
        } finally {
            app.stage.removeChild(aboutPopup.container);
        }
    };

    // ── Pilot history / rollback ───────────────────────────────────────
    // The rollback view (title/rollback_screen.ts) is a PIXI panel over the
    // title art, like the About popup. The title has no game controls
    // pipeline, so a keydown adaptor feeds it arrow/page/Escape presses as
    // ControlEvents on its own subject while it is up. Built lazily: it
    // loads every system for its map on first use.
    const rollbackControls = new Subject<ControlEvent>();
    let rollbackScreen: RollbackScreen | undefined;
    const rollbackKeyActions: Record<string, ControlAction> = {
        ArrowUp: 'up', ArrowDown: 'down', PageUp: 'left', PageDown: 'right',
        Escape: 'depart',
    };
    const onRollbackKey = (event: KeyboardEvent) => {
        const action = rollbackKeyActions[event.key];
        if (!action) {
            return;
        }
        event.preventDefault();
        rollbackControls.next({
            action, state: event.repeat ? 'repeat' : 'start',
        });
    };
    const centreRollback = () => rollbackScreen?.container.position.set(
        Math.max(0, (app.screen.width - ROLLBACK_PANEL.width) / 2),
        Math.max(0, (app.screen.height - ROLLBACK_PANEL.height) / 2));
    window.addEventListener('resize', centreRollback);
    /**
     * Opens the rollback view for a pilot; resolves a status line for the
     * Open Pilot dialog. A rewind installs the chosen checkpoint's save as
     * the pilot's current save (title/pilot_history.ts rewindPilotSave).
     */
    const openRollback = async (id: string): Promise<string> => {
        const pilot = listPilots().find(p => p.id === id);
        if (!pilot) {
            return 'That pilot no longer exists.';
        }
        const history = loadHistory(pilot.saveKey);
        if (!history || history.checkpoints.length === 0) {
            return `${pilot.name} has no checkpoints yet (they are recorded `
                + 'on every departure).';
        }
        rollbackScreen ??= new RollbackScreen(displayAssetData,
            simulationGameData, rollbackControls);
        app.stage.addChild(rollbackScreen.container);
        centreRollback();
        document.addEventListener('keydown', onRollbackKey);
        try {
            const result = await rollbackScreen.show({
                pilotName: pilot.name,
                history,
                onExport: (index) => {
                    const copy = exportCheckpointFile(id, index);
                    if (copy) {
                        downloadText(copy.text, exportFileName(copy.name));
                    }
                },
            });
            if (result.action === 'rewind') {
                const label = history.checkpoints[result.index]?.label
                    ?? 'checkpoint';
                if (rewindPilotSave(pilot.saveKey, result.index)) {
                    // The in-flight change baseline moves with the save.
                    if (getActivePilot()?.id === id) {
                        loadCheckpointBaseline();
                    }
                    void refreshStatus();
                    return `Rewound ${pilot.name} to "${label}".`;
                }
                return 'The rewind could not be written.';
            }
            return '';
        } finally {
            document.removeEventListener('keydown', onRollbackKey);
            app.stage.removeChild(rollbackScreen.container);
        }
    };

    let entering = false;
    let inGame = false;
    let teardownGame: (() => Promise<void>) | undefined;

    // Put the title back on screen (initial boot, and after leaving the
    // game): re-add its container/ticker, re-size to the current window
    // (the game may have resized the renderer), and refresh the status
    // readout from the freshly saved game.
    const showTitle = () => {
        app.stage.addChild(title.container);
        app.ticker.add(titleTicker);
        lastTitleTick = performance.now();
        onResize();
        title.show();
        // Start (initial boot) or restart (after Esc back from the game) the
        // looping theme. `?mute` (preview panels / harness runs) skips it.
        if (!isMuted()) {
            music.play();
        }
        void refreshStatus();
    };

    const enterGame = async () => {
        if (entering || inGame) {
            return;
        }
        entering = true;
        title.hide();
        // Cut the theme as the game world takes over (it restarts from the
        // top if the player Escapes back to the title).
        music.stop();
        app.ticker.remove(titleTicker);
        app.stage.removeChild(title.container);
        try {
            teardownGame = await startGame();
            inGame = true;
        } catch (e) {
            console.error('Failed to enter game:', e);
            showTitle();
        } finally {
            entering = false;
        }
    };

    // Escape while flying leaves the game and returns to the title: save,
    // remove the player's ship for every peer, tear the game session down,
    // and re-show the title. Re-entry (Enter Ship) then works again.
    const exitToTitle = async () => {
        if (!inGame || entering) {
            return;
        }
        entering = true;
        try {
            await teardownGame?.();
        } catch (e) {
            console.error('Failed to exit to title:', e);
        }
        teardownGame = undefined;
        inGame = false;
        entering = false;
        showTitle();
    };

    // Escape returns to the title, but ONLY while actually flying: a
    // landed menu / dialog / text field owns (or reserves) Escape, so
    // stand down whenever one is up. The spaceport sets `nova-docked`;
    // starmap/gate map/player info/hail/boarding set MenuControls.focused;
    // text inputs are caught by isTextEntryActive.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !inGame || entering) {
            return;
        }
        if (MenuControls.focused || isTextEntryActive()
            || document.body.classList.contains('nova-docked')) {
            return;
        }
        event.preventDefault();
        void exitToTitle();
    });

    showTitle();
    title.action.subscribe(async (action) => {
        if (entering || inGame) {
            return;
        }
        switch (action) {
            case 'enterShip':
                await enterGame();
                break;
            case 'newPilot': {
                title.setEnabled(false);
                const profile = await showNewPilotDialog();
                if (profile) {
                    const withShip = {
                        ...profile,
                        shipNumber: 100 + Math.floor(Math.random() * 900),
                    };
                    // Register a NEW pilot file and make it active. Its
                    // save key is fresh AND unoccupied (createPilot skips
                    // any id whose slot already holds a save), so startGame
                    // spawns from the scenario's default chär without
                    // disturbing any other pilot's save.
                    createPilot(withShip);
                    // Deliberately NOT resetSave(): the new pilot's slot is
                    // empty by construction, so there is nothing of its own
                    // to clear, and a reset here could only ever delete a
                    // save belonging to somebody else — the legacy
                    // `novajs:save` that migration adopts in place, above
                    // all. Only the exploration record needs clearing: it
                    // is still client-global, and a new pilot starts with
                    // an unexplored galaxy.
                    resetExplored();
                    savePilotProfile(withShip);
                    // A fresh pilot has no rebindings: back to defaults.
                    await applyControls();
                    await enterGame();
                } else {
                    title.setEnabled(true);
                }
                break;
            }
            case 'openPilot': {
                title.setEnabled(false);
                const toEntry = (p: ReturnType<typeof listPilots>[number]):
                    PilotEntry => {
                    const active = getActivePilot();
                    const isActive = active?.id === p.id;
                    const parts: string[] = [];
                    if (p.profile?.nickname) {
                        parts.push(`"${p.profile.nickname}"`);
                    }
                    if (isActive) {
                        parts.push('(current)');
                    }
                    const checkpoints = checkpointCount(loadHistory(p.saveKey));
                    if (checkpoints > 0) {
                        parts.push(`· ${checkpoints} checkpoint`
                            + `${checkpoints === 1 ? '' : 's'}`);
                    }
                    return {
                        id: p.id, name: p.name,
                        detail: parts.join(' ') || undefined,
                    };
                };
                const listEntries = () => listPilots().map(toEntry);
                const actions: PilotDialogActions = {
                    refresh: listEntries,
                    onExport: (id) => {
                        const text = exportPilot(id);
                        if (!text) { return; }
                        const pilot = listPilots().find(p => p.id === id);
                        downloadText(text,
                            exportFileName(pilot?.name ?? 'pilot'));
                    },
                    onImport: async (bytes, fileName) => {
                        // Content sniffing: a NovaJS export is JSON; anything
                        // else is tried as an original EV Nova pilot.
                        let result: ImportResult;
                        if (looksLikeOriginalPilot(bytes)) {
                            result = importOriginalPilot(bytes, fileName,
                                await originalPilotContext());
                        } else {
                            result = importPilot(
                                new TextDecoder().decode(bytes));
                        }
                        if (!result.ok) {
                            return { ok: false, message: result.reason };
                        }
                        const notes = result.notes?.length
                            ? ` Notes: ${result.notes.join(' ')}` : '';
                        return {
                            ok: true,
                            message: (result.renamed
                                ? `Imported as "${result.pilot.name}" (a pilot `
                                + 'with that name already existed).'
                                : `Imported "${result.pilot.name}".`) + notes,
                        };
                    },
                    onDelete: (id) => { deletePilot(id); },
                    onRollback: openRollback,
                };
                const chosen = await showOpenPilotDialog(listEntries(), actions);
                if (chosen) {
                    const picked = selectPilot(chosen);
                    if (picked) {
                        // Mirror the chosen pilot's profile into the legacy
                        // slot so the title status readout matches.
                        if (picked.profile) {
                            savePilotProfile(picked.profile);
                        }
                        await applyControls();
                    }
                    await enterGame();
                } else {
                    title.setEnabled(true);
                    void refreshStatus();
                }
                break;
            }
            case 'setPrefs': {
                title.setEnabled(false);
                const controlsJson =
                    await simulationGameData.getSettings?.('controls.json');
                await showPreferencesDialog(
                    (controlsJson as Record<string, unknown>) ?? {});
                // Rebindings take effect right away rather than at the
                // next game entry.
                await applyControls();
                title.setEnabled(true);
                break;
            }
            case 'about': {
                title.setEnabled(false);
                await showAbout();
                title.setEnabled(true);
                break;
            }
            case 'quit':
                // Deliberately a no-op: a browser tab cannot quit itself
                // (window.close() is ignored for tabs the script did not
                // open), and anything else -- reloading, blanking the
                // page, dropping the sockets -- destroys the session
                // instead of quitting. The button stays because the
                // original menu has it.
                break;
            default:
                break;
        }
    });
}

// `?mute` silences everything played through the pixi sound layer
// (UI beeps, weapons, ambient) in addition to the title music gated
// above — one switch for preview panels and automated loads.
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
    startGame().catch((e) => {
        console.error('Failed to start game:', e);
    });
} else {
    runTitle().catch((e) => {
        console.error('Title screen failed; entering game directly.', e);
        void startGame();
    });
}
