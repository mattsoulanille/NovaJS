import { engine } from "novajs/nova/src/engine/Engine";
import { Stateful, StepState } from "./engine/Stateful";
import { stateSpreader } from "./engine/StateSpreader";
import { EngineView, engineViewFactory } from "./engine/TreeView";


export class GameLoop {
    state: EngineView;
    readonly display?: (engineView: EngineView) => unknown;

    private getNextState: StepState<EngineView>;

    constructor({ engineView, communicator, display }: { engineView?: EngineView, communicator: Stateful<EngineView>, display?: (engineView: EngineView) => unknown }) {
        this.state = engineView ?? engineViewFactory();
        this.getNextState = stateSpreader([
            engine,
            communicator.stepState.bind(communicator)
        ], engineViewFactory);

        this.display = display;
    }

    step(delta: number): void {
        this.state = this.getNextState({
            state: this.state,
            nextState: engineViewFactory(),
            delta
        });

        if (this.display) {
            this.display(this.state);
        }
    }
}
