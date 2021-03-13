import { applyPatches, createDraft, enableMapSet, enablePatches, finishDraft, Patch, setAutoFreeze } from "immer";
import { ArgsToData, ArgTypes, UUID } from "./arg_types";
import { Plugin } from "./plugin";
import { Resource } from "./resource";
import { BaseSystemArgs, System } from "./system";
import { DefaultMap } from "./utils";


class AsyncSystemData {
    systems: DefaultMap<string /* system name */,
        DefaultMap<string /* entity uuid */, {
            patches: Patch[][],
            promise: Promise<void>,
        }>> = new DefaultMap(
            () => new DefaultMap(() => {
                return {
                    patches: [],
                    promise: Promise.resolve(),
                }
            })
        );
    done: Promise<void> = Promise.resolve();
}

export const AsyncSystemResource = new Resource<AsyncSystemData>({
    name: 'AsyncSystemResource',
    multiplayer: false,
});

export interface AsyncSystemArgs<StepArgTypes extends readonly ArgTypes[]>
    extends BaseSystemArgs<StepArgTypes> {
    step: (...args: ArgsToData<StepArgTypes>) =>
        Promise<void | ArgsToData<StepArgTypes>>;
}

enablePatches();
enableMapSet();
setAutoFreeze(false);

export class AsyncSystem<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]>
    extends System<[typeof AsyncSystemResource, typeof UUID, ...StepArgTypes]> {
    constructor(systemArgs: AsyncSystemArgs<StepArgTypes>) {
        super({
            ...systemArgs,
            args: [AsyncSystemResource, UUID, ...systemArgs.args],
            step: (asyncSystemData, UUID, ...stepArgs) => {
                const system = asyncSystemData.systems.get(this.name);
                const entityStatus = system?.get(UUID);
                if (!entityStatus) {
                    throw new Error("Expected default map to provide entity status");
                }

                // Apply patches from the previous complete run.
                // Note that this only runs if the entity still exists.

                // This is a hack to force immer to treat stepArgs
                // as if it were a draft. It greatly simplifies the rest
                // of the code, but may break in the future.
                (stepArgs as any)[Symbol.for('immer-state')] = true;
                for (const patches of entityStatus.patches) {
                    applyPatches(stepArgs, patches);
                }
                delete (stepArgs as any)[Symbol.for('immer-state')];
                entityStatus.patches = [];

                //const currentArgs = getCurrentArgs(systemArgs.args, stepArgs);
                const draftArgs = createDraft(stepArgs);

                // TODO: This error handling is wrong.
                entityStatus.promise = systemArgs.step(...draftArgs as typeof stepArgs)
                    .then(() => {
                        let patches: Patch[] | undefined;

                        finishDraft(draftArgs, (forwardPatches) => {
                            patches = forwardPatches;
                        });

                        if (!patches) {
                            throw new Error('Got no patches when calling async system');
                        }
                        if (patches.length > 0) {
                            entityStatus.patches.push(patches);
                        }
                    });

                asyncSystemData.done = (async () => {
                    await asyncSystemData.done;
                    await entityStatus.promise;
                })();
            }
        });
    }
}

export const AsyncSystemPlugin: Plugin = {
    name: 'AsyncSystem',
    build: (world) => {
        world.resources.set(AsyncSystemResource, new AsyncSystemData());
    }
};
