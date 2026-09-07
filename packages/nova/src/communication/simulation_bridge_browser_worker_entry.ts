import * as Comlink from "comlink";
import { BehaviorSubject, Subject } from "rxjs";

// The worker's console is invisible to most tooling; keep a ring of
// recent lines and serve it through status() for diagnostics.
const workerLogs: string[] = [];
for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
        original(...args);
        workerLogs.push(`[${level}] ` + args.map(arg =>
            typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
        if (workerLogs.length > 100) {
            workerLogs.shift();
        }
    };
}
import { Communicator, CommunicatorResource, Peers } from "nova_ecs/plugins/multiplayer_plugin";
import { SimulationGameData } from "../client/gamedata/simulation_game_data.js";
import { ControlEvent } from "../nova_plugin/core/index.js";
import { AnalogControlState } from "../nova_plugin/player/index.js";
import { HailAction } from "../nova_plugin/encounters/index.js";
import { EscortAction } from "../nova_plugin/escorts/index.js";
import { AcceptedMission } from "../nova_plugin/missions/index.js";
import { makeSystem } from "../nova_plugin/make_system.js";
import { SimulationBridgeHost } from "./simulation_bridge_host.js";
import { SimulationFrame } from "./simulation_frame.js";
import { BrowserSimulationBridgeWorkerApi, BrowserWorkerRoomState } from "./simulation_bridge_browser_worker.js";
import { EncodedEntity } from "nova_ecs/plugins/serializer_plugin";


class WorkerRoomCommunicator implements Communicator {
    readonly messages = new Subject<{ source: string, message: unknown }>();
    readonly peers = new Peers(new BehaviorSubject(new Set<string>()));
    readonly servers = new BehaviorSubject(new Set<string>(['server']));
    readonly connected = new BehaviorSubject(false);
    uuid: string | undefined;

    constructor(
        private sendToRoom: (message: unknown, destination?: string | Set<string>) => void | Promise<void>,
        initialState: BrowserWorkerRoomState,
    ) {
        this.updateRoomState(initialState);
    }

    updateRoomState(state: BrowserWorkerRoomState) {
        if ('uuid' in state) {
            this.uuid = state.uuid;
        }
        if (state.peers) {
            this.peers.current.next(new Set(state.peers));
        }
        if (typeof state.connected === 'boolean') {
            this.connected.next(state.connected);
        }
        if (state.servers) {
            this.servers.next(new Set(state.servers));
        }
    }

    receiveMessage(source: string, message: unknown) {
        this.messages.next({ source, message });
    }

    sendMessage(message: unknown, destination?: string | Set<string>) {
        void this.sendToRoom(message, destination);
    }
}

class BrowserSimulationBridgeHost implements BrowserSimulationBridgeWorkerApi {
    private bridge?: SimulationBridgeHost;
    private world?: Awaited<ReturnType<typeof makeSystem>>;
    private communicator?: WorkerRoomCommunicator;
    // Room traffic forwarded before init finishes (the main thread
    // subscribes before calling init, so joinRoom's catch-up reply is
    // not dropped). Replayed once the communicator and bridge exist.
    private pendingRoomState: BrowserWorkerRoomState[] = [];
    private pendingRoomMessages: [string, unknown][] = [];

    async init(args: {
        systemId: string;
        roomState: BrowserWorkerRoomState;
    },
        sendMessage: (message: unknown, destination?: string | Set<string>) => void | Promise<void>,
    ) {
        const simulationGameData = new SimulationGameData();
        const world = await makeSystem(args.systemId, simulationGameData, 'worker');
        const communicator = new WorkerRoomCommunicator(sendMessage, args.roomState);
        // Pure input-driven multiplayer: no delta-sync plugin. The world
        // evolves only from the deterministic genesis plus the room's
        // tick-stamped input records.
        world.resources.set(CommunicatorResource, communicator);

        this.world = world;
        this.communicator = communicator;
        this.bridge = new SimulationBridgeHost(world, simulationGameData);
        // Replay buffered traffic now that the bridge is subscribed —
        // the catch-up reply joinRoom waits for may already be here.
        for (const state of this.pendingRoomState) {
            communicator.updateRoomState(state);
        }
        this.pendingRoomState = [];
        for (const [source, message] of this.pendingRoomMessages) {
            communicator.receiveMessage(source, message);
        }
        this.pendingRoomMessages = [];
        // Join the room's shared timeline by replaying its input log.
        await this.bridge.joinRoom();
    }

    async updateRoomState(state: BrowserWorkerRoomState) {
        if (!this.communicator) {
            this.pendingRoomState.push(state);
            return;
        }
        this.communicator.updateRoomState(state);
    }

    async receiveRoomMessage(source: string, message: unknown) {
        if (!this.communicator) {
            this.pendingRoomMessages.push([source, message]);
            return;
        }
        this.communicator.receiveMessage(source, message);
    }

    async controlEvents(events: ControlEvent[]) {
        this.requireBridge().controlEvents(events);
    }

    async analogControl(control: AnalogControlState) {
        this.requireBridge().analogControl(control);
    }

    async setTarget(target: string | null) {
        this.requireBridge().setTarget(target);
    }

    async setPlanetTarget(target: string | null) {
        this.requireBridge().setPlanetTarget(target);
    }

    async hail(action: HailAction) {
        this.requireBridge().hail(action);
    }

    async escortAction(action: EscortAction) {
        await this.requireBridge().escortAction(action);
    }

    async acceptMission(accepted: AcceptedMission) {
        await this.requireBridge().acceptMission(accepted);
    }

    async step(count?: number) {
        this.requireBridge().step(count);
    }

    async snapshot(): Promise<SimulationFrame> {
        return this.requireBridge().snapshot();
    }

    async addEntity(uuid: string, entity: EncodedEntity) {
        await this.requireBridge().addEntity(uuid, entity);
    }

    async removeEntity(uuid: string) {
        this.requireBridge().removeEntity(uuid);
    }

    async setPlayerJumpRoute(route: string[]) {
        this.requireBridge().setPlayerJumpRoute(route);
    }

    async spawnNpc(shipId: string) {
        await this.requireBridge().spawnNpc(shipId);
    }

    async rewind(ticks: number) {
        return this.requireBridge().rewind(ticks);
    }

    async resync() {
        return this.requireBridge().resync();
    }

    async status() {
        return {
            ...this.requireBridge().status(),
            logs: [...workerLogs],
        };
    }

    async entityHashes() {
        return this.requireBridge().entityHashes();
    }

    private requireBridge() {
        if (!this.bridge) {
            throw new Error("Simulation worker has not been initialized");
        }
        return this.bridge;
    }

    private requireWorld() {
        if (!this.world) {
            throw new Error("Simulation worker has not been initialized");
        }
        return this.world;
    }

    private requireCommunicator() {
        if (!this.communicator) {
            throw new Error("Simulation worker has not been initialized");
        }
        return this.communicator;
    }
}

Comlink.expose(new BrowserSimulationBridgeHost());
