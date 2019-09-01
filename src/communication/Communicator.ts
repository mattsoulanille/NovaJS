import * as t from "io-ts";
import { GameState } from "../engine/GameState";
import { SystemState } from "../engine/SystemState";
import { Channel } from "./Channel";
import { PathReporter } from "io-ts/lib/PathReporter";
import { PartialState, MakeRecursivePartial } from "../engine/Stateful";


const SetUUIDsMessage = t.type({
    messageType: t.literal("setUUIDs"),
    UUIDs: t.array(t.string),
    shipUUID: t.string
});
type SetUUIDsMessage = t.TypeOf<typeof SetUUIDsMessage>;

const StateMessage = t.type({
    messageType: t.literal("setState"),
    state: MakeRecursivePartial(GameState)
});
type StateMessage = t.TypeOf<typeof StateMessage>;

const CommunicatorMessage = t.union([
    SetUUIDsMessage,
    StateMessage
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

    constructor({ channel }: { channel: Channel }) {
        this.peerUUIDs = {};
        this.channel = channel;
        this.ownedUUIDs = new Set();
        this.stateChanges = {};
        // this.channel.onConnect.attach((peer) => {
        //     console.log(peer);
        // })

        this.channel.onMessage.attach(this._handleMessage.bind(this));
    }



    // applySystemChanges(state: SystemState): SystemState {

    // }

    private _handleMessage({ source, message }: {
        source: string,
        message: unknown
    }) {

        const decoded = CommunicatorMessage.decode(message);
        if (decoded.isLeft()) {
            PathReporter.report(decoded)
            return;
        }

        const decodedMessage = decoded.value;
        switch (decodedMessage.messageType) {
            case "setUUIDs":
                if (this.channel.admins.has(source)) {
                    this.ownedUUIDs = new Set(decodedMessage.UUIDs);
                    this.shipUUID = decodedMessage.shipUUID;
                }

                else {
                    console.warn(source + " tried to set UUIDs "
                        + "but is not an admin!");
                }
                break;
            case "setState":
                console.log(decodedMessage);
                break;
        }

    }

    applyStateChanges(state: GameState): GameState {
        return state;
    }


    notifyPeers(state: SystemState) {
        if (this.shipUUID) {
            let shipState = state.ships[this.shipUUID];
            if (shipState) {
                this.channel.broadcast(shipState);
            }
        }
    }

}





export { Communicator, SetUUIDsMessage, StateMessage, CommunicatorMessage };
