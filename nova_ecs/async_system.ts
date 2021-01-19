import { applyPatches, createDraft, enablePatches, finishDraft, Patch } from "immer";
import { ArgsToData, ArgTypes, Commands, UUID } from "./arg_types";
import { Plugin } from "./plugin";
import { Resource } from "./resource";
import { BaseSystemArgs, System } from "./system";
import { currentIfDraft, DefaultMap } from "./utils";
import { CommandsInterface } from "./world";

export const AsyncSystemData = new Resource<{
    systems: DefaultMap<string /* system name */,
        DefaultMap<string /* entity uuid */, {
            patches: Patch[][],
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

                // Apply patches from the previous complete run.
                // Note that this only runs if the entity still exists.

                // This is a hack to force immer to treat stepArgs
                // as if it were a draft. It greatly simplifies the rest
                // of the code, but may break in the future.
                (stepArgs as any)[Symbol.for('immer-state')] = true;
                for (const patches of entityStatus.patches) {
                    applyPatches(stepArgs, patches);
                }
                entityStatus.patches = [];

                const currentArgs = stepArgs.map(currentIfDraft);

                // const asyncCommand: CommandsInterface = {
                //     addEntity: (entity) => {
                //         this.
                //     }
                // }

                const asyncArgs = currentArgs.map((arg, index) => {
                    const argType = systemArgs.args[index];
                    if (argType === Commands) {
                        throw new Error('TODO: Commands not yet supported');
                    }
                    return arg;
                }) as typeof stepArgs;
                const draftArgs = createDraft(asyncArgs);

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
        world.addResource(AsyncSystemData, {
            done: Promise.resolve(),
            systems: new DefaultMap<string /* system name */,
                DefaultMap<string /* entity uuid */, {
                    patches: Patch[][],
                    promise: Promise<void>,
                }>>(
                    () => new DefaultMap(() => {
                        return {
                            patches: [],
                            promise: Promise.resolve(),
                        }
                    })
                )
        });
    }
};
