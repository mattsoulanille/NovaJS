import { engine } from "novajs/nova/src/engine/Engine";
import { Stateful, GetNextState } from "./engine/Stateful";
import { stateSpreader } from "./engine/StateSpreader";
import { EngineView, IEngineView } from "./engine/TreeView";


export class GameLoop {
    state: IEngineView;
    readonly display?: (engineView: IEngineView) => unknown;

    private getNextState: GetNextState<IEngineView>;

    constructor({ engineView, communicator, display }: { engineView?: IEngineView, communicator: Stateful<IEngineView>, display?: (engineView: IEngineView) => unknown }) {
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
