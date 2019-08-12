import * as tsEvents from "ts-events";
import * as UUID from "uuid/v4";

import { AnyEvent } from "ts-events";
import { Channel } from "./Channel";
import { GameState } from "../engine/GameState";
import { PartialState } from "../engine/Stateful";



// Each client (or virtual client in the case of NPCs) uses this
// class to communicate with the other clients and receive information from the server.

class Communicator {
    readonly peerUUIDs: { [commUUID: string]: Set<string> };
    readonly channel: Channel;

    // The ship under this client's control.
    // Changes when buying or capturing a ship.
    // Set by the server.
    // Used to determine whether or not a state change that peers
    // would need to be notified of has occurred.
    readonly shipUUID: string;

    constructor({ channel, shipUUID }: { channel: Channel, shipUUID: string }) {
        this.peerUUIDs = {};
        this.channel = channel;
        this.shipUUID = shipUUID;


    }

    notifyPeers(_state: GameState) {

    }
}





export { Communicator }
