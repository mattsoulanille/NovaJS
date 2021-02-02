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


export type ImmerStepper<State> = ({ time, state, makeDelta, delta }: {
    time: number,
    state: State,
    delta?: Patch[],
    makeDelta: boolean,
}) => { state: State, delta?: Patch[] }

type StepState<State> = (args: { time: number, state: Draft<State> }) => void;

export function immerStepperFactory<State>(
    step: StepState<State>,
    ignorePaths?: Iterable<Array<string | number>>): ImmerStepper<State> {

    const ignorePathsTable = ignorePaths ? new IgnorePathsTable(ignorePaths) : undefined;

    return function({ time, state, makeDelta, delta }) {
        const stepBound = (state: Draft<State>) => {
            step({ time, state });
        }

        if (delta) {
            state = applyPatches(state, delta);
        }

        if (makeDelta) {
            const [resultState, resultDelta] = produceWithPatches(state, stepBound);

            if (ignorePathsTable) {
                for (const patch of resultDelta) {
                    if (!ignorePathsTable.isIgnored(patch.path)) {
                        return {
                            state: resultState,
                            delta: resultDelta,
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
                delta: resultDelta,
            }
        } else {
            return {
                state: produce(state, stepBound)
            }
        }
    }
}

export function makeImmerMod<State, FactoryData>(name: string,
    stateFactory: (factoryData: FactoryData) => State,
    stepState: StepState<State>,
    ignorePaths?: Iterable<Array<string | number>>) {

    return class implements StateTreeMod<Patch[]> {
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

        step(args: { time: number; delta?: Patch[]; makeDelta: boolean; }): Patch[] | undefined {
            const { state, delta } = this.immerStepper({ ...args, state: this.state });
            this.state = state;
            return delta;
        }

        destroy() { }
    }
}
