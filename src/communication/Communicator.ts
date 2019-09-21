import * as t from "io-ts";
import { GameState } from "../engine/GameState";
import { SystemState } from "../engine/SystemState";
import { Channel } from "./Channel";
import { PathReporter } from "io-ts/lib/PathReporter";
import { PartialState, PartialGameState, RecursivePartial } from "../engine/Stateful";
import { mergeStates } from "./mergeStates";
import { filterUUIDs } from "./filterUUIDs";
import { SetType } from "../common/SetType"
import { AnyEvent } from "ts-events";

// const SetUUIDsMessage = t.type({
//     messageType: t.literal("setUUIDs"),
//     UUIDs: t.array(t.string),
//     shipUUID: t.string
// });
// type SetUUIDsMessage = t.TypeOf<typeof SetUUIDsMessage>;

const StateMessage = t.type({
    messageType: t.literal("setState"),
    state: PartialGameState
});
type StateMessage = t.TypeOf<typeof StateMessage>;

const SetPeersMessage = t.intersection([
    t.type({
        messageType: t.literal("setPeers"),
        peerUUIDs: t.record(t.string, SetType(t.string)),
    }),
    t.partial({
        shipUUID: t.string
    })
]);
type SetPeersMessage = t.TypeOf<typeof SetPeersMessage>;

const OnConnectMessage = t.type({
    messageType: t.literal("onConnect"),
    state: GameState,
    peerUUIDs: t.record(t.string, SetType(t.string)),
    shipUUID: t.string
})

type OnConnectMessage = t.TypeOf<typeof OnConnectMessage>;

const CommunicatorMessage = t.union([
    StateMessage,
    SetPeersMessage,
    OnConnectMessage
]);



// Each client (or virtual client in the case of NPCs) uses this
// class to communicate with the other clients and receive information from the server.

// The purpose of this class is 
// to use a channel to communicate with
// the server and other clients in order
// to maintain a consistent game state.
// It handles changing the client's state to
// reflect that of the others
// and it handles notifying others of any
// changes in the client's state that they would
// not be able to predict, such as ones resulting
// from keypresses.
class Communicator {
    // A map from channel uuids to the set of
    // uuids that the peer owns.
    readonly peerUUIDs: { [channelUUID: string]: Set<string> };
    readonly channel: Channel;

    private stateChanges: PartialState<GameState>;

    // The ship under this client's control.
    // Changes when buying or capturing a ship.
    // Set by the server.
    // Used to determine whether or not a state change that peers
    // would need to be notified of has occurred.
    ownedUUIDs: Set<string>;
    shipUUID: string | undefined;
    onShipUUID: AnyEvent<[string | undefined, string]> // [old, new] ship uuids
    onReady: AnyEvent<boolean>; // After the server gives us the universe.


    constructor({ channel }: { channel: Channel }) {
        this.peerUUIDs = {};
        this.channel = channel;
        this.ownedUUIDs = new Set();
        this.stateChanges = {};
        // this.channel.onConnect.attach((peer) => {
        //     console.log(peer);
        // })

        this.channel.onMessage.attach(this._handleMessage.bind(this));
        this.channel.onPeerDisconnect.attach(this._removeOldPeer.bind(this));
        this.onShipUUID = new AnyEvent();
        this.onReady = new AnyEvent();
    }

    // applySystemChanges(state: SystemState): SystemState {

    // }

    private _handleMessage({ source, message }: {
        source: string,
        message: unknown
    }) {

        const decoded = CommunicatorMessage.decode(message);
        if (decoded.isLeft()) {
            console.warn(
                `Bad message from ${source}\n`
                + PathReporter.report(decoded).join("\n"))
            return;
        }

        const decodedMessage = decoded.value;
        switch (decodedMessage.messageType) {
            case "setPeers":
                if (this.channel.admins.has(source)) {
                    for (let [key, uuids] of Object.entries(decodedMessage.peerUUIDs)) {
                        if (key === this.channel.uuid) {
                            this.ownedUUIDs = uuids;
                        }
                        else {
                            this.peerUUIDs[key] = uuids;
                        }
                    }
                    if (decodedMessage.shipUUID) {
                        let oldUUID = this.shipUUID;
                        this.shipUUID = decodedMessage.shipUUID;
                        this.onShipUUID.post([oldUUID, this.shipUUID]);
                    }
                }
                else {
                    console.warn(source + " tried to set UUIDs "
                        + "but is not an admin!");
                }
                break;

            case "setState":
                let state = decodedMessage.state
                if (!this.channel.admins.has(source) &&
                    this.peerUUIDs[source]) {
                    state = filterUUIDs(state, this.peerUUIDs[source]);
                }
                mergeStates(this.stateChanges, state);
                break;

            case "onConnect":
                const stateMessage: StateMessage = {
                    messageType: "setState",
                    state: decodedMessage.state
                }
                this._handleMessage({
                    source,
                    message: stateMessage
                });

                const peersMessage: SetPeersMessage = {
                    messageType: "setPeers",
                    peerUUIDs: decodedMessage.peerUUIDs,
                    shipUUID: decodedMessage.shipUUID
                }
                this._handleMessage({
                    source,
                    message: peersMessage
                });

                this.onReady.post(true);
        }
    }

    private _removeOldPeer(peerID: string) {
        delete this.peerUUIDs[peerID];
    }

    applyStateChanges(state: PartialState<GameState>): PartialState<GameState> {
        mergeStates(state, this.stateChanges);
        this.stateChanges = {};
        return state;
    }

    // Note that this overwrites state!
    notifyPeers(state: PartialState<GameState>) {
        const filtered = filterUUIDs(state, this.ownedUUIDs);
        const stateMessage: StateMessage = {
            messageType: "setState",
            state: filtered
        }
        this.channel.broadcast(stateMessage);
    }

    // Used by the server to handle client connections
    bindServerConnectionHandler(getState: () => GameState,
        addClientToGame: () => Promise<{ clientUUIDs: Set<string>, shipUUID: string }>) {

        this.channel.onPeerConnect.attach(async (uuid: string) => {
            console.log("New Client: " + uuid);

            const { clientUUIDs, shipUUID } = await addClientToGame();
            this.peerUUIDs[uuid] = clientUUIDs;

            // Tell everyone about the new peer
            let newPeerUUID: { [index: string]: Set<string> } = {};
            newPeerUUID[uuid] = this.peerUUIDs[uuid];
            const newPeerMessage: SetPeersMessage = {
                messageType: "setPeers",
                peerUUIDs: newPeerUUID
            }
            this.channel.broadcast(SetPeersMessage.encode(newPeerMessage));


            // Tell the new peer the state of the universe,
            // which ship it controlls, and who the other peers are
            let onConnectMessage: OnConnectMessage = {
                messageType: "onConnect",
                peerUUIDs: this.peerUUIDs,
                shipUUID: shipUUID,
                state: getState()
            }

            this.channel.send(uuid, CommunicatorMessage.encode(onConnectMessage));
        });
    }
}





export { Communicator, StateMessage, CommunicatorMessage };
