import { GameMessage } from "novajs/nova/src/proto/protobufjs_bundle";
import { Stateful } from "../engine/Stateful";
import { EngineView, engineViewFactory } from "../engine/TreeView";
import { ChannelClient } from "./Channel";
import { getChanges } from "./GetChanges";
import { overwriteState } from "./OverwriteState";


export class CommunicatorClient implements Stateful<EngineView> {
    private receivedStates: EngineView[] = [];

    constructor(private channel: ChannelClient) {
        channel.message.subscribe(this.onMessage.bind(this));
    }

    private onMessage(message: GameMessage) {
        if (message.engineState) {
            this.receivedStates.push(engineViewFactory(message.engineState));
        }
    }

	/**
	 * Reports changes to the server. Then, applies changes
	 * previously received from the server. Should be called
	 * after the engine computes the next state.
	 */
    stepState({ state, nextState }: { state: EngineView; nextState: EngineView; delta: number; }): EngineView {

        this.reportChanges(state, nextState);
        nextState = this.applyReceivedStates(nextState);
        this.receivedStates.length = 0;

        return nextState;
    }

    private reportChanges(state: EngineView, nextState: EngineView) {
        const changes = getChanges(state, nextState);
        if (changes) {
            const message = new GameMessage();
            message.engineState = changes.serialize();
            this.channel.send(message);
        }
    }

    private applyReceivedStates(nextState: EngineView) {
        for (const receivedState of this.receivedStates) {
            nextState = overwriteState(nextState, receivedState);
        }
        this.receivedStates = [];
        return nextState;
    }
}
