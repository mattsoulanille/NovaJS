import produce, { applyPatches, Draft, enablePatches, Patch, produceWithPatches } from "immer";
import { DefaultMap } from "../common/DefaultMap";
import { StateTreeMod } from "./StateTreeMod";

enablePatches();

type IgnoreTree = { ignore: boolean, children: DefaultMap<string | number, IgnoreTree> };

function makeIgnoreTree(): IgnoreTree {
    return {
        ignore: false,
        children: new DefaultMap(makeIgnoreTree)
    }
}

class IgnorePathsTable {
    private tree: IgnoreTree = makeIgnoreTree();
    constructor(ignorePaths: Iterable<Array<string | number>>) {
        for (const path of ignorePaths) {
            this.addPath(path);
        }
    }

    isIgnored(path: Array<string | number>): boolean {
        let node = this.tree;
        for (const part of path) {
            if (node.ignore) {
                return true;
            }
            node = node.children.get(part);
        }
        return node.ignore;
    }

    private followPath(path: Array<string | number>) {
        let node = this.tree;
        for (const part of path) {
            node = node.children.get(part);
        }
        return node;
    }

    private addPath(path: Array<string | number>) {
        this.followPath(path).ignore = true;
    }
}

export type ImmerStepper<State> = ({ time, state, makePatches, patches }: {
    time: number,
    state: State,
    patches?: Patch[],
    makePatches: boolean,
}) => { state: State, patches?: Patch[] }

type StepState<State> = (args: { time: number, state: Draft<State> }) => void;

export function immerStepperFactory<State>(
    step: StepState<State>,
    ignorePaths?: Iterable<Array<string | number>>): ImmerStepper<State> {

    const ignorePathsTable = ignorePaths ? new IgnorePathsTable(ignorePaths) : undefined;

    return function({ time, state, makePatches, patches }) {
        const stepBound = (state: Draft<State>) => {
            step({ time, state });
        }

        if (patches) {
            state = applyPatches(state, patches);
        }

        if (makePatches) {
            const [resultState, resultPatches] = produceWithPatches(state, stepBound);

            if (ignorePathsTable) {
                for (const patch of resultPatches) {
                    if (!ignorePathsTable.isIgnored(patch.path)) {
                        return {
                            state: resultState,
                            patches: resultPatches,
                        }
                    }
                }
                // Omit delta since all paths are ignored
                return {
                    state: resultState,
                }
            }

            return {
                state: resultState,
                patches: resultPatches,
            }
        } else {
            return {
                state: produce(state, stepBound)
            }
        }
    }
}

export enum ImmerDeltaType {
    Patch,
    State,
}

export type ImmerDelta<State> = {
    type: ImmerDeltaType.Patch,
    patches: Patch[]
} | {
    type: ImmerDeltaType.State,
    state: State
};


export function makeImmerMod<State, FactoryData>(name: string,
    stateFactory: (factoryData: FactoryData) => State,
    stepState: StepState<State>,
    ignorePaths?: Iterable<Array<string | number>>) {

    return class implements StateTreeMod<ImmerDelta<State>> {
        name = name;
        state: State;
        immerStepper: ImmerStepper<State>;
        buildPromise: Promise<void>;
        built: boolean;

        constructor(factoryData: FactoryData) {
            this.state = stateFactory(factoryData);
            this.immerStepper = immerStepperFactory(stepState, ignorePaths);
            this.buildPromise = Promise.resolve();
            this.built = true;
        }

        applyDelta(delta: ImmerDelta<State>): void {
            if (delta?.type === ImmerDeltaType.Patch) {
                this.state = applyPatches(this.state, delta.patches);
            } else if (delta?.type === ImmerDeltaType.State) {
                this.state = delta.state;
            }
        }

        step({ time, makeDelta }: {
            time: number; makeDelta: boolean;
        }): ImmerDelta<State> | undefined {
            const { state, patches } = this.immerStepper({
                makePatches: makeDelta,
                time,
                state: this.state,
            });

            this.state = state;

            if (patches) {
                return {
                    type: ImmerDeltaType.Patch,
                    patches
                }
            }
            return;
        }

        getState(): ImmerDelta<State> {
            return {
                type: ImmerDeltaType.State,
                state: this.state
            }
        }
    }
}
