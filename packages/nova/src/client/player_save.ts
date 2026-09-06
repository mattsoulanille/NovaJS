/**
 * ============================================================================
 * Saving the local player, and the pilot-history checkpoints
 * ============================================================================
 *
 * The save is a pure READ of where the player is: the docked or
 * launching entity while the player is out of the simulation (it carries
 * everything the venues committed), else the display world's player
 * entity (which mirrors the simulation). Which of those applies is a
 * question for the client state machine (client/client_state.ts): the
 * handle chain browser.ts used to walk — `pendingLaunchedShip ??
 * pendingGateLaunch ?? dockedShip?.entity ?? gateDockedShip?.entity ??
 * ...` — had already missed the gate handles once (issue #69), and the
 * selectors here cannot miss a variant the compiler knows about.
 *
 * Checkpoints (title/pilot_history.ts) are recorded on every departure by
 * the landed UI's requests, and in flight by comparing each periodic save
 * against the newest checkpoint (a capture, a mission accepted from a
 * ship). Client-local: the simulation is never involved.
 */
import type { Entity } from 'nova_ecs/entity';
import type { ControlBitPair, ControlBitResolver } from '../nova_plugin/ncb/control_bit_namespaces.js';
import { displayName } from '../nova_plugin/core/display_name.js';
import {
    decodeSave, encodeSave, extractSaveData, extractSavedEscorts,
    getActiveSaveKey, resetSave, SaveData, writeSave,
} from '../nova_plugin/session/save_game.js';
import {
    CheckpointRequest, checkpointRequests, describeFlightChanges,
} from '../spaceport/checkpoint_requests.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import type { JsonValue } from '../title/json_patch.js';
import {
    latestState, loadHistory, recordCheckpoint,
} from '../title/pilot_history.js';
import {
    activeSystemId, ClientStateSlot, dockedShip, launchingEntity, liveSystem,
} from './client_state.js';
import { FleetLedger, getPlayerShipEntity, localPlayerShipUuid } from './fleet_ledger.js';
import type { SimulationGameData } from './gamedata/simulation_game_data.js';

/**
 * The control-bit namespace resolver for the plug-in set the SERVER
 * loaded, and the saved bits it could not represent (their plug-in is
 * not loaded here). Set once per game session from the save it restored;
 * the save writes bits as (namespace, bit) pairs through the resolver
 * and carries the parked pairs along unchanged, so a pilot's progress in
 * a plug-in survives a stint on a server without it
 * (nova_plugin/ncb/control_bit_namespaces.ts).
 */
export interface ControlBitContext {
    readonly resolver: ControlBitResolver;
    parked: ControlBitPair[];
}

const SAVE_INTERVAL_MS = 10_000;

export class PlayerPersistence {
    /** See ControlBitContext. Undefined until a session has restored a save. */
    controlBits: ControlBitContext | undefined;
    /**
     * The save at the ACTIVE pilot's newest checkpoint, as this session
     * last saw it: the baseline the in-flight change detector compares
     * against. Loaded from the stored history on game entry, then
     * tracked in memory as checkpoints are recorded (so no history fold
     * per periodic save).
     */
    private lastCheckpointData: SaveData | undefined;
    private checkpointRecorderInstalled = false;
    private saveTriggersInstalled = false;

    constructor(private readonly state: ClientStateSlot,
        private readonly fleet: FleetLedger,
        private readonly gameData: SimulationGameData) { }

    /**
     * The uuid the local player's escorts are filed under, wherever the
     * player currently is. It is the same uuid across a landing (the
     * docked handle keeps the ship's in-world uuid), which is exactly why
     * the rosters can be keyed by it while the player is out of the world.
     *
     * Undefined only in the narrow windows between states (mid-relaunch,
     * mid-jump). Callers must treat that as "don't know", never as "no
     * escorts": in multiplayer the rosters can hold other peers' entries,
     * and saving those would hand this pilot someone else's ships.
     */
    localPlayerUuid(): string | undefined {
        const state = this.state.state;
        const docked = dockedShip(state);
        if (docked) {
            return docked.uuid;
        }
        const world = liveSystem(state)?.world;
        return world ? localPlayerShipUuid(world) : undefined;
    }

    /**
     * The save payload for the local player right now: `entity` when
     * given (a venue's just-committed docked ship, see
     * checkpoint_requests.ts), else the player entity this client
     * currently holds. Undefined if there's no player ship yet (mid-jump)
     * or nothing meaningful to persist.
     */
    buildSaveData(entity?: Entity): SaveData | undefined {
        const state = this.state.state;
        const live = liveSystem(state);
        if (!live) {
            return undefined;
        }
        // While docked the player entity is out of the display world; the
        // docked/relaunching entity carries the freshest state (mission
        // acceptances, payments, the advanced date). A HYPERGATE dock
        // holds the entity the same way (issue #69).
        const playerShip = entity
            ?? launchingEntity(state)
            ?? dockedShip(state)?.entity
            ?? getPlayerShipEntity(live.world);
        if (!playerShip) {
            return undefined;
        }
        const data = extractSaveData(playerShip, live.systemId,
            this.controlBits
                ? { resolver: this.controlBits.resolver, parked: this.controlBits.parked }
                : undefined);
        if (!data) {
            return undefined;
        }
        // Escorts, as whole serialized entities. Needs the simulation's
        // serializer, which the live system carries. Likewise a player
        // uuid: without one we cannot tell this pilot's escorts from a
        // peer's, and writing none beats writing someone else's (the
        // next save, ~10s later, has one).
        const player = this.localPlayerUuid();
        if (player) {
            const escorts = extractSavedEscorts(
                this.fleet.escortsToSave(player, live.world), live.serializer);
            // Left absent rather than written as `[]`, so an escortless
            // pilot's save stays exactly the payload a v1 build wrote.
            if (escorts.length > 0) {
                data.escorts = escorts;
                // The player's own uuid goes with them. Restoring re-mints
                // the player, and a fighter launched from the player's
                // OWN bays names it in OwnerComponent/SourceComponent;
                // without this the restored fighter chases a dead uuid
                // and can never dock (see SaveData.playerUuid).
                data.playerUuid = player;
            }
        }
        return data;
    }

