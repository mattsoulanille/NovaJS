import { GameMessage } from "novajs/nova/src/proto/protobufjs_bundle";
import { Stateful } from "../engine/Stateful";
import { EngineView, IEngineView } from "../engine/TreeView";
import { ChannelClient } from "./Channel";
import { getChanges } from "./GetChanges";
import { overwriteState } from "./OverwriteState";


export class CommunicatorClient implements Stateful<IEngineView> {
    private receivedStates: IEngineView[] = [];

    constructor(private channel: ChannelClient) {
        channel.message.subscribe(this.onMessage.bind(this));
    }

    private onMessage(message: GameMessage) {
        if (message.engineState) {
            this.receivedStates.push(new EngineView(message.engineState));
        }
    }

	/**
	 * Reports changes to the server. Then, applies changes
	 * previously received from the server. Should be called
	 * after the engine computes the next state.
	 */
    getNextState({ state, nextState }: { state: IEngineView; nextState: IEngineView; delta: number; }): IEngineView {

        this.reportChanges(state, nextState);
        nextState = this.applyReceivedStates(nextState);
        this.receivedStates.length = 0;

        return nextState;
    }

    private reportChanges(state: IEngineView, nextState: IEngineView) {
        const changes = getChanges(state, nextState);
        if (changes) {
            const message = new GameMessage();
            message.engineState = changes.protobuf;
            this.channel.send(message);
        }
    }

    private applyReceivedStates(nextState: IEngineView) {
        for (const receivedState of this.receivedStates) {
            nextState = overwriteState(nextState, receivedState);
        }
        return nextState;
    }
}
