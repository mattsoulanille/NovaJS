/**
 * The context the client modules share: the page-lifetime services
 * browser.ts constructs once (the PIXI app, the game data, the socket
 * and its rooms), the client state machine, and the per-session objects
 * the game session installs (the autopilot). Handed to every module as
 * `runtime` rather than reached through module-level variables, so a
 * module's dependencies are visible in its signature and a spec can hand
 * it a fake.
 *
 * Client-local: nothing here touches simulation state.
 */
import type { World } from 'nova_ecs/world';
import type * as PIXI from 'pixi.js';
import type { Subject } from 'rxjs';
import type { Autopilot } from '../autopilot.js';
import type { CommunicatorClient } from '../communication/communicator_client.js';
import type { MultiRoom } from '../communication/multi_room_communicator.js';
import {
    SimulationBridgeClosedError,
} from '../communication/async_simulation_bridge_client.js';
import type { ControlEvent } from '../nova_plugin/core/controls_plugin.js';
import type {
    GateDestinationResolver,
} from '../nova_plugin/travel/gate_destination_resolver.js';
import type { DisplayAssetData } from './gamedata/display_asset_data.js';
import type { SimulationGameData } from './gamedata/simulation_game_data.js';
import type { ClientStateSlot } from './client_state.js';
import type { FleetLedger } from './fleet_ledger.js';
import type { PlayerPersistence } from './player_save.js';
import type { SessionTransitions } from './session_transitions.js';

export interface ClientRuntime {
    readonly app: PIXI.Application;
    readonly gameData: SimulationGameData;
    readonly displayAssetData: DisplayAssetData;
    readonly communicator: CommunicatorClient;
    readonly multiRoom: MultiRoom;
    readonly gateDestinations: GateDestinationResolver;
    /** The control-event stream the display worlds subscribe to. */
    readonly controlsSubject: Subject<ControlEvent>;
    /** The session generations every transition runs under (issue #30). */
    readonly transitions: SessionTransitions;
    /** Where the player is. */
    readonly state: ClientStateSlot;
    /** The escort rosters and the rest of the fleet bookkeeping. */
    readonly fleet: FleetLedger;
    /** Saves and pilot-history checkpoints. */
    readonly saves: PlayerPersistence;
    /**
     * Pushes the current display scale into a freshly built display
     * world (or the live one when called with nothing): the UI layer's
     * transform, the DisplayScale resource, one ResizeEvent.
     */
    applyDisplayScale(world?: World): void;
    /** The session's autopilot, while a game session is open. */
    autopilot?: Autopilot;
}

/**
 * How long a transition waits for the destination room's server peer
 * before giving up and recovering the ship (issue #72). A room join
 * normally completes well inside a second; the bound only matters when
 * the socket drops mid-transition, where waiting forever left the white
 * screen up for good with the escort batch held in a local.
 */
export const SERVER_PEER_TIMEOUT_MS = 20_000;

/**
 * A bridge call whose result nobody waits for (a keypress, a touch
 * release, an autopilot cancel). Rejecting because the bridge closed
 * under it is the ordinary consequence of a transition taking the
 * bridge away mid-call, and is silent; anything else is logged rather
 * than surfacing as an unhandled rejection (issue #71).
 */
export function sendToBridge(call: Promise<unknown> | undefined,
    what: string): void {
    call?.catch(e => {
        if (!(e instanceof SimulationBridgeClosedError)) {
            console.warn(`${what} failed:`, e);
        }
    });
}
