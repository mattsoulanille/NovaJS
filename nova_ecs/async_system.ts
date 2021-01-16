import { applyPatches, createDraft, current, enablePatches, finishDraft, Patch } from "immer";
import { ArgsToData, ArgTypes, UUID } from "./arg_types";
import { Plugin } from "./plugin";
import { Resource } from "./resource";
import { BaseSystemArgs, System } from "./system";
import { DefaultMap } from "./utils";

// TODO: This doesn't work because you can't asynchronously edit a draft if it's expected to be synchronously edited. AsyncSystemData is passed in a draft in step()

// This approach is good though because it causes changes that a system would make
// to happen at the time the changes are expected based on where the system appears
// in the DAG. This is useful for systems that add entities, since those new entities
// will get picked up by the multiplayer change reporter.

// An option would be to make resources an escape hatch out of immer, i.e. make resources
// not be drafted. This isn't really what I want to do, though. 

export const AsyncSystemData = new Resource<{
    systems: DefaultMap<string /* system name */,
        DefaultMap<string /* entity uuid */, {
            running: boolean,
            patches: Patch[],
            promise: Promise<void>,
        }>>,
    done: Promise<void>,
}>({
    name: 'AsyncSystemData',
    multiplayer: false,
    mutable: true,
});

export interface AsyncSystemArgs<StepArgTypes extends readonly ArgTypes[]>
    extends BaseSystemArgs<StepArgTypes> {
    step: (...args: ArgsToData<StepArgTypes>) =>
        Promise<void | ArgsToData<StepArgTypes>>;
}

enablePatches();

export class AsyncSystem<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]>
    extends System<[typeof AsyncSystemData, typeof UUID, ...StepArgTypes]> {
    constructor(systemArgs: AsyncSystemArgs<StepArgTypes>) {
        super({
            ...systemArgs,
            args: [AsyncSystemData, UUID, ...systemArgs.args],
            step: (asyncSystemData, UUID, ...stepArgs) => {
                const system = asyncSystemData.systems.get(this.name);
                const entityStatus = system?.get(UUID);
                if (!entityStatus) {
                    throw new Error("Expected default map to provide entity status");
                }

                if (entityStatus.running) {
                    return; // Only one run at a time per entity
                }

                // Apply patches from the previous complete run.
                // Note that this only runs if the entity still exists.

                // This is a hack to force immer to treat stepArgs
                // as if it were a draft. It greatly simplifies the rest
                // of the code, but may break in the future.
                (stepArgs as any)[Symbol.for('immer-state')] = true;
                applyPatches(stepArgs, entityStatus.patches);

                const currentArgs = stepArgs.map(arg => current(arg)) as typeof stepArgs;
                const draftArgs = createDraft(currentArgs);

                entityStatus.running = true;
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

                        entityStatus.patches = patches;
                        entityStatus.running = false;
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
        world.addResource(AsyncSystemData, {
            done: Promise.resolve(),
            systems: new DefaultMap<string /* system name */,
                DefaultMap<string /* entity uuid */, {
                    running: boolean,
                    patches: Patch[],
                    promise: Promise<void>,
                }>>(
                    () => new DefaultMap(() => {
                        return {
                            running: false,
                            patches: [],
                            promise: Promise.resolve(),
                        }
                    })
                )
        });
    }
};