    /**
     * Serializes the local player's current state to localStorage. No-op
     * with nothing to persist. In flight, also notices state changes the
     * SIMULATION made since the last checkpoint — a capture, a mission
     * accepted from a ship — and records a checkpoint for them.
     */
    saveNow(): void {
        const data = this.buildSaveData();
        if (!data) {
            return;
        }
        writeSave(data);
        this.noticeFlightChanges(data);
    }

    /** Seeds the in-flight change baseline from the stored history. */
    loadCheckpointBaseline(): void {
        const newest = latestState(loadHistory(getActiveSaveKey()));
        this.lastCheckpointData = newest === undefined
            ? undefined : decodeSave(JSON.stringify(newest));
    }

    /**
     * Records a checkpoint of the player's state for the active pilot:
     * writes the save from the requested entity (so save and checkpoint
     * agree) and appends the checkpoint to the pilot's history. Skipped
     * when there is nothing to snapshot (mid-jump, no player yet).
     */
    recordCheckpointNow(request: CheckpointRequest): void {
        // Mid-jump the player is in no world and its escorts are on the
        // jump roster under no known player uuid; a snapshot then would
        // silently drop them, so wait for the next depart / periodic
        // detection instead.
        if (!this.localPlayerUuid()) {
            return;
        }
        const data = this.buildSaveData(request.entity);
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
        const state = this.state.state;
        const stellar = request.stellar ?? dockedShip(state)?.planetId;
        const system = activeSystemId(state);
        try {
            recordCheckpoint(getActiveSaveKey(), envelope, {
                label: request.label,
                kind: request.kind,
                ...(data.date ? { date: { ...data.date } } : {}),
                ...(system ? { system } : {}),
                ...(stellar ? { stellar } : {}),
                at: Date.now(),
            });
            this.lastCheckpointData = data;
        } catch (e) {
            console.warn('Failed to record a checkpoint:', e);
        }
    }

    /**
     * The in-flight half of checkpoint recording: nothing landed
     * announces a boarding capture or a mission accepted from a ship in
     * flight, so the periodic save compares the ship type and mission set
     * against the last checkpoint and records one for whatever changed.
     * Only IN FLIGHT: while docked, the venues announce their own changes
     * (and a just-bought ship lives on a new entity the docked handle
     * does not yet point at).
     */
    private noticeFlightChanges(data: SaveData): void {
        if (this.state.state.kind !== 'inSpace' || !this.lastCheckpointData) {
            return;
        }
        const universe = MissionUniverse.shared(this.gameData);
        const changes = describeFlightChanges(this.lastCheckpointData, data, {
            shipName: id => this.gameData.data.Ship.getCached(id)?.name
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
        this.recordCheckpointNow({
            label: changes.map(c => c.label).join('; '),
            kind: changes[0].kind,
        });
    }

    /** Subscribes the recorder to the landed UI's checkpoint requests. */
    installCheckpointRecorder(): void {
        if (this.checkpointRecorderInstalled) {
            return;
        }
        this.checkpointRecorderInstalled = true;
        checkpointRequests.subscribe(request => {
            try {
                this.recordCheckpointNow(request);
            } catch (e) {
                console.warn('Checkpoint request failed:', e);
            }
        });
    }

    /**
     * Wires up when the game persists the player's state:
     * - periodically (every ~10s),
     * - when the page is being hidden or unloaded (pagehide / the tab
     *   going to the background), which are more reliable than
     *   beforeunload.
     * Landing at a spaceport also saves; that hook lives on each display
     * world's LandEvent (client/docking.ts).
     */
    installSaveTriggers(): void {
        if (this.saveTriggersInstalled) {
            return;
        }
        this.saveTriggersInstalled = true;
        const saveNow = () => this.saveNow();
        setInterval(saveNow, SAVE_INTERVAL_MS);
        // pagehide fires on navigation away / tab close and is far more
        // reliable than beforeunload (which browsers may skip).
        window.addEventListener('pagehide', saveNow);
        // Save whenever the tab is backgrounded: on mobile this is often
        // the last event before the page is discarded.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                saveNow();
            }
        });
        // Console-callable escape hatches.
        window.novaSaveNow = saveNow;
        window.novaResetSave = () => {
            resetSave();
            console.info('Cleared the saved game. Reload to start fresh.');
        };
    }
}
