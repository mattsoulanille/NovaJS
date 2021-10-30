import { applyPatches, createDraft, enableMapSet, enablePatches, finishDraft, isDraft, isDraftable, Patch, setAutoFreeze } from "immer";
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

export const AsyncSystemResource = new Resource<AsyncSystemData>('AsyncSystemResource');

export interface AsyncSystemArgs<StepArgTypes extends readonly ArgTypes[]>
    extends BaseSystemArgs<StepArgTypes> {
    step: (...args: ArgsToData<StepArgTypes>) =>
        Promise<void | boolean>;
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

                // Although, it looks simpler, can't do the following:
                // 'const draftArgs = createDraft(stepArgs);'
                // Must individually draft arguments so that if the argument
                // is already a draft, immer knows to use the original
                // (instead of the draft proxy) as the new draft's base.
                // Otherwise, when the original argument (which is a draft) is
                // finished, looking at the async system's draft of it will
                // look at the original arg's proxy, which is revoked.
                const draftArgs = stepArgs.map(arg => {
                    if (isDraftable(arg)) {
                        return createDraft(arg as Object);
                    }
                    return arg;
                }) as typeof stepArgs;

                // TODO: This error handling is wrong.
                entityStatus.promise = systemArgs.step(...draftArgs)
                    .then(apply => {
                        if (apply != null && !apply) {
                            // Do not apply patches
                            return;
                        }

                        const patches: Patch[] = [];
                        for (let i = 0; i < draftArgs.length; i++) {
                            const arg = draftArgs[i];
                            if (!isDraft(arg)) {
                                continue;
                            }

                            let argPatches: Patch[] | undefined;
                            finishDraft(arg, (forwardPatches) => {
                                argPatches = forwardPatches;
                            });

                            if (!argPatches) {
                                throw new Error('Got no patches when calling async system');
                            }
                            for (let patch of argPatches) {
                                // Edit the patch path to include the index
                                // of the argument.
                                patch.path.unshift(i);
                            }
                            patches.push(...argPatches);
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
