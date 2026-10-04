import { Communicator, Peers } from "nova_ecs/plugins/multiplayer_plugin";
import { BehaviorSubject, Subject, Subscription } from "rxjs";
import { identityOf } from "./multi_room_communicator.js";

/**
 * ============================================================================
 * The room, as the simulation worker sees it
 * ============================================================================
 *
 * The browser's simulation runs in a worker; the room's socket lives on the
 * main thread. The main thread forwards the room's state and traffic
 * ({@link forwardRoomToWorker}, client/system_entry.ts) and the worker reads
 * it through a {@link WorkerRoomCommunicator}
 * (simulation_bridge_browser_worker_entry.ts). Kept free of worker globals
 * so node specs drive the very same forwarding the browser does.
 */

/** The room state the main thread hands the worker. */
export interface WorkerRoomState {
    uuid?: string;
    peers?: Set<string>;
    connected?: boolean;
    servers?: Set<string>;
}

/** The worker side of the forwarding: a Communicator over forwarded state. */
export class WorkerRoomCommunicator implements Communicator {
    readonly messages = new Subject<{ source: string, message: unknown }>();
    readonly peers = new Peers(new BehaviorSubject(new Set<string>()));
    // The main thread's announced set (communicator_client.ts), relayed
    // through init and updateRoomState; nobody is a server until then.
    readonly servers = new BehaviorSubject(new Set<string>());
    readonly connected = new BehaviorSubject(false);
    /**
     * This peer's uuid, as the main thread last forwarded it. NOT fixed at
     * init: a reconnect assigns a new one (#354), and the bridge host
     * follows it (simulation_bridge_host.ts noteIdentity) — a worker
     * that kept the init-time copy applied its own records under an id
     * the relay no longer stamps them with, and never recognised itself
     * in a desync verdict.
     */
    uuid: string | undefined;

    constructor(
        private sendToRoom: (message: unknown, destination?: string | Set<string>) => void | Promise<void>,
        initialState: WorkerRoomState,
    ) {
        this.updateRoomState(initialState);
    }

    updateRoomState(state: WorkerRoomState) {
        if ('uuid' in state && state.uuid !== undefined) {
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

/** Where the main thread forwards the room (the worker's API, or a spec's
 * WorkerRoomCommunicator directly). */
export interface WorkerRoomSink {
    receiveRoomMessage(source: string, message: unknown): void | Promise<void>;
    updateRoomState(state: WorkerRoomState): void | Promise<void>;
}

/** The room's current state, for the worker's init. */
export function workerRoomState(room: Communicator): WorkerRoomState {
    return {
        uuid: room.uuid,
        peers: room.peers.current.value,
        connected: room.connected.value,
        servers: room.servers.value,
    };
}

/**
 * Forwards the room's traffic and state to the worker: messages, the peer
 * set, the connection flag, the server set — and the IDENTITY, which a
 * reconnect changes (#354). Subscribed BEFORE the worker's init (whose
 * joinRoom waits for a catch-up reply on this channel); the worker buffers
 * whatever arrives before its communicator exists.
 */
export function forwardRoomToWorker(room: Communicator, sink: WorkerRoomSink):
    Subscription[] {
    const subscriptions = [
        room.messages.subscribe(({ source, message }) => {
            void sink.receiveRoomMessage(source, message);
        }),
        room.peers.current.subscribe(peers => {
            void sink.updateRoomState({ peers });
        }),
        room.connected.subscribe(connected => {
            void sink.updateRoomState({ connected });
        }),
        // The server's uuid set arrives in its first frame; a system
        // entered before that must still learn it.
        room.servers.subscribe(servers => {
            void sink.updateRoomState({ servers });
        }),
    ];
    const identity = identityOf(room);
    if (identity) {
        subscriptions.push(identity.subscribe(uuid => {
            if (uuid !== undefined) {
                void sink.updateRoomState({ uuid });
            }
        }));
    }
    return subscriptions;
}
