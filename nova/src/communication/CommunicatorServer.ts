import { GameMessage, EngineState, SpaceObjectState, ShipState, SpaceObjectStateValue } from "novajs/nova/src/proto/protobufjs_bundle";
import { Stateful } from "../engine/Stateful";
import { EngineView, SpaceObjectView, engineViewFactory, spaceObjectViewFactory } from "../engine/TreeView";
import { ChannelServer } from "./Channel";
import { Position } from "../engine/space_object/Position";
import { Vector } from "../engine/Vector";
import { v4 as UUID } from "uuid";
import { filterState } from "./FilterState";
import { overwriteState } from "./OverwriteState";
import { getChanges } from "./GetChanges";

// TODO: Use a proper RPC
interface Client {
    ownedUuids: Set<string>;
    filteredStates: EngineView[];
}


export class CommunicatorServer implements Stateful<EngineView> {
    clientsToAdd: string[] = [];
    clientsToRemove: string[] = [];
    clients = new Map<string, Client>();

    constructor(private channel: ChannelServer) {
        channel.clientConnect.subscribe((clientId) => {
            this.clientsToAdd.push(clientId);
        });

        channel.clientDisconnect.subscribe((clientId) => {
            this.clientsToRemove.push(clientId);
        });

        channel.message.subscribe(({ message, source }) => {
            const client = this.clients.get(source);
            if (!client) {
                throw new Error(`Got a message for client ${source}`
                    + ` but no such client is connected.`);
            }
            if (message.engineState) {
                const engineView = engineViewFactory(message.engineState);
                const filtered = filterState(engineView, (id) => {
                    return client.ownedUuids.has(id);
                });
                client.filteredStates.push(filtered);

                // Rebroadcast messages
                for (const otherId of this.channel.clients) {
                    const message = new GameMessage();
                    message.engineState = filtered.serialize();
                    if (otherId !== source) {
                        this.channel.send(otherId, message);
                    }
                }
            }
        });
    }

	/**
	 * Reports changes to the clients. Then, applies changes
	 * previously received from the clients. Should be called
	 * after the engine computes the next state.
	 */
    stepState({ state, nextState }: { state: EngineView; nextState: EngineView; delta: number; }): EngineView {

        const system =
            nextState.families.systems.get("nova:130");
        if (!system) {
            throw new Error("system nova:130 not defined");
        }


        const serializedNextState = nextState.serialize();
        for (const clientId of this.clientsToAdd) {
            // TODO: Tell clients what ships they own.
            const ship = this.makeNewShip();
            const shipId = UUID();
            this.clients.set(clientId, {
                ownedUuids: new Set([shipId]),
                filteredStates: []
            });

            system.families.spaceObjects.set(shipId, ship);
            this.channel.send(clientId, { engineState: serializedNextState });
        }
        this.clientsToAdd.length = 0;

        for (const clientId of this.clientsToRemove) {
            const client = this.clients.get(clientId);
            if (!client) {
                break;
            }
            nextState = filterState(nextState, (id) => {
                return !client.ownedUuids.has(id);
            });
            this.clients.delete(clientId);
        }
        this.clientsToRemove.length = 0;

        this.reportChanges(state, nextState);
        nextState = this.applyReceivedStates(nextState);

        return nextState;
    }

	/**
	 * Sends changes that only the server knows about to the clients. 
	 * Does not send changes that clients made.
	 */
    private reportChanges(state: EngineView, nextState: EngineView) {
        const changes = getChanges(state, nextState);
        if (changes) {
            const message = new GameMessage();
            message.engineState = changes.serialize();
            for (const client of this.channel.clients) {
                this.channel.send(client, message);
            }
        }
    }

    private applyReceivedStates(nextState: EngineView) {
        for (const [, client] of this.clients) {
            for (const state of client.filteredStates) {
                nextState = overwriteState(nextState, state);
            }
            client.filteredStates.length = 0;
        }
        return nextState;
    }

    // TODO: Move this somewhere else
    private makeNewShip() {
        const ship = new SpaceObjectState();
        ship.value = new SpaceObjectStateValue();
        ship.value.position = new Position(
            (Math.random() - 0.5) * 400,
            (Math.random() - 0.5) * 400
        ).toProto();
        const shipState = new ShipState();
        const shipId = Math.floor(Math.random() * 40) + 128;
        shipState.id = `nova:${shipId}`;
        ship.value.shipState = shipState;
        ship.value.rotation = Math.random() * 2 * Math.PI;
        ship.value.velocity = new Vector(0, 0);
        return spaceObjectViewFactory(ship);
    }
} 
