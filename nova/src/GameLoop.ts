import produce, { enableMapSet } from "immer";
import { EngineFactory } from "./engine/EngineFactory";
import { engineStep } from "./engine/EngineStep";
import { Engine, Step } from "./engine/State";
import { stateSpreader } from "./engine/StateSpreader";

// Allow immer to use maps
enableMapSet();

export class GameLoop {
    state: Engine;
    readonly display?: (engine: Engine) => unknown;

    private getNextState: Step<Engine>;

    constructor({ engine, display }:
        {
            engine?: Engine,
            //communicator: Step<Engine>,
            display?: (engine: Engine) => unknown
        }
    ) {
        this.state = engine ?? EngineFactory.base()

        // TODO: Keep state in sync with the server.
        this.getNextState = stateSpreader([
            engineStep,
            //            communicator,
        ]);

        this.display = display;
    }

    step(delta: number): void {
        this.state = produce(this.state, draft => {
            this.getNextState({
                state: draft,
                delta
            });
        })

        if (this.display) {
            this.display(this.state);
        }
    }
}
