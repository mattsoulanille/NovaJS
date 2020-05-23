import { engine } from "novajs/nova/src/engine/Engine";
import { Stateful, GetNextState } from "./engine/Stateful";
import { stateSpreader } from "./engine/StateSpreader";
import { EngineView } from "./engine/TreeView";


export class GameLoop {
    state: EngineView;
    readonly display?: (engineView: EngineView) => unknown;

    private getNextState: GetNextState<EngineView>;

    constructor({ engineView, communicator, display }: { engineView?: EngineView, communicator: Stateful<EngineView>, display?: (engineView: EngineView) => unknown }) {
        this.state = engineView ?? new EngineView();
        this.getNextState = stateSpreader([
            engine,
            communicator.getNextState.bind(communicator)
        ], () => new EngineView());

        this.display = display;
    }

    step(delta: number): void {
        this.state = this.getNextState({
            state: this.state,
            nextState: new EngineView(),
            delta
        });

        if (this.display) {
            this.display(this.state);
        }
    }
}
